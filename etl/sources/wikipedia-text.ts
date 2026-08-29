/**
 * Wikipedia article text, for care-data extraction.
 *
 * WHY WIKITEXT AND NOT `prop=extracts`. The extracts API caps at one full
 * extract per request, so a 50-title batch returns 49 empty strings and one
 * article - which reads exactly like "49 species have no article" unless you
 * check. `prop=revisions` returns the full source of every page in the batch,
 * which is both complete and 50x cheaper in requests.
 *
 * WHY THE TEXT IS CACHED TO DISK. The extraction step downstream is a language
 * model reading prose, and a claim it makes is only checkable if the text it
 * read is still on hand. The cache is therefore evidence, not an optimisation:
 * `ingest-care-proposals.ts` greps every quoted sentence back against it, and
 * a value whose sentence is not found is rejected. Nothing else in this
 * pipeline can tell a real citation from an invented one.
 *
 * POLITENESS. Anonymous use of the action API rate-limits hard and fast: a
 * burst of sixty single-title requests during design returned 429 for every
 * one of them. Serial batches, a pause between them, exponential backoff, and
 * a loud failure rather than a silent gap.
 */

const API = 'https://en.wikipedia.org/w/api.php';

const USER_AGENT =
  'Fish2TankResearch/0.1 (personal aquarium field guide; +https://github.com/leonidas47dario/Fish2tank)';

/** MediaWiki caps a titles= batch at 50 for anonymous callers. */
export const MAX_TITLES_PER_REQUEST = 50;

export interface WikiPage {
  /** The title we asked for. */
  requested: string;
  /** The title the API resolved to, after normalisation and redirects. */
  resolved: string;
  /** Absent when no article exists under that name. */
  wikitext?: string;
  /**
   * True when `resolved` differs from `requested`. A redirect is a hint that
   * our own binomial is a misspelling or a superseded combination, which is
   * worth recording even though this spec does not act on it.
   */
  redirected: boolean;
}

export interface FetchOptions {
  delayMs?: number;
  backoffMs?: number;
  maxAttempts?: number;
  userAgent?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  onBatch?: (batch: number, titles: number, note: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Follow the API's normalisation and redirect maps from the title we asked for
 * to the title it actually served.
 *
 * Both maps are flat `from -> to` lists and a lookup can chain: "Balantiocheilus
 * melanopterus" normalises, then redirects to "Balantiocheilos melanopterus".
 * The hop limit stops a cyclic redirect pair spinning forever.
 */
export function resolveTitle(
  requested: string,
  maps: Array<Array<{ from: string; to: string }> | undefined>,
  maxHops = 4,
): string {
  const chain = new Map<string, string>();
  for (const m of maps) for (const { from, to } of m ?? []) chain.set(from, to);

  let title = requested;
  const seen = new Set<string>([title]);
  for (let hop = 0; hop < maxHops; hop++) {
    const next = chain.get(title);
    if (!next || seen.has(next)) break;
    title = next;
    seen.add(title);
  }
  return title;
}

/** Wikipedia unit codes, rendered as the article renders them. */
const CONVERT_UNITS: Record<string, string> = {
  cm: 'cm', mm: 'mm', m: 'm', in: 'in', ft: 'ft', foot: 'ft', feet: 'ft',
  C: '°C', F: '°F', K: 'K',
  kg: 'kg', g: 'g', lb: 'lb', oz: 'oz',
  L: 'L', l: 'L', usgal: 'US gal', USgal: 'US gal', impgal: 'imp gal',
  km: 'km', mi: 'mi',
};

/**
 * Render `{{convert}}` as its source figure, before templates are stripped.
 *
 * THIS IS THE WHOLE BALL GAME. Wikipedia writes every measurement through this
 * template - "can reach a length of {{convert|9|cm|in}} TL" - so a stripper
 * that drops templates wholesale turns that sentence into "can reach a length
 * of TL." and silently deletes the one fact this pipeline exists to collect.
 * Caught in review of the first cached article, where six of ten had lost
 * their size this way.
 *
 * It renders the SOURCE value and unit only, never the converted one. Emitting
 * "9 cm (3.5 in)" would mean this function computed 3.5, and a number this
 * pipeline computed is a number no source stated. The gate downstream converts
 * units itself and checks the result against whatever figure the quote holds.
 */
export function expandConvert(wikitext: string): string {
  return wikitext.replace(/\{\{\s*(?:convert|cvt)\s*\|([^{}]*)\}\}/gi, (_all, body: string) => {
    const parts = String(body)
      .split('|')
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !p.includes('='));
    if (parts.length < 2) return ' ';

    const [first, second, third, fourth] = parts;
    if (!first || !second || !/^-?\d/.test(first)) return ' ';

    // {{convert|22|-|28|C|F}} and {{convert|22|to|28|C}} are ranges.
    if (third && fourth && /^(-|–|—|to|and)$/i.test(second) && /^-?\d/.test(third)) {
      return `${first}–${third} ${CONVERT_UNITS[fourth] ?? fourth}`;
    }
    return `${first} ${CONVERT_UNITS[second] ?? second}`;
  });
}

/**
 * Reduce wikitext to the prose a reader sees.
 *
 * This is deliberately lossy in one direction only: it removes markup, never
 * sentences. Quotes are matched against this output downstream, so anything
 * that mangles a sentence mid-way turns a good citation into a rejected one.
 * Templates are stripped innermost-first because they nest, and infoboxes are
 * dropped whole because their contents are field fragments rather than prose.
 */
export function stripWikitext(wikitext: string): string {
  // Measurements first, or the template stripper eats them. See expandConvert.
  let s = expandConvert(wikitext);

  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<ref[^>]*\/>/gi, ' ');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ');
  s = s.replace(/<(table|gallery|imagemap|math|score)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Tables. Non-greedy so a page with several does not collapse into one.
  s = s.replace(/\{\|[\s\S]*?\|\}/g, ' ');

  // Templates, innermost first. A bounded loop: pathological nesting stops
  // rather than hanging the build.
  //
  // Each pass strips the innermost non-convert template and THEN re-expands,
  // because `{{convert|35|cm|in|abbr={{on}}}}` only becomes expandable once
  // its inner `{{on}}` is gone. Stripping and expanding in one pass would
  // discard that measurement.
  for (let i = 0; i < 12 && s.includes('{{'); i++) {
    const stripped = s.replace(/\{\{(?!\s*(?:convert|cvt)\s*\|)[^{}]*\}\}/gi, ' ');
    const next = expandConvert(stripped);
    if (next === s) break;
    s = next;
  }
  // Anything still unexpanded here is a malformed convert; drop the markup.
  s = s.replace(/\{\{[^{}]*\}\}/g, ' ');

  // File and category links, before plain links, or the inner pipe survives.
  s = s.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, ' ');
  // [[target|shown]] -> shown, [[target]] -> target
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1');
  s = s.replace(/\[\[([^\]]*)\]\]/g, '$1');
  // [http://x label] -> label
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1');
  s = s.replace(/\[https?:\/\/\S+\]/g, ' ');

  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/'''''|'''|''/g, '');
  // Headings become their own line so section context survives for the reader.
  s = s.replace(/^=+\s*(.*?)\s*=+\s*$/gm, '\n$1\n');
  s = s.replace(/^[*#:;]+\s*/gm, '');

  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

interface ApiResponse {
  query?: {
    pages?: Array<{
      title: string;
      missing?: boolean;
      revisions?: Array<{ slots?: { main?: { content?: string } } }>;
    }>;
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
  };
}

/**
 * One batch of up to 50 titles.
 *
 * Throws rather than returning a partial result: a caller that cannot tell a
 * rate-limited batch from a batch of nonexistent articles will record the
 * wrong fact about fifty species at once.
 */
export async function fetchWikitextBatch(
  titles: string[],
  opts: FetchOptions = {},
): Promise<WikiPage[]> {
  if (titles.length > MAX_TITLES_PER_REQUEST) {
    throw new Error(`batch of ${titles.length} exceeds the API cap of ${MAX_TITLES_PER_REQUEST}`);
  }
  const {
    backoffMs = 3000,
    maxAttempts = 6,
    userAgent = USER_AGENT,
    fetchImpl = fetch,
  } = opts;

  const url =
    `${API}?action=query&prop=revisions&rvprop=content&rvslots=main` +
    `&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(titles.join('|'))}`;

  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent } });
    lastStatus = res.status;
    if (res.status === 429 || res.status >= 500) {
      const wait = backoffMs * attempt;
      opts.onBatch?.(0, titles.length, `HTTP ${res.status}, backing off ${wait}ms (attempt ${attempt}/${maxAttempts})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`Wikipedia API returned HTTP ${res.status} for a batch of ${titles.length}`);

    const body = (await res.json()) as ApiResponse;
    const pages = body.query?.pages ?? [];
    const byTitle = new Map(pages.map((p) => [p.title, p]));
    const maps = [body.query?.normalized, body.query?.redirects];

    return titles.map((requested) => {
      const resolved = resolveTitle(requested, maps);
      const page = byTitle.get(resolved);
      const wikitext = page?.missing ? undefined : page?.revisions?.[0]?.slots?.main?.content;
      return {
        requested,
        resolved,
        ...(wikitext ? { wikitext } : {}),
        redirected: resolved !== requested,
      };
    });
  }
  throw new Error(
    `Wikipedia API still returning HTTP ${lastStatus} after ${maxAttempts} attempts for a batch of ${titles.length}`,
  );
}

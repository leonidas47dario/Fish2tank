/**
 * Stage 1 for Seriously Fish: resolve which species SF covers, and cache the
 * pages - spec 045.
 *
 *   npm run sf:fetch              # everything matched, resuming
 *   npm run sf:fetch -- --limit 20
 *   npm run sf:fetch -- --probe   # coverage only, fetches no species page
 *
 * COVERAGE IS MEASURED FROM THE SITEMAP, NOT GUESSED AT. Spec 045 called for a
 * probe of 969 speculative URLs to find the hit rate. SF publishes a sitemap
 * and `robots.txt` says `Allow: /` with only the affiliate `/go/` path
 * disallowed - so one request answers the same question exactly, and asking a
 * small site for 969 pages to learn something it already published would have
 * been rude as well as slower.
 *
 * TWO WAYS A SLUG IS FOUND, and they are not equally trustworthy:
 *   - EXACT: our binomial slugifies to a slug SF publishes.
 *   - EPITHET: our genus has moved (Corydoras -> Hoplisoma, Osteogaster) but
 *     the epithet is unique across SF, so there is exactly one candidate.
 * An epithet match is a CANDIDATE, never an answer. The page states its own
 * binomial and `sf:ingest` rejects a row whose page disagrees - the guard spec
 * 045 asked for, because a slug cannot prove which animal it landed on.
 *
 * The cache is one file per species and a species already cached is never
 * refetched, so a run resumes and a re-run costs nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getWithRetry, sleep, USER_AGENT } from './sources/http';
import { flatten } from './sources/seriously-fish';
import { sfTextPath, SF_BASE, matchSlugs, type SlugMatch } from './care/seriously-fish-slugs';
import { TEXT_DIR } from './care/paths';

const SITEMAP = `${SF_BASE}/sitemap.xml`;
const MATCHES = 'data/care/seriously-fish-matches.json';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const has = (n: string) => process.argv.includes(`--${n}`);

async function main(): Promise<void> {
  const catalog = JSON.parse(readFileSync('src/data/seed/marts/catalog.json', 'utf8')) as {
    species: Array<{ speciesId: string; scientificName?: string; organismKind?: string; waterType?: string }>;
  };

  console.info('[sf] reading sitemap', { url: SITEMAP });
  const xml = await (await getWithRetry(SITEMAP, { userAgent: USER_AGENT })).text();
  const slugs = [...xml.matchAll(/<loc>https:\/\/www\.seriouslyfish\.com\/species\/([^<\/]+)\/?<\/loc>/g)]
    .map((m) => (m[1] ?? '').replace(/\/$/, ''))
    .filter((s) => /^[a-z]+-[a-z0-9-]+$/.test(s));

  /*
   * The addressable set, exactly as spec 045 defines it: SF is a freshwater
   * site, so marine species are out of scope rather than missing.
   */
  const addressable = catalog.species.filter(
    (r) => r.organismKind === 'fish' && r.waterType !== 'marine',
  );

  const { matches, absent } = matchSlugs(addressable, slugs);

  console.info('[sf] coverage', {
    sfProfiles: slugs.length,
    addressable: addressable.length,
    exact: matches.filter((m) => m.how === 'exact').length,
    trinomial: matches.filter((m) => m.how === 'trinomial').length,
    curated: matches.filter((m) => m.how === 'curated').length,
    noProfile: absent,
    // Every route is now exact on the parts that identify the animal, so this
    // is reachable rather than "reachable, minus whatever the guard throws
    // out" - which is what it meant while the epithet fallback fed it 79
    // candidates and 74 were a different fish (spec 060).
    reachablePct: `${((100 * matches.length) / addressable.length).toFixed(1)}%`,
  });

  mkdirSync('data/care', { recursive: true });
  writeFileSync(MATCHES, `${JSON.stringify(matches, null, 1)}\n`);
  console.info('[sf] wrote match list', { path: MATCHES, rows: matches.length });

  if (has('probe')) {
    console.info('[sf] probe only, fetching no species pages');
    return;
  }

  mkdirSync(TEXT_DIR, { recursive: true });
  const limit = Number(arg('limit') ?? matches.length);
  const todo = matches.filter((m: SlugMatch) => !existsSync(sfTextPath(m.speciesId))).slice(0, limit);
  console.info('[sf] fetching', { queued: todo.length, alreadyCached: matches.length - todo.length });

  let ok = 0; let failed = 0;
  for (const [i, m] of todo.entries()) {
    const url = `${SF_BASE}/species/${m.slug}/`;
    try {
      const res = await getWithRetry(url, { userAgent: USER_AGENT });
      if (!res.ok) { failed += 1; console.warn('[sf] fetch -> not ok', { id: m.speciesId, url, status: res.status }); continue; }
      const text = flatten(await res.text());
      // Two-line header, the shape stage 1 of the Wikipedia backfill already
      // writes, so `readSourceDoc` can read either without a special case.
      writeFileSync(sfTextPath(m.speciesId), `# ${m.slug}\n# ${url}\n${text}\n`);
      ok += 1;
    } catch (cause) {
      failed += 1;
      console.warn('[sf] fetch -> threw', { id: m.speciesId, url, cause: String(cause) });
    }
    if (i % 25 === 24) console.info('[sf] progress', { done: i + 1, of: todo.length, ok, failed });
    // Politeness. A small site, and nothing here is urgent.
    await sleep(700);
  }

  // Every run lands in exactly one bucket and every bucket prints, empty or
  // not: a run that fetched nothing must say so rather than reporting success.
  console.info('[sf] fetch complete', { fetched: ok, failed, cached: matches.length - todo.length + ok });
  if (ok === 0 && todo.length > 0) throw new Error('sf:fetch queued pages but cached none');
}

void main();

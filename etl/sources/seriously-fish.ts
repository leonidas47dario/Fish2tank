/**
 * Reading a Seriously Fish species profile - spec 045 (feat/seriously-fish-profile).
 *
 * PURE. Takes the flattened text of a page and returns figures, each carrying
 * the verbatim fragment it came from. No fetching, no filesystem, so every
 * extraction rule is reachable from a unit test against a real page.
 *
 * WHY THIS IS NOT AN LLM PROPOSAL STEP like the Wikipedia backfill. SF states
 * its care figures in a LABELLED TABLE - "Volume ~54 litres ~14 US gal" - not
 * in prose. Structured evidence can be read deterministically, so the same
 * input always yields the same output and the gate has something exact to
 * check. The existing `care:plan` / `care:ingest` route exists because
 * Wikipedia buries its numbers in sentences; that is not the problem here.
 *
 * THE HAZARD THE SPEC NAMED, and the reason each matcher is anchored to a
 * unit rather than to a position: SF ships BOTH unit systems in one cell and
 * toggles between them client-side, so flattened text reads
 * `45 mm SL 1.8 in SL` and `~54 litres ~14 US gal`. A matcher that took "the
 * first number" would take the metric one and be wrong by 25x on volume. Every
 * rule below names the unit it wants and records which half it used.
 */

/** Which end of the fish the length was measured to. Spec 045's distinction. */
export type LengthBasis = 'SL' | 'TL' | 'unstated';

export interface SfFigure<T> {
  value: T;
  /** The verbatim fragment. What the gate re-finds in the cached text. */
  quote: string;
}

export interface SfDifficulty {
  measure: string;
  word: string;
}

export interface SfProfile {
  /** The binomial the PAGE states, so a slug that redirected can be rejected. */
  statedBinomial?: string;
  adultSizeIn?: SfFigure<number>;
  lengthBasis?: LengthBasis;
  minVolumeGal?: SfFigure<number>;
  tankBaseIn?: SfFigure<{ length: number; width: number }>;
  tempC?: SfFigure<{ min: number; max: number }>;
  ph?: SfFigure<{ min: number; max: number }>;
  hardnessDgh?: SfFigure<{ min: number; max: number }>;
  /** SF's own editorial rating. Never quote-gated - see spec 045 section 3.3. */
  difficulty: SfDifficulty[];
}

/** SF uses en/em dashes for ranges and × for dimensions. */
const DASH = '[\\u2010-\\u2015\\u2212-]';
const N = '(\\d+(?:\\.\\d+)?)';

/**
 * Collapse a page to single-spaced text.
 *
 * Exported because the fetcher caches exactly this, and the gate re-finds
 * quotes in exactly this - three different readings of "the text" is how a
 * quote gate quietly stops matching.
 */
export function flatten(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First match, with the whole matched fragment kept as the quote. */
function grab(text: string, re: RegExp): { m: RegExpMatchArray; quote: string } | undefined {
  const m = text.match(re);
  if (!m || m.index === undefined) return undefined;
  return { m, quote: m[0].trim() };
}

export function parseSeriouslyFish(pageText: string): SfProfile {
  const t = pageText;
  const out: SfProfile = { difficulty: [] };

  /*
   * The binomial the page states, TAKEN FROM THE TITLE, which is the first
   * thing in the flattened text: `Acanthicus adonis (Polka Dot Lyre Tail
   * Pleco) · Seriously Fish`.
   *
   * `quoteFound` can prove a fragment is in the cached text; it cannot prove
   * whose page that text is, and a slug built from a superseded name can
   * redirect to a different species. So the page has to say.
   *
   * ANCHORED TO THE START ON PURPOSE. Scanning the body for the first
   * `Genus species` shape read the interface ("Switch to", from the metric
   * toggle) and, worse, read SUPERSEDED names out of the prose - it returned
   * "Acara heckelii" for the page about *Acarichthys heckelii*, which is the
   * old name mentioned in its own history. Both would have been rejected as
   * the wrong animal, and 95 of 126 pages were.
   */
  const bino = t.match(/^\s*([A-Z][a-z]+)\s+([a-z][a-z.'-]+)/);
  if (bino) out.statedBinomial = `${bino[1]} ${bino[2]}`;

  /*
   * Length. SF labels it by basis - "Standard length" or "Total length" - and
   * repeats the figure in mm then inches. Anchored on `in`, so the metric half
   * cannot be taken by accident.
   */
  const len = grab(t, new RegExp(`(Standard|Total|Maximum standard|Maximum total) length\\s+${N}\\s*mm\\s*(SL|TL)?\\s*${N}\\s*in\\s*(SL|TL)?`, 'i'));
  if (len) {
    /* Groups: 1 basis word, 2 mm, 3 SL/TL, 4 INCHES, 5 SL/TL. The inches are
       group 4 - reading group 3 here gave `Number("SL")`, and a NaN silently
       dropped every length on every page. */
    const inches = Number(len.m[4]);
    if (Number.isFinite(inches)) {
      out.adultSizeIn = { value: inches, quote: len.quote };
      const stated = (len.m[5] ?? len.m[3] ?? '').toUpperCase();
      out.lengthBasis = stated === 'SL' || stated === 'TL'
        ? (stated as LengthBasis)
        : /standard/i.test(len.m[1] ?? '') ? 'SL' : /total/i.test(len.m[1] ?? '') ? 'TL' : 'unstated';
    }
  }

  /*
   * Volume. THE FIELD THIS WHOLE EXERCISE IS FOR - 91.5% of addressable fish
   * lack it, and it is what gates screening a fish against a tank. Anchored on
   * `US gal`; the litres figure sitting beside it is exactly the trap.
   */
  const vol = grab(t, new RegExp(`Volume\\s*~?\\s*${N}\\s*(?:litres|liters|l)\\s*~?\\s*${N}\\s*US gal`, 'i'));
  if (vol) {
    const gal = Number(vol.m[2]);
    if (Number.isFinite(gal)) out.minVolumeGal = { value: gal, quote: vol.quote };
  }

  /* Footprint, distinct from volume: a 14-gallon tall is not a 24x12 base. */
  const base = grab(t, new RegExp(`(?:Aquarium|Tank) base\\s+${N}\\s*(?:\\u00d7|x)\\s*${N}\\s*cm\\s+${N}\\s*(?:\\u00d7|x)\\s*${N}\\s*in`, 'i'));
  if (base) {
    const length = Number(base.m[3]);
    const width = Number(base.m[4]);
    if (Number.isFinite(length) && Number.isFinite(width)) {
      out.tankBaseIn = { value: { length, width }, quote: base.quote };
    }
  }

  /* Temperature. Celsius is the one we store, and it is stated first. */
  const temp = grab(t, new RegExp(`Temp(?:erature)?\\s+${N}\\s*${DASH}\\s*${N}\\s*\\u00b0?\\s*C`, 'i'));
  if (temp) {
    const min = Number(temp.m[1]); const max = Number(temp.m[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) out.tempC = { value: { min, max }, quote: temp.quote };
  }

  /*
   * pH and hardness. THE FIGURES WITH NO UNIT TOKEN, which is why spec 045
   * calls them out: the existing `NUMBER_UNIT` matcher finds a figure by the
   * unit attached to it, and `5.0-7.5` has none. Anchored on the LABEL instead.
   */
  const ph = grab(t, new RegExp(`pH\\s+${N}\\s*${DASH}\\s*${N}`, 'i'));
  if (ph) {
    const min = Number(ph.m[1]); const max = Number(ph.m[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) out.ph = { value: { min, max }, quote: ph.quote };
  }

  const dgh = grab(t, new RegExp(`Hardness\\s+${N}\\s*${DASH}\\s*${N}\\s*dGH`, 'i'));
  if (dgh) {
    const min = Number(dgh.m[1]); const max = Number(dgh.m[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) out.hardnessDgh = { value: { min, max }, quote: dgh.quote };
  }

  /*
   * The six difficulty measures. SF's editorial judgement, with no sentence
   * behind it - stored attributed and NEVER passed through the quote gate,
   * because pretending an opinion is a sourced figure is the one thing the
   * gate exists to prevent.
   */
  /*
   * The six measures appear once, in a fixed order, as `Label word(s)` pairs.
   * SLICED BETWEEN THE LABELS rather than matched individually, and matched
   * CASE-SENSITIVELY, because the labels also occur inside the values: a
   * case-insensitive lookahead for the next label stops "tap water" at "tap",
   * since "water" is itself a label. The last measure has no following label,
   * which a lookahead-only rule drops entirely.
   */
  const diff = t.match(/Difficulty\s+\d+ of \d+ measures?([\s\S]{0,400})/i);
  if (diff) {
    const seg = diff[1] ?? '';
    const LABELS = ['Space', 'Water', 'Temp', 'Temperament', 'Social', 'Compatibility'];
    const found = LABELS
      .map((label) => ({ label, at: seg.search(new RegExp(`(?:^|\\s)${label}\\s`)) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at);

    for (const [i, hit] of found.entries()) {
      const start = hit.at + hit.label.length + 1;
      const end = i + 1 < found.length ? found[i + 1]!.at : seg.length;
      /*
       * Keep only the leading LOWERCASE words. The final measure has no label
       * after it, so its slice runs to the end of the window and picks up the
       * prose that follows - "community tank T" from "...community tank T.
       * heteromorpha was first exported...". A rating is always lowercase; the
       * next capital is where the block ended.
       */
      const word = (seg.slice(start, end).trim().match(/^[a-z][a-z]*(?: [a-z]+){0,2}/) ?? [''])[0];
      if (word) out.difficulty.push({ measure: hit.label.toLowerCase(), word });
    }
  }

  return out;
}

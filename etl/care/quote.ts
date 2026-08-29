/**
 * Quote verification: the mechanism that makes "sourced only" checkable.
 *
 * The catalog's stated rule is that it never invents a number. Until now that
 * has been enforced by a person writing values carefully. Extraction by a
 * language model over 1,029 species cannot be enforced that way, so it is
 * enforced here instead: every proposed value carries the verbatim sentence it
 * came from, and these functions prove that sentence exists in the cached
 * source text and that it actually contains the figure attributed to it.
 *
 * Two separate lies are being caught, and they need two separate checks:
 *
 *   1. A sentence that was never written. `quoteFound` greps it.
 *   2. A real sentence with a number bolted on that it does not support -
 *      "grows large" cited for 14 inches. `figureSupportedBy` re-derives the
 *      figure from the quote's own numbers and units.
 *
 * Neither check can tell whether the sentence is ABOUT the right animal, or
 * whether "reaches 35 cm" means standard or total length. Those stay with the
 * reviewer, which is what `confidence` and the review file are for.
 */

export type AggressionRating = 'peaceful' | 'semi-aggressive' | 'aggressive' | 'highly-aggressive';

/**
 * Fold away everything that varies between a rendered article and a quoted
 * sentence without changing what it says: case, whitespace runs, the several
 * dashes Wikipedia uses interchangeably, and curly quotes.
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    // Every Unicode space separator, not just U+00A0. Wikipedia puts a NARROW
    // no-break space (U+202F) before a degree sign in some articles and an ordinary
    // space in others, and a reader copying that sentence cannot see the
    // difference. Rejecting a correct quote over an invisible character is the
    // worst kind of false negative: nothing in the output shows why it failed.
    .replace(/\p{Zs}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Is this sentence actually in the text we cached for this species? */
export function quoteFound(quote: string, sourceText: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 12) return false; // too short to be evidence of anything
  return normalizeForMatch(sourceText).includes(q);
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const TO_INCHES: Record<string, number> = {
  mm: 1 / 25.4, cm: 1 / 2.54, m: 39.3701, in: 1, ins: 1, inch: 1, inches: 1,
  ft: 12, foot: 12, feet: 12,
  millimetre: 1 / 25.4, millimetres: 1 / 25.4, millimeter: 1 / 25.4, millimeters: 1 / 25.4,
  centimetre: 1 / 2.54, centimetres: 1 / 2.54, centimeter: 1 / 2.54, centimeters: 1 / 2.54,
  metre: 39.3701, metres: 39.3701, meter: 39.3701, meters: 39.3701,
};

const TO_GALLONS: Record<string, number> = {
  gal: 1, gals: 1, gallon: 1, gallons: 1,
  l: 1 / 3.785411784, litre: 1 / 3.785411784, litres: 1 / 3.785411784,
  liter: 1 / 3.785411784, liters: 1 / 3.785411784,
};

/**
 * `\+?` is not decoration. Stores and hobby prose write "a 10+ gallon tank"
 * and "20+ gallons" constantly, and without it every one of those figures
 * reads as unsupported and the value is thrown away.
 */
const NUMBER_UNIT = /(\d+(?:[.,]\d+)?)\+?\s*(?:\(|\s)?\s*([a-z°µ]+)/gi;

/**
 * Stores write "75 degrees F" where Wikipedia writes "24 °C". Without this the
 * unit reads as the word "degrees" and every vendor temperature is discarded
 * as unsupported - a silent loss of the one field vendors state most often.
 */
function foldDegreeWords(s: string): string {
  return s
    .replace(/\bdegrees?\s*(?:f\b|fahrenheit\b)/g, '°f')
    .replace(/\bdegrees?\s*(?:c\b|celsius\b|centigrade\b)/g, '°c')
    .replace(/°\s+/g, '°');
}

interface Figure {
  value: number;
  unit: string;
}

/** Every "<number> <unit>" pair in a sentence, in order. */
export function figuresIn(quote: string): Figure[] {
  const out: Figure[] = [];
  const norm = foldDegreeWords(normalizeForMatch(quote));
  for (const m of norm.matchAll(NUMBER_UNIT)) {
    const [, digits, unit] = m;
    if (!digits || !unit) continue;
    const value = Number(digits.replace(',', '.'));
    if (Number.isFinite(value)) out.push({ value, unit });
  }
  return out;
}

/**
 * Does the quote contain a figure that yields `claimed` in the target unit?
 *
 * Tolerance is deliberately loose. An article says 9 cm, a careful reader
 * writes 3.5 in, and the exact conversion is 3.543 - rejecting that would
 * reject correct work. It is tight enough that no unrelated number in the
 * sentence passes by accident.
 */
export function figureSupportedBy(
  claimed: number,
  kind: 'length-in' | 'volume-gal' | 'temp-c',
  quote: string,
): boolean {
  const table =
    kind === 'length-in' ? TO_INCHES : kind === 'volume-gal' ? TO_GALLONS : undefined;

  for (const f of figuresIn(quote)) {
    let converted: number | undefined;
    if (kind === 'temp-c') {
      if (f.unit === 'c' || f.unit === '°c') converted = f.value;
      else if (f.unit === 'f' || f.unit === '°f') converted = ((f.value - 32) * 5) / 9;
    } else {
      const factor = table![f.unit];
      if (factor !== undefined) converted = f.value * factor;
    }
    if (converted === undefined) continue;

    const tolerance = Math.max(Math.abs(claimed) * 0.06, kind === 'temp-c' ? 1 : 0.15);
    if (Math.abs(converted - claimed) <= tolerance) return true;
  }
  return false;
}

/**
 * A bare "22–28 °C" carries its unit only once, so the range needs its own
 * reader: the second number inherits the first's unit.
 */
export function rangeSupportedBy(min: number, max: number, quote: string): boolean {
  const norm = foldDegreeWords(normalizeForMatch(quote));
  // The unit letter is optional, because sources routinely omit it - and they
  // do not agree on what it means when they do. Wikipedia writes
  // "warm (24–28°)" meaning Celsius; vendor spec sheets write
  // "Temperature : 70-85°" meaning Fahrenheit. Defaulting to either one
  // silently discards every value written the other way.
  //
  // So a bare degree sign is checked under BOTH readings and passes if either
  // matches the claim. That is weaker than reading a stated unit, and it is
  // deliberately bounded: the claimed values must still clear the 4-40 °C
  // plausibility check in the caller, which is what makes the ambiguity
  // harmless in practice. 24-28 °F is ice and 70-85 °C is a kettle, so only
  // one reading of a real range ever survives both tests. Inferring a unit is
  // not inventing a value - the figures remain the source's own.
  // The word boundary applies only when a unit LETTER was matched. Requiring
  // it after a bare "°" fails at end-of-string, because there is no word
  // character on either side of the degree sign to bound.
  const ranges = norm.matchAll(
    /(\d+(?:\.\d+)?)\s*(?:-|to|and)\s*(\d+(?:\.\d+)?)\s*(?:°\s*(c|f)\b|°|\s(c|f)\b)/gi,
  );
  for (const m of ranges) {
    const [, lo, hi, unitA, unitB] = m;
    if (!lo || !hi) continue;
    const stated = (unitA ?? unitB)?.toLowerCase();
    const readings = stated ? [stated] : ['c', 'f'];
    for (const unit of readings) {
      const toC = (v: number) => (unit === 'f' ? ((v - 32) * 5) / 9 : v);
      if (Math.abs(toC(Number(lo)) - min) <= 1 && Math.abs(toC(Number(hi)) - max) <= 1) return true;
    }
  }
  // Fall back to two independent figures, for "between 22 °C and 28 °C".
  return figureSupportedBy(min, 'temp-c', quote) && figureSupportedBy(max, 'temp-c', quote);
}

// ---------------------------------------------------------------------------
// Temperament
// ---------------------------------------------------------------------------

/**
 * Words a source may use for each rating.
 *
 * Aggression is the weakest link in this pipeline: a taxonomy article
 * describing spawning behaviour in a river is not describing tankmate risk in
 * a 40-gallon, and no lexicon fixes that. What this does catch is a rating
 * asserted over a sentence that says nothing about temperament at all.
 */
const TEMPERAMENT_TERMS: Record<AggressionRating, RegExp> = {
  peaceful: /\b(peaceful|docile|non-?aggressive|gentle|community fish|good community)\b/,
  // "somewhat aggressive towards those of its own kind" is the single most
  // common way an article describes a semi-aggressive fish, and the first
  // version of this lexicon rejected every one of them.
  'semi-aggressive':
    /\b(semi-?aggressive|territorial|boisterous|feisty|nippy|fin-?nipp\w*|(moderately|somewhat|slightly|mildly|can be|may be) aggressive|aggressive (towards|toward) (its |their )?own)\b/,
  aggressive: /\b(aggressive|pugnacious|belligerent|combative|quarrelsome|hostile|will attack|may attack)\b/,
  'highly-aggressive': /\b(highly aggressive|extremely aggressive|very aggressive|predatory|vicious|will kill)\b/,
};

export const AGGRESSION_VALUES: AggressionRating[] = [
  'peaceful',
  'semi-aggressive',
  'aggressive',
  'highly-aggressive',
];

export function isAggressionRating(v: unknown): v is AggressionRating {
  return typeof v === 'string' && (AGGRESSION_VALUES as string[]).includes(v);
}

/** Does the quote use a word that supports this rating? */
export function temperamentSupportedBy(rating: AggressionRating, quote: string): boolean {
  return TEMPERAMENT_TERMS[rating].test(normalizeForMatch(quote));
}

// ---------------------------------------------------------------------------
// Plausibility
// ---------------------------------------------------------------------------

/**
 * Ranges wide enough to admit every real aquarium animal and narrow enough to
 * catch a unit error. Out-of-range values are rejected, never clamped: a
 * clamped value is a number this pipeline chose, which is the thing it must
 * not do.
 */
export const PLAUSIBLE = {
  'adult_size_in': { min: 0.2, max: 120 },
  // 10,000 gal, not 2,000. This catalog carries arapaima, sturgeon and a
  // goliath tigerfish, and a source really did state 4,000 gallons for the
  // last of those. A cap that rejects a true figure is not a safety check,
  // it is a silent data loss. Unit errors are caught by figureSupportedBy,
  // which re-derives the value from the quote; this is only a backstop.
  'min_volume_gal': { min: 1, max: 10000 },
  'temp_c': { min: 4, max: 40 },
} as const;

export function inRange(kind: keyof typeof PLAUSIBLE, value: number): boolean {
  const r = PLAUSIBLE[kind];
  return Number.isFinite(value) && value >= r.min && value <= r.max;
}

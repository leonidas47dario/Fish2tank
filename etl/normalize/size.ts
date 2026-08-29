/**
 * Parse a Shopify variant option into a real measurement.
 *
 * The stores express size as free text on the variant: "4 - 4.5 inches",
 * "3 inches", "1 inch", occasionally centimetres, and often not at all
 * ("Default Title", "Large", "Male").
 *
 * The governing rule is the same one the compatibility engine follows: an
 * unparseable size becomes UNDEFINED, never a guess. A qualitative "Large"
 * could be four inches or fourteen depending on the species, and the price
 * engine already excludes size-unknown listings from comparison rather than
 * mis-comparing a juvenile against an adult. Guessing here would silently
 * poison every downstream median.
 */
import type { LengthMeasurement } from '@/domain/types';

/** Option values that explicitly carry no size information. */
const NON_SIZE = new Set([
  'default title', 'title', 'male', 'female', 'unsexed', 'pair', 'each',
  'small', 'medium', 'large', 'xl', 'xxl', 's', 'm', 'l',
  'regular', 'standard', 'assorted', 'random', 'one', 'single',
]);

/** Half an inch is written both "0.5" and ".5", so the leading digit is optional. */
const NUM = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;

/**
 * The inch mark, in every character a store actually types.
 *
 * U+0022 is the straight quote a keyboard produces. U+201D is what a word
 * processor autocorrects it into, and U+2033 is the typographically correct
 * prime. Imperial Tropicals emits all of the first two in the same option
 * list - `2-3" Unsexed` and `2-3” Unsexed` are the same band on neighbouring
 * variants - so knowing only the straight quote dropped 1,051 listings across
 * 73 species while their siblings parsed.
 */
const INCH = String.raw`(?:in\b|inch(?:es)?|["”″])`;
const CM = String.raw`(?:cm\b|centimet(?:er|re)s?)`;

/**
 * Ranges are reduced to their midpoint, because a price is quoted for the
 * whole band and the midpoint is the least-wrong single value. The original
 * text is preserved separately by the caller, so nothing is lost.
 *
 * EVERY PATTERN IS ANCHORED, and that is load-bearing rather than incidental.
 * Unanchoring picks up a few real sizes and, in the same pass, reads the
 * dimensions of whatever the animal is attached to: "1 Java Moss Portion on
 * 3\" Cholla Wood" is not a three-inch anything, and "Aquatic Curved Scissors
 * 10\"" is not livestock. It also swallows "(10 Pack) 1-2\" Unsexed", where
 * the stated price buys ten fish, not one. See the guard tests in size.test.ts.
 */
const PATTERNS: Array<{ re: RegExp; unit: 'in' | 'cm'; range: boolean }> = [
  // "4 - 4.5 inches", "4-4.5in", "4 to 4.5 inch"
  { re: new RegExp(String.raw`^(${NUM})\s*(?:-|–|—|to)\s*(${NUM})\s*${INCH}`, 'i'), unit: 'in', range: true },
  { re: new RegExp(String.raw`^(${NUM})\s*(?:-|–|—|to)\s*(${NUM})\s*${CM}`, 'i'), unit: 'cm', range: true },
  // "3 inches", "1 inch", '4"', "4 in"
  { re: new RegExp(String.raw`^(${NUM})\s*${INCH}`, 'i'), unit: 'in', range: false },
  { re: new RegExp(String.raw`^(${NUM})\s*${CM}`, 'i'), unit: 'cm', range: false },
];

export interface ParsedSize {
  size?: LengthMeasurement;
  /** The original option text, always retained. */
  label: string;
}

export function parseSize(raw: string | undefined | null): ParsedSize {
  const label = (raw ?? '').trim();
  if (!label) return { label: '' };

  const lower = label.toLowerCase();
  if (NON_SIZE.has(lower)) return { label };

  for (const { re, unit, range } of PATTERNS) {
    const m = re.exec(lower);
    if (!m) continue;
    const a = Number(m[1]);
    if (!Number.isFinite(a) || a <= 0) continue;
    if (range) {
      const b = Number(m[2]);
      if (!Number.isFinite(b) || b <= 0) continue;
      // Midpoint of the advertised band.
      return { size: { value: Math.round(((a + b) / 2) * 100) / 100, unit, estimate: true }, label };
    }
    return { size: { value: a, unit, estimate: true }, label };
  }

  // A bare number with no unit is ambiguous - it could be a quantity, a count,
  // or a size. Left unknown deliberately.
  return { label };
}

/** Sizes are always estimates: they come from a listing band, not a measurement. */
export function isUsableSize(p: ParsedSize): boolean {
  return p.size !== undefined;
}

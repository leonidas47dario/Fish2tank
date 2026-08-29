import { describe, expect, it } from 'vitest';
import { parseSize } from './size';

const size = (s: string | undefined | null) => parseSize(s).size;

describe('inch sizes', () => {
  it('parses a plain inch value', () => {
    expect(size('3 inches')).toEqual({ value: 3, unit: 'in', estimate: true });
    expect(size('1 inch')).toEqual({ value: 1, unit: 'in', estimate: true });
    expect(size('1.5 inches')).toEqual({ value: 1.5, unit: 'in', estimate: true });
  });

  it('parses abbreviated and symbol forms', () => {
    expect(size('4in')).toEqual({ value: 4, unit: 'in', estimate: true });
    expect(size('4 in')).toEqual({ value: 4, unit: 'in', estimate: true });
    expect(size('4"')).toEqual({ value: 4, unit: 'in', estimate: true });
  });

  it('reduces an advertised band to its midpoint', () => {
    // The three commonest option values across all three stores.
    expect(size('4 - 4.5 inches')).toEqual({ value: 4.25, unit: 'in', estimate: true });
    expect(size('3 - 3.5 inches')).toEqual({ value: 3.25, unit: 'in', estimate: true });
    expect(size('8 - 9 inches')).toEqual({ value: 8.5, unit: 'in', estimate: true });
  });

  it('accepts the dash variants stores actually use', () => {
    expect(size('2-2.5 inches')?.value).toBe(2.25);
    expect(size('2 – 2.5 inches')?.value).toBe(2.25);
    expect(size('2 to 2.5 inches')?.value).toBe(2.25);
  });

  it('is case insensitive', () => {
    expect(size('5 INCHES')?.value).toBe(5);
    expect(size('5 Inches')?.value).toBe(5);
  });
});

describe('centimetre sizes', () => {
  it('parses cm and keeps the unit', () => {
    expect(size('10 cm')).toEqual({ value: 10, unit: 'cm', estimate: true });
    expect(size('10-12cm')).toEqual({ value: 11, unit: 'cm', estimate: true });
  });
});

describe('values that carry no size', () => {
  it('returns undefined for the placeholder title', () => {
    // 625 variants across the three stores use this.
    expect(size('Default Title')).toBeUndefined();
  });

  it('refuses to guess a number for qualitative sizes', () => {
    // "Large" is 4in on a goby and 14in on a bichir. Guessing would poison
    // every median downstream.
    for (const v of ['Small', 'Medium', 'Large', 'XL', 'XXL', 'S', 'M', 'L']) {
      expect(size(v)).toBeUndefined();
    }
  });

  it('returns undefined for sex and packaging options', () => {
    for (const v of ['Male', 'Female', 'Unsexed', 'Pair', 'Each', 'Assorted']) {
      expect(size(v)).toBeUndefined();
    }
  });

  it('refuses a bare number with no unit', () => {
    // "2" could be a size, a quantity or a lot count.
    expect(size('2')).toBeUndefined();
    expect(size('12')).toBeUndefined();
  });

  it('handles empty and missing input', () => {
    expect(size('')).toBeUndefined();
    expect(size(undefined)).toBeUndefined();
    expect(size(null)).toBeUndefined();
  });

  it('rejects a nonsensical zero or negative size', () => {
    expect(size('0 inches')).toBeUndefined();
  });
});

describe('label retention', () => {
  it('always keeps the original text, parsed or not', () => {
    expect(parseSize('4 - 4.5 inches').label).toBe('4 - 4.5 inches');
    expect(parseSize('Large').label).toBe('Large');
    expect(parseSize('  3 inches  ').label).toBe('3 inches');
  });
});

describe('every size is flagged an estimate', () => {
  it('marks parsed sizes as estimates, because a listing band is not a measurement', () => {
    expect(size('4 - 4.5 inches')?.estimate).toBe(true);
    expect(size('3 inches')?.estimate).toBe(true);
  });
});

describe('formats the newer vendors use', () => {
  it('parses Imperial Tropicals size-and-sex options', () => {
    expect(size('1-2" Unsexed')).toEqual({ value: 1.5, unit: 'in', estimate: true });
    expect(size('3-4" Unsexed')).toEqual({ value: 3.5, unit: 'in', estimate: true });
  });

  it('refuses Aquatic Arts quantity and sex options, which carry no size', () => {
    for (const v of ['1 Male', '1 Female', 'School of 3', '1 Fish', 'Pack of 6']) {
      expect(size(v)).toBeUndefined();
    }
  });

  it('accepts the typographic inch mark, not just the straight quote', () => {
    // Imperial Tropicals writes a right double quotation mark (U+201D), not
    // U+0022. Both spellings appear in the same store's option list, so a
    // parser that only knows the straight quote silently drops 1,051 listings
    // across 73 species while its neighbours parse fine.
    expect(size('1-2” Unsexed')).toEqual({ value: 1.5, unit: 'in', estimate: true });
    expect(size('3-4” Male')).toEqual({ value: 3.5, unit: 'in', estimate: true });
    // U+2033, the double prime, is the typographically correct inch mark.
    expect(size('4″')).toEqual({ value: 4, unit: 'in', estimate: true });
  });

  it('accepts a value written with a leading decimal point', () => {
    // ".5-1in" is how a few stores write half an inch. \d+ requires a digit
    // before the point, so these parsed as nothing at all.
    expect(size('.5 inch')).toEqual({ value: 0.5, unit: 'in', estimate: true });
    expect(size('.5-1in')).toEqual({ value: 0.75, unit: 'in', estimate: true });
    // Midpoints keep the existing 2dp rounding: 0.875 stores as 0.88.
    expect(size('.75 - 1 inch')).toEqual({ value: 0.88, unit: 'in', estimate: true });
  });
});

describe('sizes that belong to something other than the animal', () => {
  /**
   * Every pattern is anchored at the start of the option, and these are why.
   * Unanchoring recovers a handful of real sizes and, in exchange, reads the
   * dimensions of the hardware the animal is sold attached to.
   */
  it('never takes a measurement from the substrate or the tooling', () => {
    for (const v of [
      '1 Java Moss Portion on 3" Cholla Wood',
      '2 Plants on 6-8" Driftwoods',
      'Aquatic Curved Scissors  10"',
      'Moss On Circle (2") - Black',
      '4x2 inch Mat',
    ]) {
      expect(size(v)).toBeUndefined();
    }
  });

  /**
   * A multi-pack price is for the whole pack. "(10 Pack) 1-2\" Unsexed" runs
   * from $24.99 to $1,799.99 across the catalogue, so reading the 1.5in and
   * keeping the pack price would put ten fish into the price ladder at the
   * size of one. Left unparsed until the per-unit price is modelled.
   */
  it('refuses a multi-pack option even though it states a size', () => {
    for (const v of ['(3 Pack) 1-2" Unsexed', '(10 Pack) 0.5-1" Unsexed', '(50 Pack) 0.25-0.75" Unsexed']) {
      expect(size(v)).toBeUndefined();
    }
  });
});

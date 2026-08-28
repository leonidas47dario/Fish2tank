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

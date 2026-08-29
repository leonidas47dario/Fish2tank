import { describe, expect, it } from 'vitest';
import {
  figureSupportedBy,
  figuresIn,
  inRange,
  isAggressionRating,
  normalizeForMatch,
  quoteFound,
  rangeSupportedBy,
  temperamentSupportedBy,
} from './quote';

// The real cached text for Trichogaster labiosa, as stripWikitext renders it.
const SOURCE = `
Description

Thick-lipped gouramis can reach a length of 9 cm TL. They are sexually dimorphic.

In the aquarium

It is a generally peaceful fish for a tropical community aquarium. It is kept
in water that ranges from 22–28 °C and that is soft (50 mg/L).
`;

describe('quoteFound', () => {
  it('finds a sentence that is really in the source', () => {
    expect(quoteFound('can reach a length of 9 cm TL', SOURCE)).toBe(true);
  });

  it('tolerates whitespace and dash differences, which are not lies', () => {
    expect(quoteFound('ranges  from 22-28 °C', SOURCE)).toBe(true);
  });

  it('rejects a sentence that was never written', () => {
    expect(quoteFound('requires a minimum tank of 55 gallons', SOURCE)).toBe(false);
  });

  it('rejects a quote too short to be evidence', () => {
    expect(quoteFound('9 cm', SOURCE)).toBe(false);
  });
});

describe('figuresIn', () => {
  it('reads every number and unit in a sentence', () => {
    expect(figuresIn('grows to 35 cm (14 in) long')).toEqual([
      { value: 35, unit: 'cm' },
      { value: 14, unit: 'in' },
    ]);
  });
});

describe('figureSupportedBy', () => {
  it('accepts a correct conversion from the quoted unit', () => {
    // 9 cm is 3.543 in; a reader writing 3.5 is right.
    expect(figureSupportedBy(3.5, 'length-in', 'can reach a length of 9 cm TL')).toBe(true);
  });

  it('accepts the figure stated directly', () => {
    expect(figureSupportedBy(14, 'length-in', 'a maximum length of 35 cm (14 in)')).toBe(true);
  });

  it('rejects a figure the quote does not support', () => {
    expect(figureSupportedBy(14, 'length-in', 'can reach a length of 9 cm TL')).toBe(false);
  });

  it('rejects a figure cited to a sentence carrying no number at all', () => {
    expect(figureSupportedBy(14, 'length-in', 'this species grows very large indeed')).toBe(false);
  });

  it('does not let an unrelated number in the sentence pass', () => {
    // pH 6.5 must not be mistaken for a 6.5 inch fish.
    expect(figureSupportedBy(6.5, 'length-in', 'water that is acidic (pH 6.5) and soft')).toBe(false);
  });

  it('converts litres to gallons', () => {
    expect(figureSupportedBy(20, 'volume-gal', 'a tank of at least 75 litres')).toBe(true);
  });

  it('reads "10+ gallon", which is how hobby prose states a minimum', () => {
    expect(figureSupportedBy(10, 'volume-gal', 'it usually requires a 10+ gallon aquarium')).toBe(true);
  });

  it('converts fahrenheit to celsius', () => {
    expect(figureSupportedBy(24, 'temp-c', 'Suggested Water Temperature: 75 degrees F')).toBe(true);
  });
});

describe('rangeSupportedBy', () => {
  it('reads a range whose unit is stated once', () => {
    expect(rangeSupportedBy(22, 28, 'water that ranges from 22–28 °C')).toBe(true);
  });

  it('reads a fahrenheit range', () => {
    expect(rangeSupportedBy(22, 26, 'Suggested Water Temperature: 72 to 78 F')).toBe(true);
  });

  it('rejects a range the quote does not state', () => {
    expect(rangeSupportedBy(10, 15, 'water that ranges from 22–28 °C')).toBe(false);
  });

  it('reads a bare degree sign as celsius when the source means celsius', () => {
    // Wikipedia: "Living in alkalescent, warm (24–28°), and slow-flowing rivers"
    expect(rangeSupportedBy(24, 28, 'warm (24–28°), and slow-flowing rivers')).toBe(true);
  });

  it('reads the same bare degree sign as fahrenheit when the source means that', () => {
    // Vendor spec sheets write "Temperature : 70-85°" and mean fahrenheit.
    // Defaulting to one reading discards every value written the other way.
    expect(rangeSupportedBy(21, 29, 'Temperature : 70-85°')).toBe(true);
  });

  it('still rejects a claim neither reading of a bare sign supports', () => {
    expect(rangeSupportedBy(10, 12, 'Temperature : 70-85°')).toBe(false);
  });
});

describe('temperamentSupportedBy', () => {
  it('accepts a rating the sentence actually uses a word for', () => {
    expect(temperamentSupportedBy('peaceful', 'It is a generally peaceful fish')).toBe(true);
  });

  it('accepts territorial as evidence of semi-aggressive', () => {
    expect(temperamentSupportedBy('semi-aggressive', 'Males are territorial when spawning')).toBe(true);
  });

  it('rejects a rating asserted over a sentence about something else', () => {
    expect(temperamentSupportedBy('aggressive', 'It is native to south Myanmar')).toBe(false);
  });

  it('rejects a rating the sentence contradicts', () => {
    expect(temperamentSupportedBy('highly-aggressive', 'It is a generally peaceful fish')).toBe(false);
  });

  it('accepts "somewhat aggressive" as semi-aggressive, the commonest phrasing', () => {
    expect(temperamentSupportedBy('semi-aggressive', 'it becomes somewhat aggressive towards those of its own kind'))
      .toBe(true);
  });

  it('accepts "hostile to most other inhabitants" as aggressive', () => {
    expect(temperamentSupportedBy('aggressive', 'are hostile to most other inhabitants')).toBe(true);
  });
});

describe('isAggressionRating', () => {
  it('accepts the four domain values', () => {
    expect(isAggressionRating('semi-aggressive')).toBe(true);
  });
  it('rejects anything else, including plausible-sounding invention', () => {
    expect(isAggressionRating('mildly-grumpy')).toBe(false);
    expect(isAggressionRating('Peaceful')).toBe(false);
  });
});

describe('inRange', () => {
  it('accepts real aquarium figures', () => {
    expect(inRange('adult_size_in', 14)).toBe(true);
    expect(inRange('min_volume_gal', 55)).toBe(true);
    expect(inRange('temp_c', 26)).toBe(true);
  });

  it('rejects a unit error rather than clamping it', () => {
    // 350 "inches" is a centimetre figure that never got converted.
    expect(inRange('adult_size_in', 350)).toBe(false);
    expect(inRange('temp_c', 78)).toBe(false); // fahrenheit left unconverted
  });

  it('rejects a non-finite value', () => {
    expect(inRange('adult_size_in', Number.NaN)).toBe(false);
  });
});

describe('normalizeForMatch', () => {
  it('folds the several dashes Wikipedia uses interchangeably', () => {
    expect(normalizeForMatch('22–28')).toBe(normalizeForMatch('22-28'));
  });
});

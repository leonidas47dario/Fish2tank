import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSeriouslyFish } from './seriously-fish';
import { matchSlugs, sfSlugFor } from '../care/seriously-fish-slugs';

/**
 * Spec 045. Reading a Seriously Fish profile.
 *
 * The fixture is the real flattened page for *Trigonostigma heteromorpha*, the
 * worked example in the spec, so the expected figures are the ones the spec
 * quotes rather than ones invented to match the parser.
 *
 * THE HAZARD BEING GUARDED IS UNIT CONFUSION. SF prints both systems in one
 * cell - `~54 litres ~14 US gal` - so a matcher that takes "the first number"
 * is wrong by a factor of 3.9 on volume and 25 on length, and both wrong
 * values are inside the plausible range. Bounds cannot catch this; only
 * anchoring to the unit can.
 */
const FIXTURE = readFileSync(join(__dirname, '__fixtures__/trigonostigma-heteromorpha.txt'), 'utf8');

describe('parseSeriouslyFish (spec 045)', () => {
  const p = parseSeriouslyFish(FIXTURE);

  it('TAKES THE IMPERIAL HALF OF EVERY DUAL-UNIT CELL', () => {
    // 14 US gal, not 54 litres. 1.8 in, not 45 mm. Both wrong readings are
    // plausible numbers, which is exactly why this is the first test.
    expect(p.minVolumeGal?.value).toBe(14);
    expect(p.adultSizeIn?.value).toBe(1.8);
    expect(p.tankBaseIn?.value).toEqual({ length: 24, width: 12 });
  });

  it('carries the verbatim cell as the quote', () => {
    expect(p.minVolumeGal?.quote).toBe('Volume ~54 litres ~14 US gal');
    // And the quote is really in the text it came from - what the gate checks.
    expect(FIXTURE).toContain(p.minVolumeGal!.quote);
  });

  it('records the length basis, which the figure is meaningless without', () => {
    // A compatibility engine mixing SL and TL is quietly wrong for every
    // deep-bodied fish.
    expect(p.lengthBasis).toBe('SL');
  });

  it('reads the figures that carry no unit token', () => {
    // pH and dGH defeat a unit-anchored matcher, so they are label-anchored.
    expect(p.ph?.value).toEqual({ min: 5, max: 7.5 });
    expect(p.hardnessDgh?.value).toEqual({ min: 1, max: 12 });
  });

  it('reads temperature in celsius, not the fahrenheit beside it', () => {
    expect(p.tempC?.value).toEqual({ min: 21, max: 28 });
  });

  it('reads all six difficulty measures, including the last', () => {
    // The last has no label after it, so a lookahead-only rule dropped it; and
    // "tap water" was truncated to "tap" because "water" is itself a label.
    expect(p.difficulty).toEqual([
      { measure: 'space', word: 'modest tank' },
      { measure: 'water', word: 'tap water' },
      { measure: 'temp', word: 'unfussy' },
      { measure: 'temperament', word: 'peaceful' },
      { measure: 'social', word: 'shoal' },
      { measure: 'compatibility', word: 'community tank' },
    ]);
  });

  it('TAKES THE BINOMIAL FROM THE TITLE, not from the prose', () => {
    // Scanning the body found the metric toggle ("Switch to") and superseded
    // names quoted in a species' own history - "Acara heckelii" on the page
    // about Acarichthys heckelii. 95 of 126 pages were rejected as the wrong
    // animal because of it.
    expect(p.statedBinomial).toBe('Trigonostigma heteromorpha');
  });

  it('returns nothing rather than guessing when a page has no facts', () => {
    const empty = parseSeriouslyFish('Some article about aquascaping. Nothing here.');
    expect(empty.minVolumeGal).toBeUndefined();
    expect(empty.adultSizeIn).toBeUndefined();
    expect(empty.difficulty).toEqual([]);
  });

  it('survives a half-written cell without inventing a value', () => {
    expect(parseSeriouslyFish('Volume ~54 litres').minVolumeGal).toBeUndefined();
    expect(parseSeriouslyFish('pH 5.0').ph).toBeUndefined();
  });
});

describe('matching our catalog to SF slugs (spec 045)', () => {
  it('slugifies a binomial the way SF does', () => {
    expect(sfSlugFor('Trigonostigma heteromorpha')).toBe('trigonostigma-heteromorpha');
  });

  it('matches exactly, and falls back to a UNIQUE epithet', () => {
    const { matches } = matchSlugs(
      [
        { speciesId: 'a', scientificName: 'Trigonostigma heteromorpha' },
        { speciesId: 'b', scientificName: 'Hoplisoma adolfoi' },
      ],
      ['trigonostigma-heteromorpha', 'corydoras-adolfoi'],
    );
    expect(matches).toEqual([
      { speciesId: 'a', scientificName: 'Trigonostigma heteromorpha', slug: 'trigonostigma-heteromorpha', how: 'exact' },
    ]);
  });

  it('REFUSES A SHARED EPITHET even when only one slug carries it', () => {
    /*
     * Spec 060, and the case the old test missed.
     *
     * It asserted this refusal with TWO `niger` slugs, which the epithet
     * fallback declined as ambiguous - so it passed while proving only the
     * safe case. With ONE slug the fallback took it, and the real run shows
     * that was the common case: 79 candidates, 74 a different animal.
     *
     * `Esox niger` is a pickerel; `Oxydoras niger` is a catfish. That "niger"
     * appears exactly once on seriouslyfish.com is not evidence they are the
     * same fish.
     */
    const { matches, absent } = matchSlugs(
      [{ speciesId: 'a', scientificName: 'Esox niger' }],
      ['oxydoras-niger'],
    );
    expect(matches).toEqual([]);
    expect(absent).toBe(1);
  });

  it('takes a trinomial slug only when the genus matches too', () => {
    // SF files some species under the nominate subspecies. Requiring both
    // parts is what makes this a rule rather than the guess it replaced.
    const { matches } = matchSlugs(
      [
        { speciesId: 'a', scientificName: 'Polypterus endlicheri' },
        { speciesId: 'b', scientificName: 'Erpetoichthys endlicheri' },
      ],
      ['polypterus-endlicheri-endlicheri'],
    );
    expect(matches).toEqual([
      {
        speciesId: 'a', scientificName: 'Polypterus endlicheri',
        slug: 'polypterus-endlicheri-endlicheri', how: 'trinomial',
      },
    ]);
  });

  it('uses a curated correspondence where no rule can reach', () => {
    // SF's slug drops a letter from the genus, so neither half matches.
    const { matches } = matchSlugs(
      [{ speciesId: 'a', scientificName: 'Axelrodia riesei' }],
      ['axelrodi-riesei'],
    );
    expect(matches).toEqual([
      { speciesId: 'a', scientificName: 'Axelrodia riesei', slug: 'axelrodi-riesei', how: 'curated' },
    ]);
  });

  it('does not invent a curated slug SF does not actually publish', () => {
    const { matches, absent } = matchSlugs(
      [{ speciesId: 'a', scientificName: 'Axelrodia riesei' }],
      ['some-other-fish'],
    );
    expect(matches).toEqual([]);
    expect(absent).toBe(1);
  });

  it('counts a species SF has never written about', () => {
    const { matches, absent } = matchSlugs(
      [{ speciesId: 'a', scientificName: 'Amphiprion ocellaris' }],
      ['trigonostigma-heteromorpha'],
    );
    expect(matches).toEqual([]);
    expect(absent).toBe(1);
  });
});

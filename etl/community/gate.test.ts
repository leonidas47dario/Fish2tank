import { describe, expect, it } from 'vitest';
import { checkSubmission, findCatalogMatches, normalise, type CatalogEntry, type Submission } from './gate';

const CATALOG: CatalogEntry[] = [
  { speciesId: 'sp_congo_tetra', commonName: 'Congo Tetra', scientificName: 'Phenacogrammus interruptus', aliases: ['Congo'] },
  { speciesId: 'sp_neon_tetra', commonName: 'Neon Tetra', scientificName: 'Paracheirodon innesi', aliases: [] },
  { speciesId: 'sp_wolf_fish', commonName: 'Wolf Fish', scientificName: 'Hoplias malabaricus', aliases: ['Trahira'] },
];

const sub = (over: Partial<Submission> = {}): Submission => ({
  id: 'sp_user_1',
  commonName: 'Sailfin Pleco L083',
  aliases: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  specimenCount: 1,
  ...over,
});

describe('normalise', () => {
  it('strips case and punctuation for comparison only', () => {
    expect(normalise('  Congo-Tetra!  ')).toBe('congo tetra');
    expect(normalise("St. Peter's Fish")).toBe('st peter s fish');
  });
});

describe('finding catalog matches', () => {
  it('matches an exact common name regardless of case and spacing', () => {
    const hits = findCatalogMatches(sub({ commonName: '  congo tetra ' }), CATALOG);
    expect(hits[0]?.speciesId).toBe('sp_congo_tetra');
  });

  it('matches on an alias', () => {
    expect(findCatalogMatches(sub({ commonName: 'Trahira' }), CATALOG)[0]?.speciesId).toBe('sp_wolf_fish');
  });

  it('matches on the scientific name the keeper typed', () => {
    const hits = findCatalogMatches(
      sub({ commonName: 'Some tetra', scientificName: 'Phenacogrammus interruptus' }),
      CATALOG,
    );
    expect(hits[0]?.speciesId).toBe('sp_congo_tetra');
  });

  it('finds a partial overlap the keeper spelled differently', () => {
    // "Congo tetra (male)" should still surface the catalog's Congo Tetra.
    const hits = findCatalogMatches(sub({ commonName: 'Congo tetra male' }), CATALOG);
    expect(hits[0]?.speciesId).toBe('sp_congo_tetra');
  });

  it('does not match an unrelated fish', () => {
    expect(findCatalogMatches(sub({ commonName: 'Sailfin Pleco L083' }), CATALOG)).toEqual([]);
  });

  /**
   * The failure that would make this tool useless: a common word dragging in
   * every entry that happens to share it.
   */
  it('does not match on a stop word alone', () => {
    expect(findCatalogMatches(sub({ commonName: 'Live Fish' }), CATALOG)).toEqual([]);
  });
});

describe('the submission gate', () => {
  it('accepts a species the catalog does not have', () => {
    expect(checkSubmission(sub(), CATALOG)).toEqual({ verdict: 'accept' });
  });

  it('flags an exact duplicate for review rather than rejecting it outright', () => {
    const v = checkSubmission(sub({ commonName: 'Congo Tetra' }), CATALOG);
    expect(v.verdict).toBe('review');
    if (v.verdict === 'review') {
      expect(v.reason).toMatch(/already has/i);
      expect(v.matches?.[0]?.speciesId).toBe('sp_congo_tetra');
    }
  });

  it('flags a probable duplicate with the entry it might be', () => {
    const v = checkSubmission(sub({ commonName: 'Congo tetra male' }), CATALOG);
    expect(v.verdict).toBe('review');
    if (v.verdict === 'review') expect(v.reason).toMatch(/may already be/i);
  });

  it.each([
    ['', 'blank'],
    ['??', 'punctuation only'],
    ['ab', 'too short'],
    ['unknown', 'a placeholder'],
    ['test', 'a placeholder'],
    ['2.5', 'a number'],
    ['12 inch', 'a size'],
  ])('rejects %j (%s)', (name) => {
    expect(checkSubmission(sub({ commonName: name }), CATALOG).verdict).toBe('reject');
  });

  /**
   * A single sighting is exactly what this pipeline is for. Requiring two
   * would filter out the rarest fish, which are the ones the catalog is most
   * likely to be missing.
   */
  it('accepts a species seen only once', () => {
    expect(checkSubmission(sub({ specimenCount: 1 }), CATALOG).verdict).toBe('accept');
  });
});

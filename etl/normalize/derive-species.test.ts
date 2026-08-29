import { describe, expect, it } from 'vitest';
import { deriveCommonName, derivedSpeciesId, discoverSpecies } from './derive-species';

describe('derivedSpeciesId', () => {
  it('is a stable, readable slug', () => {
    expect(derivedSpeciesId('Pterophyllum scalare')).toBe('sp_pterophyllum_scalare');
    expect(derivedSpeciesId('Potamotrygon leopoldi')).toBe('sp_potamotrygon_leopoldi');
  });
  it('gives the same id for the same binomial every run', () => {
    expect(derivedSpeciesId('Astronotus ocellatus')).toBe(derivedSpeciesId('Astronotus ocellatus'));
  });
  it('handles trinomials and odd spacing', () => {
    expect(derivedSpeciesId('Panaque nigrolineatus laurafabianae'))
      .toBe('sp_panaque_nigrolineatus_laurafabianae');
    expect(derivedSpeciesId('  Heros  efasciatus ')).toBe('sp_heros_efasciatus');
  });
});

describe('deriveCommonName', () => {
  it('finds the name shared by wildly different trade titles', () => {
    // Real Pterophyllum scalare titles: no single one is the species name.
    expect(deriveCommonName([
      'Red Devil koi Angelfish', 'Black Angelfish', 'Koi Angelfish', 'Platinum Angelfish',
    ])).toBe('Angelfish');
  });

  it('prefers the longer shared name', () => {
    expect(deriveCommonName([
      'Kelberi Peacock Bass', 'Azul Peacock Bass', 'Monoculus Peacock Bass',
    ])).toBe('Peacock Bass');
  });

  it('refuses a suffix that is only decoration', () => {
    // "Albino" and "Golden" describe a morph, not a species.
    expect(deriveCommonName(['Something Albino', 'Another Albino'])).not.toBe('Albino');
  });

  it('ignores the binomial and stock codes when deriving', () => {
    // All three really are tiger oscars, so the full shared tail is the better
    // name - the point of the test is that "(Astronotus ocellatus)" and "#A1"
    // are stripped before matching.
    expect(deriveCommonName([
      'Albino Lemon Tiger Oscar Cichlid (Astronotus ocellatus) #A1',
      'Red Tiger Oscar Cichlid (Astronotus ocellatus)',
      'Tiger Oscar Cichlid (Astronotus ocellatus)',
    ])).toBe('Tiger Oscar Cichlid');
  });

  it('drops a longer tail that only some listings share', () => {
    // Only two of four are tiger oscars, so the name common to all wins.
    expect(deriveCommonName([
      'Tiger Oscar Cichlid', 'Red Tiger Oscar Cichlid',
      'Albino Oscar Cichlid', 'Lemon Oscar Cichlid',
    ])).toBe('Oscar Cichlid');
  });

  it('returns undefined when titles share nothing, rather than picking one', () => {
    expect(deriveCommonName(['Completely Different', 'Nothing Alike Here'])).toBeUndefined();
  });

  it('handles an empty list', () => {
    expect(deriveCommonName([])).toBeUndefined();
  });
});

describe('discoverSpecies', () => {
  const listings = [
    { scientificNameInTitle: 'Pterophyllum scalare', title: 'Koi Angelfish (Pterophyllum scalare)' },
    { scientificNameInTitle: 'Pterophyllum scalare', title: 'Black Angelfish (Pterophyllum scalare)' },
    { scientificNameInTitle: 'Astronotus ocellatus', title: 'Tiger Oscar (Astronotus ocellatus)' },
    { scientificNameInTitle: undefined, title: 'Mystery Box' },
  ];

  it('mints one species per distinct binomial', () => {
    const found = discoverSpecies(listings, new Set());
    expect(found).toHaveLength(2);
    expect(found[0]!.speciesId).toBe('sp_pterophyllum_scalare');
    expect(found[0]!.listings).toBe(2);
  });

  it('orders by how often the vendors list it', () => {
    const found = discoverSpecies(listings, new Set());
    expect(found[0]!.scientificName).toBe('Pterophyllum scalare');
  });

  it('skips species that already have a curated profile', () => {
    // The hand-written entry stays authoritative; discovery must not shadow it.
    const found = discoverSpecies(listings, new Set(['pterophyllum scalare']));
    expect(found.map((f) => f.scientificName)).toEqual(['Astronotus ocellatus']);
  });

  it('ignores listings with no binomial', () => {
    expect(discoverSpecies(listings, new Set()).some((f) => f.commonName === 'Mystery Box')).toBe(false);
  });

  it('keeps trade names as aliases so search still finds them', () => {
    const found = discoverSpecies(listings, new Set());
    expect(found[0]!.aliases).toContain('Koi Angelfish (Pterophyllum scalare)');
  });

  it('falls back to the scientific name when no common name can be derived', () => {
    const odd = [
      { scientificNameInTitle: 'Genus species', title: 'Alpha (Genus species)' },
      { scientificNameInTitle: 'Genus species', title: 'Beta (Genus species)' },
    ];
    expect(discoverSpecies(odd, new Set())[0]!.commonName).toBe('Genus species');
  });
});

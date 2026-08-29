import { describe, expect, it } from 'vitest';
import { canonicalSpeciesId, deriveCommonName, derivedSpeciesId, discoverSpecies } from './derive-species';
import { SPECIES_SYNONYMS, SYNONYM_IDS } from '@/data/seed/species-overrides';

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

describe('canonicalSpeciesId', () => {
  it('folds a misspelled binomial onto the record the catalog actually shows', () => {
    // Three spellings of one fish. build-marts drops the first two from the
    // catalog, so any listing left pointing at them is a price nobody can see.
    expect(canonicalSpeciesId('sp_symphysodon_aequifaciatus')).toBe('sp_symphysodon_aequifasciatus');
    expect(canonicalSpeciesId('sp_symphysodon_aequifasciata')).toBe('sp_symphysodon_aequifasciatus');
    expect(canonicalSpeciesId('sp_xiphophorus_helleri')).toBe('sp_xiphophorus_hellerii');
    expect(canonicalSpeciesId('sp_xiphophorus_helleri_hybrid')).toBe('sp_xiphophorus_hellerii');
  });

  it('leaves every other id exactly as it found it', () => {
    expect(canonicalSpeciesId('sp_pterophyllum_scalare')).toBe('sp_pterophyllum_scalare');
    expect(canonicalSpeciesId('sp_symphysodon_discus')).toBe('sp_symphysodon_discus');
  });

  it('resolves in one hop, because no synonym points at another synonym', () => {
    // A chain would make the result depend on iteration order. Assert the data
    // has none rather than writing a loop to survive one.
    for (const s of SPECIES_SYNONYMS) {
      expect(SYNONYM_IDS.has(s.canonicalId)).toBe(false);
    }
  });

  it('sends every synonym somewhere the catalog will keep', () => {
    for (const s of SPECIES_SYNONYMS) {
      expect(canonicalSpeciesId(s.speciesId)).toBe(s.canonicalId);
      expect(SYNONYM_IDS.has(canonicalSpeciesId(s.speciesId))).toBe(false);
    }
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

  /**
   * Regressions for the derivation bug that made 26% of the catalog junk.
   * Every title below is real, taken from the shipped mart's aliases.
   */
  describe('vendor boilerplate after the binomial', () => {
    it('does not name a fish after how it was bred', () => {
      // Both are Trichogaster labiosa. The shared TAIL is "- Tank Bred", which
      // is what the old ranking picked; the name is in the head.
      expect(deriveCommonName([
        'Red Robin Gourami (Trichogaster labiosa) - Tank Bred',
        'Sunset Thicklip Gourami (Trichogaster labiosa) - Tank Bred',
      ])).toBe('Gourami');
    });

    it('does not name a fish after the shop that sold it', () => {
      expect(deriveCommonName([
        'Blue Oranda Goldfish (Carassius auratus auratus), Tank-Raised!!! - Aquatic Arts',
      ])).toBe('Blue Oranda Goldfish');
    });

    it('keeps the head when only one listing exists', () => {
      expect(deriveCommonName([
        'Golden Dwarf Cichlid (Nannacara anomala), - Tank Bred',
      ])).toBe('Golden Dwarf Cichlid');
    });

    it('ignores an "aka" alias rather than splicing it onto the name', () => {
      expect(deriveCommonName([
        'Samurai Gourami aka "Vaillant\'s Chocolate Gourami" (Sphaerichthys vaillanti) - Tank Bred',
        'Samurai Gourami (Sphaerichthys vaillanti)',
      ])).toBe('Samurai Gourami');
    });

    it('strips packaging from titles that carry no binomial at all', () => {
      // Nu Aqua's format: no parenthesised binomial, trade clause after a dash.
      expect(deriveCommonName([
        'Albino Koi Guppy Pairs- Locally Bred',
        'Japan Blue Double Sword Guppy Pairs- Locally Bred',
      ])).toBe('Guppy');
    });

    it('returns undefined rather than a name that is only boilerplate', () => {
      // Nothing recoverable here. The caller falls back to the binomial, which
      // is honest; "10-Pack" as a species name is not.
      expect(deriveCommonName(['10-Pack Of Fish', '6-Pack Of Fish'])).toBeUndefined();
    });

    it('keeps a colour word when the colour is the fish', () => {
      // "Koi" is decoration in "Koi Angelfish" and the animal in "Butterfly
      // Koi". Trailing-noise stripping must not eat it.
      expect(deriveCommonName(['Butterfly Koi', 'Standard Butterfly Koi'])).toBe('Butterfly Koi');
    });
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

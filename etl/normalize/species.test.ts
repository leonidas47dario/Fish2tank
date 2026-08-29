import { describe, expect, it } from 'vitest';
import { buildMatcher, extractProductTypeBinomial, extractScientificName } from './species';
import { SPECIES_CATALOG } from '@/data/seed/species-catalog';

const catalog = SPECIES_CATALOG.map((e) => e.species);
const match = buildMatcher(catalog);

describe('extractScientificName', () => {
  it('lifts a binomial out of parentheses', () => {
    expect(extractScientificName('Black Kumpay Goby (Stiphodon atropurpureus)'))
      .toBe('Stiphodon atropurpureus');
  });

  it('handles a trinomial', () => {
    expect(extractScientificName('Some Fish (Genus species subspecies)'))
      .toBe('Genus species subspecies');
  });

  it('ignores parentheses that are not a species name', () => {
    // Real titles from the stores.
    expect(extractScientificName('HQ Super Red Dragon Flowerhorn ( Male ) #M1')).toBeUndefined();
    expect(extractScientificName('Raphael catfish (large)')).toBeUndefined();
    expect(extractScientificName('Something (Grade A)')).toBeUndefined();
  });

  it('returns undefined when there are no parentheses', () => {
    expect(extractScientificName('Cuban Cichlid')).toBeUndefined();
  });
});

describe('scientific-name matching', () => {
  it('resolves a catalog species by its binomial', () => {
    const m = match('Jaguar Cichlid (Parachromis managuensis)');
    expect(m.speciesId).toBe('sp_jaguar_cichlid');
    expect(m.method).toBe('scientific-name');
  });

  it('is case insensitive on the binomial', () => {
    expect(match('Wolf Fish (HOPLIAS MALABARICUS)'.replace('HOPLIAS MALABARICUS', 'Hoplias malabaricus')).speciesId)
      .toBe('sp_wolf_fish');
  });

  it('reports a binomial we do not stock without inventing a match', () => {
    const m = match('Black Kumpay Goby (Stiphodon atropurpureus)');
    expect(m.speciesId).toBeUndefined();
    expect(m.scientificNameInTitle).toBe('Stiphodon atropurpureus');
  });

  it('does not fall back to a loose name match when the binomial is explicit', () => {
    // The title says precisely what this is, and it is not our largemouth bass.
    const m = match('Peacock Bass (Cichla ocellaris)');
    expect(m.speciesId).toBeUndefined();
    expect(m.scientificNameInTitle).toBe('Cichla ocellaris');
  });
});

describe('common-name matching', () => {
  it('matches a multi-word name inside a longer title', () => {
    expect(match('Premium Electric Blue Acara Juvenile').speciesId).toBe('sp_electric_blue_acara');
  });

  it('prefers the longer, more specific name', () => {
    // "Severum" and "Green Severum" are both in the catalog.
    expect(match('Green Severum 3 inches').speciesId).toBe('sp_green_severum');
  });

  it('matches a single-word name when the title is essentially just that name', () => {
    expect(match('Betta').speciesId).toBe('sp_betta');
    expect(match('HQ Premium Betta').speciesId).toBe('sp_betta');
  });
});

describe('the Peacock Bass trap', () => {
  it('refuses to file a peacock bass under largemouth bass', () => {
    // "Bass" is a catalog alias of Largemouth Bass. Substring matching would
    // corrupt both species' medians. This is the single most important
    // negative case in this file.
    const m = match('Peacock Bass');
    expect(m.speciesId).toBeUndefined();
  });

  it('still resolves an unambiguous largemouth bass listing', () => {
    expect(match('Largemouth Bass').speciesId).toBe('sp_largemouth_bass');
  });

  it('does not match a single-word alias buried in an unrelated title', () => {
    expect(match('Neon Blue Goby').speciesId).toBeUndefined();
    expect(match('Peacock Gudgeon Pair').speciesId).toBe('sp_peacock_gudgeon');
  });
});

describe('no match', () => {
  it('leaves an unknown fish unresolved rather than guessing', () => {
    expect(match('Assorted Mystery Box').speciesId).toBeUndefined();
    expect(match('Frozen Bloodworms 100g').speciesId).toBeUndefined();
    expect(match('Aquarium Gravel Vacuum').speciesId).toBeUndefined();
  });

  it('does not resolve a bare grading title', () => {
    expect(match('Grade A').speciesId).toBeUndefined();
  });
});

describe('open-nomenclature qualifiers are not species names', () => {
  it('rejects a genus-only designation', () => {
    // 57 listings said "Cichlasoma sp." - treating sp as an epithet invented a
    // species and pooled unrelated fish into it.
    expect(extractScientificName('Blue Cichlid (Cichlasoma sp)')).toBeUndefined();
    expect(extractScientificName('Pleco (Pseudacanthicus sp)')).toBeUndefined();
  });

  it('rejects cf and aff qualifiers', () => {
    expect(extractScientificName('Fish (Geophagus cf)')).toBeUndefined();
    expect(extractScientificName('Fish (Geophagus aff)')).toBeUndefined();
  });

  it('drops a trailing qualifier but keeps a real binomial', () => {
    expect(extractScientificName('Angelfish (Pterophyllum scalare sp)')).toBe('Pterophyllum scalare');
  });

  it('still accepts a genuine trinomial', () => {
    expect(extractScientificName('Pleco (Panaque nigrolineatus laurafabianae)'))
      .toBe('Panaque nigrolineatus laurafabianae');
  });
});

/**
 * LiveAquaria (added 2026-08-29) does not put binomials in titles at all -
 * zero of 250 sampled products - and carries the scientific name in Shopify's
 * product_type field instead. Without this path the store resolves nothing.
 */
describe('binomial from product_type', () => {
  it('lifts a bare binomial out of the field', () => {
    expect(extractProductTypeBinomial('Caulastrea furcata')).toBe('Caulastrea furcata');
    expect(extractProductTypeBinomial('  Symphysodon discus  ')).toBe('Symphysodon discus');
  });

  it('refuses a genus-only designation, as the title path does', () => {
    // Real LiveAquaria values. "Sarcophyton sp." is "some Sarcophyton", not a
    // species, and minting one would pool unrelated corals into it.
    expect(extractProductTypeBinomial('Sarcophyton sp.')).toBeUndefined();
    expect(extractProductTypeBinomial('Goniopora sp')).toBeUndefined();
    expect(extractProductTypeBinomial('Symphysodon spp.')).toBeUndefined();
  });

  it('ignores a product_type that is a category rather than a binomial', () => {
    expect(extractProductTypeBinomial('Aquatic Plant')).toBeUndefined();
    expect(extractProductTypeBinomial('Accessories')).toBeUndefined();
    expect(extractProductTypeBinomial('')).toBeUndefined();
    expect(extractProductTypeBinomial(undefined)).toBeUndefined();
  });

  it('accepts a trinomial', () => {
    expect(extractProductTypeBinomial('Panaque nigrolineatus laurafabianae'))
      .toBe('Panaque nigrolineatus laurafabianae');
  });

  it('resolves a catalog species through the matcher', () => {
    // The title alone says nothing useful; the field is what identifies it.
    const m = match('Almost WYSIWYG Frag', 'Betta splendens');
    expect(m.scientificNameInTitle).toBe('Betta splendens');
    expect(m.method).toBe('product-type');
  });

  it('does not let product_type override a binomial already in the title', () => {
    const m = match('Betta (Betta splendens)', 'Symphysodon discus');
    expect(m.scientificNameInTitle).toBe('Betta splendens');
  });

  it('does not fall through to a loose common-name match', () => {
    // Same discipline as the title path: the vendor has stated precisely what
    // this is. If we do not stock it, that is the answer.
    const m = match('Some Coral Frag', 'Caulastrea furcata');
    expect(m.speciesId).toBeUndefined();
    expect(m.scientificNameInTitle).toBe('Caulastrea furcata');
  });
});

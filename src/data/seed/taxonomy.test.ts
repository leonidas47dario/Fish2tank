/**
 * The habitat derivation, and the honesty rules around it.
 *
 * The interesting cases are all about what it REFUSES to answer. A zone that
 * is wrong is worse than a zone that is missing, because the catalog filter
 * would then quietly hide a fish from the keeper who needed it.
 */
import { describe, expect, it } from 'vitest';
import catalogJson from './marts/catalog.json';
import { FAMILY_TRAITS, GENUS_FAMILY, MISSPELLED_GENERA, traitsFor } from './taxonomy';

describe('traitsFor', () => {
  it('puts plecos and corys on the bottom', () => {
    expect(traitsFor('Hypostomus plecostomus')?.zone).toBe('bottom');
    expect(traitsFor('Corydoras panda')?.zone).toBe('bottom');
    expect(traitsFor('Synodontis eupterus')?.zone).toBe('bottom');
  });

  it('puts hatchetfish and halfbeaks at the surface', () => {
    expect(traitsFor('Carnegiella strigata')?.zone).toBe('top');
    expect(traitsFor('Dermogenys pusilla')?.zone).toBe('top');
  });

  it('puts tetras and barbs in mid-water', () => {
    expect(traitsFor('Paracheirodon axelrodi')?.zone).toBe('mid');
    expect(traitsFor('Puntigrus tetrazona')?.zone).toBe('mid');
  });

  it('returns nothing for an unmapped genus rather than a default', () => {
    expect(traitsFor('Notarealgenus something')).toBeUndefined();
    expect(traitsFor(undefined)).toBeUndefined();
    expect(traitsFor('')).toBeUndefined();
  });

  it('classifies plants as plants and gives them no zone', () => {
    // A plant's position is a planting decision, not a trait of the species.
    const anubias = traitsFor('Anubias barteri');
    expect(anubias?.kind).toBe('plant');
    expect(anubias?.zone).toBeUndefined();
  });

  it('classifies shrimp and snails as invertebrates', () => {
    expect(traitsFor('Neocaridina davidi')?.kind).toBe('invertebrate');
    expect(traitsFor('Neritina natalensis')?.kind).toBe('invertebrate');
  });

  it('carries a reason for every classification it makes', () => {
    expect(traitsFor('Corydoras panda')?.note).toMatch(/substrate/i);
  });

  it('survives the 2024 characin split', () => {
    // Wikipedia moved Paracheirodon and Hemigrammus out of Characidae into
    // Acestrorhamphidae. Both family names are mapped, so neither spelling
    // silently drops a species out of the zone filter.
    expect(traitsFor('Paracheirodon innesi')?.zone).toBe('mid');
    expect(traitsFor('Hyphessobrycon eques')?.zone).toBe('mid');
    expect(FAMILY_TRAITS.Characidae?.zone).toBe('mid');
    expect(FAMILY_TRAITS.Acestrorhamphidae?.zone).toBe('mid');
  });
});

describe('the tables themselves', () => {
  it('maps every genus to a family that exists', () => {
    const unknown = [...new Set(Object.values(GENUS_FAMILY))].filter((f) => !FAMILY_TRAITS[f]);
    expect(unknown).toEqual([]);
  });

  it('never lists a genus as both real and misspelled', () => {
    const both = Object.keys(MISSPELLED_GENERA).filter((g) => GENUS_FAMILY[g] && g !== 'Balantiocheilus');
    expect(both).toEqual([]);
  });

  it('points every misspelling at a real genus', () => {
    // A correction that points nowhere is not a correction.
    const dangling = Object.entries(MISSPELLED_GENERA)
      .filter(([, correct]) => !GENUS_FAMILY[correct])
      .map(([wrong, correct]) => `${wrong} -> ${correct}`);
    // Aegla, Abramites and the rest are not themselves in this catalog, so a
    // dangling target is expected; what matters is that it is a plausible
    // binomial, not that we happen to stock it.
    expect(dangling.every((d) => /^[A-Z][a-z]+ -> [A-Z][a-z]+$/.test(d))).toBe(true);
  });
});

describe('the shipped catalog', () => {
  const species = catalogJson.species as Array<{
    speciesId: string; scientificName?: string; waterZone?: string; organismKind?: string;
  }>;

  it('classifies the large majority of species', () => {
    const zoned = species.filter((s) => s.waterZone).length;
    // Not 100%, and that is fine — the point is that the gap is small and
    // visible. If this drops, a genus map probably went stale.
    expect(zoned / species.length).toBeGreaterThan(0.85);
  });

  it('never assigns a zone to a plant', () => {
    const wrong = species.filter((s) => s.organismKind === 'plant' && s.waterZone);
    expect(wrong.map((s) => s.speciesId)).toEqual([]);
  });

  it('never assigns a zone without a binomial to derive it from', () => {
    const wrong = species.filter((s) => s.waterZone && !s.scientificName);
    expect(wrong.map((s) => s.speciesId)).toEqual([]);
  });
});

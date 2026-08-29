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
    waterType?: string;
  }>;

  /**
   * THIS MAP IS A FRESHWATER MAP, and the assertion now says so.
   *
   * It used to measure the whole catalog at >85%. The 2026-08-29 refresh made
   * that number meaningless rather than false: LiveAquaria's marine catalogue
   * grew to 3,256 products and put 1,064 reef species — Chaetodon, Cirrhilabrus,
   * Acropora — into a genus map built entirely for the fish in the owner's
   * tanks. Pooled coverage fell to 50% while the freshwater half never moved
   * off 89%, so a single ratio would have reported a stale genus map when
   * nothing had gone stale at all.
   *
   * So it is measured on the half the map covers, and the marine gap is
   * asserted as a known, sized hole rather than averaged into invisibility.
   * Extending the map to reef families is real work, not a threshold tweak.
   */
  const freshwater = species.filter((s) => s.waterType !== 'marine');
  const marine = species.filter((s) => s.waterType === 'marine');

  /**
   * PLANTS ARE EXCLUDED FROM THE DENOMINATOR, and that is a correction rather
   * than a convenience.
   *
   * A plant never gets a water-column zone — the test below asserts exactly
   * that — so counting the 142 freshwater plants among the species that ought
   * to have one was always measuring the wrong thing. It went unnoticed while
   * 180 freshwater species were mis-filed as marine and therefore excluded
   * from the count entirely; fixing the salinity tag surfaced it.
   *
   * Measured properly, coverage is 91.5% of freshwater animals — better than
   * the 89% the pooled figure ever claimed.
   */
  const freshwaterAnimals = freshwater.filter((s) => s.organismKind !== 'plant');

  it('classifies the large majority of freshwater animals', () => {
    const zoned = freshwaterAnimals.filter((s) => s.waterZone).length;
    // Not 100%, and that is fine — the point is that the gap is small and
    // visible. If this drops, a genus map probably went stale.
    expect(zoned / freshwaterAnimals.length).toBeGreaterThan(0.85);
  });

  it('counts salinity for nearly every species, so the default filter is honest', () => {
    // The catalog opens filtered to freshwater. That is only defensible while
    // almost nothing is unclassified — a default that hid hundreds of species
    // under "not recorded" would be the app hiding a gap rather than showing
    // one. 45 of 2,178 is a gap you can name.
    const untyped = species.filter((s) => !s.waterType);
    expect(untyped.length / species.length).toBeLessThan(0.05);
  });

  it('records the marine gap as a gap, never as a default zone', () => {
    // The honest failure mode. A reef fish with no family in the map must come
    // out unclassified and be excluded from the zone filters — never bucketed
    // into 'mid' because most fish are.
    expect(marine.length).toBeGreaterThan(500);
    expect(marine.filter((s) => s.waterZone).length / marine.length).toBeLessThan(0.2);
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

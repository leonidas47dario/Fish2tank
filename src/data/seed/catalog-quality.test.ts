/**
 * The build gate for catalog data quality.
 *
 * This is the test that makes "the catalog is clean" a fact rather than a
 * claim. It runs the rules in catalog-quality.ts over the SHIPPED mart, so a
 * refresh that reintroduces vendor marketing copy as a species name fails CI
 * instead of reaching production.
 *
 * When this fails, do not relax the rule. Either fix the derivation in
 * etl/normalize/derive-species.ts (if a whole class of names is wrong) or add
 * a sourced entry to species-overrides.ts (if one species needs a human
 * decision). Both paths leave a reviewable diff; loosening the rule does not.
 */
import { describe, expect, it } from 'vitest';
import catalogJson from './marts/catalog.json';
import {
  findProblems, isUsableBinomial, isUsableName, summarise, type NameCheckable,
} from './catalog-quality';
import { NOT_A_SPECIES, SPECIES_OVERRIDES } from './species-overrides';

const species = catalogJson.species as NameCheckable[];

describe('the shipped catalog', () => {
  it('has no unusable species names', () => {
    const problems = findProblems(species);

    // A bare count tells you nothing about what to fix, so the failure names
    // the worst offenders and the shape of the damage.
    const message = problems.length === 0 ? '' : [
      `${problems.length} problems across ${new Set(problems.map((p) => p.speciesId)).size} species`,
      JSON.stringify(summarise(problems)),
      ...problems.slice(0, 25).map((p) => `  ${p.speciesId}: ${p.code} — ${p.detail}`),
      problems.length > 25 ? `  …and ${problems.length - 25} more` : '',
    ].filter(Boolean).join('\n');

    expect(message).toBe('');
  });

  it('gives every species something to be identified by', () => {
    const nameless = species.filter((s) => !s.scientificName && !isUsableName(s.commonName));
    expect(nameless.map((s) => s.speciesId)).toEqual([]);
  });
});

describe('the binomial gate (spec 005)', () => {
  it.each([
    'Parachromis managuensis',
    'Erythrinus erythrinus',
    'Melanotaenia splendida inornata',
    'Geophagus sp.',
    'Heros sp.',
  ])('accepts %s', (name) => {
    expect(isUsableBinomial(name)).toBe(true);
  });

  it.each([
    // The two that actually got through, and why each one is not taxonomy.
    ['Roofvissen fotografie', 'a Dutch photo credit'],
    ['Fish food', 'not an animal'],
    // Shape failures.
    ['Managuensis', 'one word'],
    ['Red Wolf Fish Four Inch', 'four words'],
    ['parachromis managuensis', 'lowercase genus'],
    ['Parachromis Managuensis', 'capitalised epithet'],
    ['Parachromis managuensis 4', 'a digit'],
  ])('rejects %s (%s)', (name) => {
    expect(isUsableBinomial(name)).toBe(false);
  });

  /**
   * The regression that matters most. Open nomenclature is valid taxonomy, and
   * the first draft of this rule rejected both real examples in the catalog
   * while hunting the two phantoms - it would have deleted two real fish.
   */
  it('does not reject a real species to catch a phantom', () => {
    const rejected = species.filter((s) => s.scientificName && !isUsableBinomial(s.scientificName));
    expect(rejected.map((s) => `${s.speciesId}="${s.scientificName}"`)).toEqual([]);
  });
});

describe('retired non-species (spec 005)', () => {
  it('keeps them out of the shipped catalog', () => {
    const ids = new Set(species.map((s) => s.speciesId));
    const survivors = NOT_A_SPECIES.filter((s) => ids.has(s.speciesId));
    expect(survivors.map((s) => s.speciesId)).toEqual([]);
  });

  it('says what each was minted from, so the diagnosis is not lost', () => {
    const undocumented = NOT_A_SPECIES.filter((s) => !s.mintedFrom.trim() || !s.reason.trim());
    expect(undocumented.map((s) => s.speciesId)).toEqual([]);
  });

  it('would now be caught by the gate rather than needing this list', () => {
    // If a future refresh reintroduces one, isUsableBinomial stops it at the
    // point of minting. This asserts the gate genuinely covers both, so the
    // list is a cleanup of past damage and not the only defence.
    for (const s of NOT_A_SPECIES) {
      const binomial = s.speciesId.replace(/^sp_/, '').replace(/_/g, ' ');
      expect(isUsableBinomial(binomial.charAt(0).toUpperCase() + binomial.slice(1))).toBe(false);
    }
  });
});

describe('species overrides', () => {
  it('cites a source for every correction', () => {
    const unsourced = SPECIES_OVERRIDES.filter((o) => !o.source?.trim());
    expect(unsourced.map((o) => o.speciesId)).toEqual([]);
  });

  it('does not correct the same species twice', () => {
    const seen = new Set<string>();
    const duplicated = SPECIES_OVERRIDES.filter((o) => !seen.add(o.speciesId));
    expect(duplicated.map((o) => o.speciesId)).toEqual([]);
  });

  it('only proposes names that pass the rules', () => {
    // An override that is itself junk would defeat the whole gate.
    const bad = SPECIES_OVERRIDES.filter((o) => o.commonName && !isUsableName(o.commonName));
    expect(bad.map((o) => `${o.speciesId}="${o.commonName}"`)).toEqual([]);
  });

  it('actually applies — every override reached the mart', () => {
    // An override for a speciesId that no longer exists is dead weight and,
    // worse, hides the fact that the species it was meant to fix has gone.
    const ids = new Set(species.map((s) => s.speciesId));
    const orphans = SPECIES_OVERRIDES.filter((o) => !ids.has(o.speciesId));
    expect(orphans.map((o) => o.speciesId)).toEqual([]);
  });
});

/**
 * Every shipped care value must be answerable: "how do we know that?"
 *
 * These assert over the built catalog mart rather than over the source data,
 * because the mart is what the app actually reads. A backfill that is correct
 * in species-care.json and mangled on the way through the warehouse is still a
 * catalog that lies to the user.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG, type CareField, type CatalogSpecies } from '../catalog';
import { SPECIES_CATALOG } from './species-catalog';

const CARE_FIELDS: Array<{ field: CareField; present: (s: CatalogSpecies) => boolean }> = [
  { field: 'adultSizeIn', present: (s) => s.adultSizeIn !== undefined },
  { field: 'minVolumeGal', present: (s) => s.minVolumeGal !== undefined },
  { field: 'aggression', present: (s) => s.aggression !== undefined },
  { field: 'tempC', present: (s) => s.tempMinC !== undefined && s.tempMaxC !== undefined },
];

/** The 47 hand-written profiles cite one source for the whole profile. */
const CURATED = new Set(SPECIES_CATALOG.map((e) => e.species.id));

const backfilled = CATALOG.species.filter((s) => !CURATED.has(s.speciesId));

describe('care provenance', () => {
  it('gives every backfilled care value a source and a URL', () => {
    const unsourced: string[] = [];
    for (const s of backfilled) {
      for (const { field, present } of CARE_FIELDS) {
        if (!present(s)) continue;
        const src = s.careSources?.[field];
        if (!src?.source || !src.url) unsourced.push(`${s.speciesId}.${field}`);
      }
    }
    expect(unsourced).toEqual([]);
  });

  it('never credits a field that carries no value', () => {
    const orphaned: string[] = [];
    for (const s of backfilled) {
      for (const { field, present } of CARE_FIELDS) {
        if (s.careSources?.[field] && !present(s)) orphaned.push(`${s.speciesId}.${field}`);
      }
    }
    expect(orphaned).toEqual([]);
  });

  it('only ever names a source we actually read from', () => {
    const seen = new Set<string>();
    for (const s of backfilled) {
      for (const src of Object.values(s.careSources ?? {})) seen.add(src.source);
    }
    for (const source of seen) expect(['wikipedia', 'vendor']).toContain(source);
  });

  it('keeps every aggression value inside the domain union', () => {
    const allowed = ['peaceful', 'semi-aggressive', 'aggressive', 'highly-aggressive'];
    const bad = CATALOG.species
      .filter((s) => s.aggression !== undefined && !allowed.includes(s.aggression))
      .map((s) => `${s.speciesId}=${s.aggression}`);
    expect(bad).toEqual([]);
  });

  it('leaves the curated profiles untouched by the backfill', () => {
    // The backfill is merged UNDER the hand-written catalog. If a curated
    // value ever changed, a scraped sentence would have overruled a person.
    for (const { species, profile } of SPECIES_CATALOG) {
      const shipped = CATALOG.species.find((s) => s.speciesId === species.id);
      if (!shipped || !profile.adultSize) continue;
      const expected =
        profile.adultSize.unit === 'cm' ? profile.adultSize.value / 2.54 : profile.adultSize.value;
      expect(shipped.adultSizeIn).toBeCloseTo(expected, 4);
      expect(shipped.careSources).toBeUndefined();
    }
  });

  it('states no temperature range running backwards', () => {
    const inverted = CATALOG.species
      .filter((s) => s.tempMinC !== undefined && s.tempMaxC !== undefined && s.tempMinC > s.tempMaxC)
      .map((s) => s.speciesId);
    expect(inverted).toEqual([]);
  });
});

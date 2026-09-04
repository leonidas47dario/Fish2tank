/**
 * Every shipped care value must be answerable: "how do we know that?"
 *
 * These assert over the built catalog mart rather than over the source data,
 * because the mart is what the app actually reads. A backfill that is correct
 * in species-care.json and mangled on the way through the warehouse is still a
 * catalog that lies to the user.
 */
import { existsSync, readFileSync } from 'node:fs';
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
    // Spec 045 adds Seriously Fish as the third and highest-precedence source.
    for (const source of seen) expect(['wikipedia', 'vendor', 'seriouslyfish']).toContain(source);
  });

  it('keeps every aggression value inside the domain union', () => {
    const allowed = ['peaceful', 'semi-aggressive', 'aggressive', 'highly-aggressive'];
    const bad = CATALOG.species
      .filter((s) => s.aggression !== undefined && !allowed.includes(s.aggression))
      .map((s) => `${s.speciesId}=${s.aggression}`);
    expect(bad).toEqual([]);
  });

  /*
   * REPLACED, NOT DELETED - spec 045.
   *
   * The old assertion was "the backfill leaves the curated profiles
   * untouched", which was the right rule while the only backfill sources were
   * a scraped sentence from Wikipedia and a store listing: neither should
   * overrule a person.
   *
   * Spec 045 changes that deliberately for ONE source. All 47 curated profiles
   * are already complete on these fields, so "Seriously Fish fills the gaps"
   * would have been a no-op; what SF can do to them is DISAGREE, and the
   * keeper chose to let it win. The protection moves rather than disappears:
   * a curated value may now change, but only to a Seriously Fish value, and
   * only with both figures recorded so the change is reviewable.
   */
  it('lets nothing but Seriously Fish overrule a curated profile', () => {
    for (const { species, profile } of SPECIES_CATALOG) {
      const shipped = CATALOG.species.find((s) => s.speciesId === species.id);
      if (!shipped || !profile.adultSize) continue;
      const curated =
        profile.adultSize.unit === 'cm' ? profile.adultSize.value / 2.54 : profile.adultSize.value;

      const source = shipped.careSources?.adultSizeIn?.source;
      if (source === undefined) {
        // Untouched, as before.
        expect(shipped.adultSizeIn).toBeCloseTo(curated, 4);
      } else {
        // Changed - and only Seriously Fish is allowed to have changed it.
        expect(source).toBe('seriouslyfish');
      }
    }
  });

  it('records both figures for every curated value Seriously Fish overrode', () => {
    // The override list is the whole mitigation for letting a source overrule
    // a person: a change nobody can read is a change nobody reviewed.
    const overridePath = 'data/care/seriously-fish-overrides.json';
    if (!existsSync(overridePath)) return; // not yet run on a clean checkout
    const { overrides } = JSON.parse(readFileSync(overridePath, 'utf8')) as {
      overrides: Array<{ speciesId: string; field: string; was: unknown; wasSource: string; now: unknown }>;
    };
    for (const o of overrides) {
      expect(o.was).toBeDefined();
      expect(o.now).toBeDefined();
      expect(o.wasSource).toBeTruthy();
    }
  });

  it('never lets an editorial rating pretend to be a sourced figure', () => {
    // The six difficulty measures are SF's judgement with no sentence behind
    // them. They must carry no entry in careSources, which is the structure
    // that says "this value has evidence you can open".
    for (const s of CATALOG.species) {
      if (!s.difficulty) continue;
      expect(Object.keys(s.careSources ?? {})).not.toContain('difficulty');
    }
  });

  it('states no temperature range running backwards', () => {
    const inverted = CATALOG.species
      .filter((s) => s.tempMinC !== undefined && s.tempMaxC !== undefined && s.tempMinC > s.tempMaxC)
      .map((s) => s.speciesId);
    expect(inverted).toEqual([]);
  });
});

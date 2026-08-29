import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_WITNESSES, MARKET_INDEX, STORE_RESOLVE_RATES, WITNESS_STORES, scarcityFor,
} from './market';
import { STORE_CHANNELS } from './store-channels';
import { bandForScore, DEFAULT_SCARCITY_CONFIG } from '@/engine/rarity/market-scarcity';
import catalogJson from './seed/marts/catalog.json';

const byCommonName = new Map<string, string>();
for (const e of (catalogJson as unknown as {
  species: Array<{ speciesId: string; commonName: string }>;
}).species) {
  if (!byCommonName.has(e.commonName)) byCommonName.set(e.commonName, e.speciesId);
}

describe('resolve rates are derived from the index, never hardcoded', () => {
  it('is published listings over livestock listings, per store', () => {
    const published: Record<string, number> = {};
    for (const stats of Object.values(MARKET_INDEX.species)) {
      for (const s of stats.stores) published[s.storeId] = (published[s.storeId] ?? 0) + s.listings;
    }
    for (const s of MARKET_INDEX.sources) {
      expect(STORE_RESOLVE_RATES[s.id]).toBeCloseTo((published[s.id] ?? 0) / s.listingsFetched, 10);
    }
  });

  it('covers every source in the index', () => {
    for (const s of MARKET_INDEX.sources) {
      expect(STORE_RESOLVE_RATES[s.id]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('only community stores are offered as witnesses', () => {
  it('excludes every specialist', () => {
    const ids = COMMUNITY_WITNESSES.map((w) => w.storeId);
    expect(ids).not.toContain('predatory-fins');
    expect(ids).not.toContain('aquatic-arts');
    for (const id of ids) expect(STORE_CHANNELS[id]).toBe('community');
  });

  it('admits only the ones clearing the gate', () => {
    for (const w of WITNESS_STORES) {
      expect(w.resolveRate).toBeGreaterThanOrEqual(DEFAULT_SCARCITY_CONFIG.witnessMinResolveRate);
    }
    // A rejected store failed at least one of the two gates - either it is
    // unreadable, or it is readable and near-empty.
    const rejected = COMMUNITY_WITNESSES.filter((w) => !WITNESS_STORES.includes(w));
    expect(rejected.length).toBeGreaterThan(0);
    for (const w of rejected) {
      const failsResolve = w.resolveRate < DEFAULT_SCARCITY_CONFIG.witnessMinResolveRate;
      const failsCoverage = w.coverage < DEFAULT_SCARCITY_CONFIG.witnessMinCoverage;
      expect(failsResolve || failsCoverage, `${w.storeId} passes both gates but is not a witness`).toBe(true);
    }
  });
});

describe('the entry point cannot be bypassed', () => {
  it('returns not-enough-data for an unknown species', () => {
    expect(scarcityFor('sp_does_not_exist').available).toBe(false);
    expect(scarcityFor(undefined).available).toBe(false);
  });

  it('never rates a species that only specialists carry', () => {
    const specialistOnly = Object.values(MARKET_INDEX.species).filter(
      (s) => s.stores.length > 0 && s.stores.every((x) => STORE_CHANNELS[x.storeId] === 'specialist'),
    );
    expect(specialistOnly.length).toBeGreaterThan(0);
    for (const s of specialistOnly.slice(0, 200)) {
      expect(scarcityFor(s.speciesId).available).toBe(false);
    }
  });
});

/**
 * Calibration over the real shipped index.
 *
 * A distribution test, not a logic test. The v0.1.0 formula put 89% of the
 * catalogue in the bottom two bands and called Betta "uncommon"; every unit
 * test passed while it did. This is the check that would have caught it.
 */
describe('calibration against the shipped index', () => {
  const ids = Object.keys(MARKET_INDEX.species);

  const counts = (() => {
    const c: Record<string, number> = { 'not-rated': 0 };
    for (const id of ids) {
      const r = scarcityFor(id);
      const key = r.available ? r.band : 'not-rated';
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  })();

  it('never puts almost the whole rated catalogue in one band', () => {
    const rated = ids.length - counts['not-rated']!;
    if (rated === 0) return; // covered by the witness-count test below
    const biggest = Math.max(
      ...Object.entries(counts).filter(([k]) => k !== 'not-rated').map(([, v]) => v),
    );
    // v0.1.0 put 54.5% in "rarely listed" alone. Over 80% of the rated set in
    // a single band means the scale has stopped discriminating.
    expect(biggest / rated).toBeLessThan(0.8);
  });

  it('has a real local-shelf sample', () => {
    // Imperial Tropicals, AquaHuna and Nu Aqua. Nu Aqua is the one shop Ryan
    // can walk into, and only became readable once the matcher stopped
    // needing a Latin binomial.
    expect(WITNESS_STORES.length).toBeGreaterThanOrEqual(DEFAULT_SCARCITY_CONFIG.minimumWitnesses);
    expect(WITNESS_STORES.map((w) => w.storeId)).toContain('nu-aqua');
    for (const w of WITNESS_STORES) {
      expect(MARKET_INDEX.sources.some((s) => s.id === w.storeId)).toBe(true);
    }
  });

  it('excludes stores that are legible but carry almost nothing', () => {
    // Aquarium Co-Op resolves 11% cleanly and publishes 35 of 2,176 species;
    // PetSmart 34% and 57. Both pass the resolve gate and fail on coverage.
    // Without this they counted as absence and rated Betta "rarely listed".
    const ids = WITNESS_STORES.map((w) => w.storeId);
    expect(ids).not.toContain('aquarium-coop');
    expect(ids).not.toContain('petsmart');
    for (const w of WITNESS_STORES) {
      expect(w.coverage).toBeGreaterThanOrEqual(DEFAULT_SCARCITY_CONFIG.witnessMinCoverage);
    }
  });

  it('rates a meaningful share of the catalog', () => {
    expect(ids.length - counts['not-rated']!).toBeGreaterThan(300);
  });

  it('calls the commonest fish in the hobby widely available', () => {
    // Every one of these was "scarce" or "uncommon" under v0.1.0. This is the
    // assertion that would have caught the original bug.
    for (const name of ['Neon Tetra', 'Cardinal Tetra', 'Bristlenose Pleco']) {
      const id = byCommonName.get(name);
      expect(id, `${name} missing from the catalog`).toBeDefined();
      const r = scarcityFor(id!);
      expect(r.available, `${name} not rated`).toBe(true);
      if (r.available) expect(r.band, `${name} read as ${r.band}`).toBe('widely-available');
    }
  });

  it('puts the everyday-but-not-everywhere fish in the middle', () => {
    for (const name of ['Fancy Guppy', 'Oscar', 'Jack Dempsey', 'Zebra Danio']) {
      const id = byCommonName.get(name);
      if (!id) continue;
      const r = scarcityFor(id);
      expect(r.available, `${name} not rated`).toBe(true);
      if (r.available) expect(r.band).toBe('available');
    }
  });

  it('uses every band the witness count can actually produce, and no more', () => {
    /**
     * Breadth is 100 * (1 - carrying/N), so N witnesses yield exactly N
     * distinct rateable values and the bands they land in are fixed by N:
     *
     *   N=3 -> 0, 33, 67          widely-available, available, scarce
     *   N=4 -> 0, 25, 50, 75      adds uncommon and rarely-listed, drops scarce
     *   N=5 -> 0, 20, 40, 60, 80  all five, one per rung
     *
     * So a band being empty is a property of the sample size, not a bug - but
     * a band appearing that N cannot produce would be. This pins the mapping
     * rather than the band names, so growing the sample fails loudly here and
     * the expectations get looked at.
     */
    const n = WITNESS_STORES.length;
    const reachable = new Set(
      Array.from({ length: n }, (_, k) => bandForScore(Math.round(100 * (1 - (k + 1) / n)), DEFAULT_SCARCITY_CONFIG)),
    );
    const populated = Object.entries(counts).filter(([k, v]) => k !== 'not-rated' && v > 0).map(([k]) => k);
    for (const b of populated) expect([...reachable]).toContain(b);
    expect(populated.length).toBe(reachable.size);
  });
});

import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_WITNESSES, MARKET_INDEX, STORE_RESOLVE_RATES, WITNESS_STORES, scarcityFor,
} from './market';
import { STORE_CHANNELS } from './store-channels';
import { DEFAULT_SCARCITY_CONFIG } from '@/engine/rarity/market-scarcity';
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
    const rejected = COMMUNITY_WITNESSES.filter((w) => !WITNESS_STORES.includes(w));
    for (const w of rejected) {
      expect(w.resolveRate).toBeLessThan(DEFAULT_SCARCITY_CONFIG.witnessMinResolveRate);
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
    // Imperial Tropicals, AquaHuna, Nu Aqua. Nu Aqua is the one shop Ryan can
    // walk into, and it only became readable once the matcher stopped needing
    // a Latin binomial. If this drops below the minimum the whole rating goes
    // dark, so it is worth failing loudly rather than silently refusing.
    expect(WITNESS_STORES.length).toBeGreaterThanOrEqual(DEFAULT_SCARCITY_CONFIG.minimumWitnesses);
    expect(WITNESS_STORES.map((w) => w.storeId)).toContain('nu-aqua');
    for (const w of WITNESS_STORES) {
      expect(MARKET_INDEX.sources.some((s) => s.id === w.storeId)).toBe(true);
    }
  });

  it('rates a meaningful share of the catalog', () => {
    const rated = ids.length - counts['not-rated']!;
    expect(rated).toBeGreaterThan(250);
  });

  it('calls the commonest fish in the hobby widely available', () => {
    // Every one of these was "scarce" or "uncommon" under v0.1.0. This is the
    // assertion that would have caught the original bug.
    for (const name of ['Neon Tetra', 'Cardinal Tetra', 'Bristlenose Pleco', 'Harlequin Rasbora']) {
      const id = byCommonName.get(name);
      expect(id, `${name} missing from the catalog`).toBeDefined();
      const r = scarcityFor(id!);
      expect(r.available, `${name} not rated`).toBe(true);
      if (r.available) expect(r.band, `${name} read as ${r.band}`).toBe('widely-available');
    }
  });

  it('spreads across bands instead of piling into one', () => {
    // Four of five bands populated. "rarely-listed" stays empty on purpose:
    // it needs five witnesses, and there are three.
    const populated = ['widely-available', 'available', 'uncommon', 'scarce']
      .filter((b) => (counts[b] ?? 0) > 0);
    expect(populated).toHaveLength(4);
    expect(counts['rarely-listed'] ?? 0).toBe(0);
  });
});

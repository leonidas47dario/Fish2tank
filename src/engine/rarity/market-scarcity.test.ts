import { describe, expect, it } from 'vitest';
import {
  bandForScore, computeMarketScarcity, DEFAULT_SCARCITY_CONFIG, type MarketScarcityResult,
} from './market-scarcity';
import type { MarketSpeciesStats } from '@/data/market';

function stats(over: Partial<MarketSpeciesStats> = {}): MarketSpeciesStats {
  return {
    speciesId: 'sp_x', comparableCount: 10, totalListings: 10, inStock: 5, soldOut: 5,
    price: { median: 50, min: 10, max: 100, currency: 'USD' },
    priceBySize: [],
    // Built from the configured store count, so adding a vendor does not
    // silently invalidate every expectation in this file.
    stores: allStores(),
    ...over,
  };
}
const rate = (o: Partial<MarketSpeciesStats> = {}) => computeMarketScarcity(stats(o)) as MarketScarcityResult;

/** One entry per tracked store: the "carried everywhere" case. */
function allStores(n = DEFAULT_SCARCITY_CONFIG.trackedStores) {
  return Array.from({ length: n }, (_, i) => ({
    storeId: `s${i}`, listings: 2, inStock: 1, medianPrice: 50,
  }));
}

describe('absence is never evidence of scarcity', () => {
  it('returns not-enough-data for a species with no index entry', () => {
    const r = computeMarketScarcity(undefined);
    expect(r.available).toBe(false);
    if (!r.available) {
      expect(r.reason).toBe('Not enough data');
      // The critical wording: a missing species is an unmatched title, not a rare fish.
      expect(r.explanation).toMatch(/not that it is rare/i);
    }
  });

  it('refuses to rate below the minimum listing count', () => {
    const r = computeMarketScarcity(stats({ totalListings: 2 }));
    expect(r.available).toBe(false);
  });

  it('never reports a scarce band from missing data', () => {
    const r = computeMarketScarcity(undefined);
    expect(r).not.toHaveProperty('band');
    expect(r).not.toHaveProperty('score');
  });
});

describe('store breadth', () => {
  it('scores zero when every tracked store carries it', () => {
    expect(rate().components.storeBreadth).toBe(0);
  });

  it('scores maximum when only one store carries it', () => {
    const r = rate({ stores: [{ storeId: 'a', listings: 10, inStock: 5, medianPrice: 50 }] });
    expect(r.components.storeBreadth).toBe(DEFAULT_SCARCITY_CONFIG.points.storeBreadthMax);
  });

  it('falls between the extremes for a partially-carried species', () => {
    const max = DEFAULT_SCARCITY_CONFIG.points.storeBreadthMax;
    const half = Math.ceil(DEFAULT_SCARCITY_CONFIG.trackedStores / 2);
    const r = rate({ stores: allStores(half) });
    expect(r.components.storeBreadth).toBeGreaterThan(0);
    expect(r.components.storeBreadth).toBeLessThan(max);
  });

  it('scores monotonically: more stores carrying it is never scarcer', () => {
    let previous = Infinity;
    for (let n = 1; n <= DEFAULT_SCARCITY_CONFIG.trackedStores; n += 1) {
      const points = rate({ stores: allStores(n) }).components.storeBreadth;
      expect(points).toBeLessThanOrEqual(previous);
      previous = points;
    }
  });
});

describe('listing depth', () => {
  it('scores zero for a deep catalogue', () => {
    expect(rate({ totalListings: 40 }).components.listingDepth).toBe(0);
  });

  it('scores high for a thin one', () => {
    // 3 of 20 saturation -> 85% of the maximum.
    expect(rate({ totalListings: 3 }).components.listingDepth).toBe(26);
  });
});

describe('stock pressure', () => {
  it('scores maximum when everything is sold out', () => {
    const r = rate({ totalListings: 10, inStock: 0, soldOut: 10 });
    expect(r.components.stockPressure).toBe(DEFAULT_SCARCITY_CONFIG.points.stockPressureMax);
  });

  it('scores zero when everything is in stock', () => {
    expect(rate({ totalListings: 10, inStock: 10, soldOut: 0 }).components.stockPressure).toBe(0);
  });

  it('scales with the in-stock ratio', () => {
    expect(rate({ totalListings: 10, inStock: 5 }).components.stockPressure).toBe(13);
  });
});

describe('price level', () => {
  it('scores zero for a cheap fish', () => {
    expect(rate({ price: { median: 0, min: 0, max: 0, currency: 'USD' } }).components.priceLevel).toBe(0);
  });

  it('caps at the ceiling rather than running away', () => {
    const r = rate({ price: { median: 5000, min: 100, max: 9000, currency: 'USD' } });
    expect(r.components.priceLevel).toBe(DEFAULT_SCARCITY_CONFIG.points.priceLevelMax);
  });

  it('is the lowest-weighted signal, since price is weak evidence of scarcity', () => {
    const p = DEFAULT_SCARCITY_CONFIG.points;
    expect(p.priceLevelMax).toBeLessThan(p.storeBreadthMax);
    expect(p.priceLevelMax).toBeLessThan(p.listingDepthMax);
    expect(p.priceLevelMax).toBeLessThan(p.stockPressureMax);
  });
});

describe('bands', () => {
  const cases: Array<[number, string]> = [
    [0, 'widely-available'], [19, 'widely-available'],
    [20, 'available'], [39, 'available'],
    [40, 'uncommon'], [59, 'uncommon'],
    [60, 'scarce'], [79, 'scarce'],
    [80, 'rarely-listed'], [100, 'rarely-listed'],
  ];
  it.each(cases)('maps %i to %s', (score, band) => {
    expect(bandForScore(score, DEFAULT_SCARCITY_CONFIG)).toBe(band);
  });

  it('rates a common, always-stocked, cheap fish carried everywhere as widely available', () => {
    const r = rate({
      totalListings: 40, inStock: 38, stores: allStores(),
      price: { median: 15, min: 5, max: 30, currency: 'USD' },
    });
    expect(r.band).toBe('widely-available');
  });

  it('rates a one-store, thin, always-sold-out, expensive fish at the top', () => {
    const r = rate({
      totalListings: 3, inStock: 0, soldOut: 3,
      price: { median: 400, min: 300, max: 500, currency: 'USD' },
      stores: [{ storeId: 'a', listings: 3, inStock: 0, medianPrice: 400 }],
    });
    expect(r.band).toBe('rarely-listed');
    expect(r.score).toBeGreaterThanOrEqual(80);
  });
});

describe('transparency and determinism', () => {
  it('shows every component, not just a total', () => {
    expect(Object.keys(rate().components).sort())
      .toEqual(['listingDepth', 'priceLevel', 'stockPressure', 'storeBreadth']);
  });

  it('reports the basis the rating rests on', () => {
    const r = rate({ totalListings: 9, inStock: 0, stores: allStores(3) });
    expect(r.basis).toMatchObject({ storesCarrying: 3, totalListings: 9, inStock: 0 });
  });

  it('stamps the formula version', () => {
    expect(rate().formulaVersion).toBe(DEFAULT_SCARCITY_CONFIG.formulaVersion);
  });

  it('is deterministic', () => {
    expect(rate({ totalListings: 7 })).toEqual(rate({ totalListings: 7 }));
  });

  it('clamps to 0-100 even with retuned weights', () => {
    const generous = {
      ...DEFAULT_SCARCITY_CONFIG,
      points: { storeBreadthMax: 90, listingDepthMax: 90, stockPressureMax: 90, priceLevelMax: 90 },
    };
    const r = computeMarketScarcity(
      stats({ totalListings: 3, inStock: 0, stores: [{ storeId: 'a', listings: 3, inStock: 0, medianPrice: 400 }],
              price: { median: 400, min: 1, max: 500, currency: 'USD' } }),
      generous,
    ) as MarketScarcityResult;
    expect(r.score).toBe(100);
  });
});

describe('separation from the Discovery Tier (FR-P05)', () => {
  it('produces no field that the personal tier consumes', () => {
    const json = JSON.stringify(rate());
    expect(json).not.toMatch(/discoveryTier|personalEncounterScarcity|dreamList|firstConfirmed/i);
  });
});

describe('the store count cannot drift from the vendor list', () => {
  it('scarcityFor() uses the count the index was actually built from', async () => {
    const { MARKET_INDEX, TRACKED_STORES, scarcityFor } = await import('@/data/market');
    // Read from the data, never hardcoded: adding a vendor updates both at once.
    expect(TRACKED_STORES).toBe(MARKET_INDEX.sources.length);

    // The index now also publishes species it cannot price, so that their
    // vendors and links are visible; those deliberately do not rate. Pick one
    // that does, because the drift being guarded against is in the score.
    const speciesId = Object.keys(MARKET_INDEX.species)
      .find((id) => MARKET_INDEX.species[id]!.price)!;
    expect(speciesId).toBeDefined();
    const viaEntryPoint = scarcityFor(speciesId);
    const viaStaleDefault = computeMarketScarcity(MARKET_INDEX.species[speciesId], {
      ...DEFAULT_SCARCITY_CONFIG,
      trackedStores: 3, // what the config said before vendors were added
    });
    expect(viaEntryPoint.available).toBe(true);
    if (viaEntryPoint.available && viaStaleDefault.available) {
      // Demonstrates the bug this guards against: a stale count changes the score.
      expect(viaEntryPoint.components.storeBreadth)
        .not.toBe(viaStaleDefault.components.storeBreadth);
    }
  });

  it('returns not-enough-data for an unknown species through the entry point too', async () => {
    const { scarcityFor } = await import('@/data/market');
    expect(scarcityFor('sp_does_not_exist').available).toBe(false);
    expect(scarcityFor(undefined).available).toBe(false);
  });
});

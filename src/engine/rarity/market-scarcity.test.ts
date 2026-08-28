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
    stores: [
      { storeId: 'a', listings: 4, inStock: 2, medianPrice: 50 },
      { storeId: 'b', listings: 3, inStock: 2, medianPrice: 50 },
      { storeId: 'c', listings: 3, inStock: 1, medianPrice: 50 },
    ],
    ...over,
  };
}
const rate = (o: Partial<MarketSpeciesStats> = {}) => computeMarketScarcity(stats(o)) as MarketScarcityResult;

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

  it('scores in between for two stores', () => {
    const r = rate({ stores: [
      { storeId: 'a', listings: 5, inStock: 3, medianPrice: 50 },
      { storeId: 'b', listings: 5, inStock: 2, medianPrice: 50 },
    ] });
    expect(r.components.storeBreadth).toBe(15);
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

  it('rates a common, always-stocked, cheap fish as widely available', () => {
    const r = rate({ totalListings: 40, inStock: 38, price: { median: 15, min: 5, max: 30, currency: 'USD' } });
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
    const r = rate({ totalListings: 9, inStock: 0 });
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

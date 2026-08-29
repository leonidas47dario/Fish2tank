import { describe, expect, it } from 'vitest';
import { buildMarketIndex, DEFAULT_MIN_SAMPLE } from './index-builder';
import type { MarketListing } from './types';

let n = 0;
function listing(over: Partial<MarketListing> = {}): MarketListing {
  n += 1;
  return {
    storeId: 'predatory-fins', productId: n, variantId: n, handle: `h${n}`,
    url: `https://example.com/products/h${n}`, title: 'Jaguar Cichlid',
    tags: [], speciesId: 'sp_jaguar_cichlid', price: 50, currency: 'USD',
    size: { value: 4, unit: 'in', estimate: true }, sizeLabel: '4 inches',
    available: false, retrievedAt: '2026-08-28T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
const opts = { builtAt: '2026-08-28T00:00:00.000Z' };

describe('sample threshold', () => {
  /**
   * WHAT THE THRESHOLD GATES, AND WHAT IT DOES NOT.
   *
   * It gates the ESTIMATE - the median, the size range, the price ladder -
   * because those are claims about what a fish is worth and one listing cannot
   * support one. It does not gate the OBSERVATIONS. A vendor's page, its
   * asking price and whether it is in stock are facts, and withholding them
   * because there is only one left 779 of 1,076 species looking like nobody
   * sells them when the listings were sitting right there.
   */
  it('publishes the observations below the minimum sample count, but no estimate', () => {
    const idx = buildMarketIndex([listing(), listing()], opts);
    const s = idx.species['sp_jaguar_cichlid']!;
    expect(s).toBeDefined();
    expect(s.totalListings).toBe(2);
    expect(s.comparableCount).toBe(2);
    expect(s.stores[0]!.productUrl).toBeTruthy();
    // No claim about what it is worth.
    expect(s.price).toBeUndefined();
    expect(s.sizeRangeIn).toBeUndefined();
    expect(s.priceBySize).toEqual([]);
    expect(idx.minimumSampleCount).toBe(DEFAULT_MIN_SAMPLE);
  });

  it('publishes a single listing, with the price of that listing', () => {
    const idx = buildMarketIndex(
      [listing({ storeId: 'j4-flowerhorns', price: 25, size: undefined, sizeLabel: 'Default Title', available: true })],
      opts,
    );
    const s = idx.species['sp_jaguar_cichlid']!;
    expect(s.totalListings).toBe(1);
    expect(s.price).toBeUndefined();
    const store = s.stores[0]!;
    expect(store.storeId).toBe('j4-flowerhorns');
    expect(store.productPrice).toBe(25);
    expect(store.productSizeLabel).toBe('Default Title');
    expect(store.productInStock).toBe(true);
  });

  it('adds the estimate once the threshold is met', () => {
    const idx = buildMarketIndex([listing(), listing(), listing()], opts);
    const s = idx.species['sp_jaguar_cichlid']!;
    expect(s.comparableCount).toBe(3);
    expect(s.price?.median).toBe(50);
  });

  it('counts only size-bearing listings toward the threshold', () => {
    // Three listings but only two have a size: shown, but not priced.
    const idx = buildMarketIndex([listing(), listing(), listing({ size: undefined })], opts);
    const s = idx.species['sp_jaguar_cichlid']!;
    expect(s.totalListings).toBe(3);
    expect(s.comparableCount).toBe(2);
    expect(s.price).toBeUndefined();
  });

  it('still reports unsized listings in the totals once published', () => {
    const idx = buildMarketIndex(
      [listing(), listing(), listing(), listing({ size: undefined })], opts,
    );
    const s = idx.species['sp_jaguar_cichlid']!;
    expect(s.comparableCount).toBe(3);
    expect(s.totalListings).toBe(4);
  });

  it('ignores a zero-priced listing when counting comparables', () => {
    // A £0 listing is a placeholder, not a bargain. It still counts as a
    // listing the store published, so the species is shown; it just cannot
    // help support an estimate.
    const idx = buildMarketIndex([listing(), listing(), listing({ price: 0 })], opts);
    const s = idx.species['sp_jaguar_cichlid']!;
    expect(s.totalListings).toBe(3);
    expect(s.comparableCount).toBe(2);
    expect(s.price).toBeUndefined();
  });
});

describe('price statistics', () => {
  it('reports median, min and max', () => {
    const idx = buildMarketIndex(
      [listing({ price: 10 }), listing({ price: 50 }), listing({ price: 90 })], opts,
    );
    expect(idx.species['sp_jaguar_cichlid']!.price).toMatchObject({ median: 50, min: 10, max: 90, currency: 'USD' });
  });

  it('splits in-stock from sold-out', () => {
    const idx = buildMarketIndex(
      [listing({ available: true }), listing({ available: false }), listing({ available: false })], opts,
    );
    const s = idx.species['sp_jaguar_cichlid']!;
    expect(s.inStock).toBe(1);
    expect(s.soldOut).toBe(2);
  });
});

describe('the size ladder', () => {
  it('buckets prices by whole inch instead of pooling the range', () => {
    // The real Predatory Fins jaguar ladder.
    const idx = buildMarketIndex([
      listing({ price: 12, size: { value: 1.25, unit: 'in' } }),
      listing({ price: 38, size: { value: 4.25, unit: 'in' } }),
      listing({ price: 85, size: { value: 6.25, unit: 'in' } }),
      listing({ price: 250, size: { value: 12, unit: 'in' } }),
    ], opts);
    expect(idx.species['sp_jaguar_cichlid']!.priceBySize).toEqual([
      { sizeIn: 1, medianPrice: 12, listings: 1 },
      { sizeIn: 4, medianPrice: 38, listings: 1 },
      { sizeIn: 6, medianPrice: 85, listings: 1 },
      { sizeIn: 12, medianPrice: 250, listings: 1 },
    ]);
  });

  it('floors into the band a buyer would name it', () => {
    // "4 - 4.5 inches" has a 4.25 midpoint and belongs in the 4in band.
    const idx = buildMarketIndex([
      listing({ price: 38, size: { value: 4.25, unit: 'in' } }),
      listing({ price: 42, size: { value: 4.75, unit: 'in' } }),
      listing({ price: 40, size: { value: 4, unit: 'in' } }),
    ], opts);
    const ladder = idx.species['sp_jaguar_cichlid']!.priceBySize;
    expect(ladder).toHaveLength(1);
    expect(ladder[0]).toEqual({ sizeIn: 4, medianPrice: 40, listings: 3 });
  });

  it('converts centimetre listings into the same inch ladder', () => {
    const idx = buildMarketIndex([
      listing({ price: 20, size: { value: 10, unit: 'cm' } }),  // ~3.9in
      listing({ price: 30, size: { value: 10.5, unit: 'cm' } }),
      listing({ price: 25, size: { value: 10.2, unit: 'cm' } }),
    ], opts);
    expect(idx.species['sp_jaguar_cichlid']!.priceBySize[0]!.sizeIn).toBe(3);
  });
});

describe('per-store breakdown', () => {
  it('reports listings and median per store, busiest first', () => {
    const idx = buildMarketIndex([
      listing({ storeId: 'predatory-fins', price: 50 }),
      listing({ storeId: 'predatory-fins', price: 70 }),
      listing({ storeId: 'j4-flowerhorns', price: 100 }),
    ], opts);
    const stores = idx.species['sp_jaguar_cichlid']!.stores;
    expect(stores[0]).toMatchObject({ storeId: 'predatory-fins', listings: 2, medianPrice: 60 });
    expect(stores[1]).toMatchObject({ storeId: 'j4-flowerhorns', listings: 1, medianPrice: 100 });
  });
});

describe('unmatched species are surfaced, not dropped', () => {
  it('collects binomials that matched no catalog entry, most common first', () => {
    const idx = buildMarketIndex([
      listing({ speciesId: undefined, scientificNameInTitle: 'Astronotus ocellatus' }),
      listing({ speciesId: undefined, scientificNameInTitle: 'Astronotus ocellatus' }),
      listing({ speciesId: undefined, scientificNameInTitle: 'Potamotrygon leopoldi' }),
    ], opts);
    expect(idx.unmatchedScientificNames).toEqual([
      { scientificName: 'Astronotus ocellatus', listings: 2 },
      { scientificName: 'Potamotrygon leopoldi', listings: 1 },
    ]);
  });
});

describe('rarity separation (FR-P05)', () => {
  it('emits no rarity or tier field anywhere in the index', () => {
    // Online availability must never feed collecting rarity. If a future
    // change adds a rarity signal here, this fails.
    const idx = buildMarketIndex([listing(), listing(), listing()], opts);
    const json = JSON.stringify(idx);
    expect(json).not.toMatch(/"rarity/i);
    expect(json).not.toMatch(/"tier/i);
    expect(json).not.toMatch(/discoveryScore/i);
  });
});

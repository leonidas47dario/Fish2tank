import { describe, expect, it } from 'vitest';
import {
  blendOwnPrices, summariseOwnPrices, DEFAULT_OWN_PRICE_CONFIG, OWN_RECORDS_STORE_ID,
} from './own-prices';
import type { MarketSpeciesStats } from '@/data/market';
import type { PriceObservation } from '@/domain/types';

const NOW = new Date('2026-08-30T00:00:00.000Z');

const obs = (over: Partial<PriceObservation> = {}): PriceObservation => ({
  id: `price_${Math.random().toString(36).slice(2)}`,
  speciesId: 'sp_x',
  askingPrice: 20,
  currency: 'USD',
  basis: 'each',
  packageQuantity: 1,
  observedAt: '2026-08-01T00:00:00.000Z',
  source: 'in-store',
  ...over,
});

const vendor = (over: Partial<MarketSpeciesStats> = {}): MarketSpeciesStats => ({
  speciesId: 'sp_x',
  comparableCount: 4,
  totalListings: 4,
  inStock: 2,
  soldOut: 2,
  price: { median: 10, min: 8, max: 12, currency: 'USD' },
  priceBySize: [{ sizeIn: 3, medianPrice: 10, listings: 4 }],
  stores: [{ storeId: 'store-a', listings: 4, inStock: 2, medianPrice: 10 }],
  ...over,
});

const opts = { speciesId: 'sp_x', currency: 'USD' as const, minimumSampleCount: 3, now: NOW };

describe('which of a keeper\'s observations may speak', () => {
  it('normalises a lot price to a per-fish price', () => {
    // "$41.99 for 3 Fish" must never read as $41.99 a fish.
    const s = summariseOwnPrices([obs({ askingPrice: 42, packageQuantity: 3 })], opts);
    expect(s.points[0]!.unitPrice).toBe(14);
  });

  it('prefers the member price, because that is what you would pay', () => {
    const s = summariseOwnPrices([obs({ askingPrice: 30, memberPrice: 24 })], opts);
    expect(s.points[0]!.unitPrice).toBe(24);
  });

  it.each([
    ['different-species', obs({ speciesId: 'sp_other' })],
    ['different-currency', obs({ currency: 'EUR' })],
    ['no-price-recorded', obs({ askingPrice: undefined })],
    ['missing-package-quantity', obs({ packageQuantity: 0 })],
    ['outside-date-window', obs({ observedAt: '2020-01-01T00:00:00.000Z' })],
  ])('excludes an observation for %s', (reason, o) => {
    const s = summariseOwnPrices([o], opts);
    expect(s.points).toHaveLength(0);
    expect(s.excluded[0]!.reason).toBe(reason);
  });

  /** A rate nobody has is worse than an exclusion somebody can see. */
  it('never converts a currency', () => {
    const s = summariseOwnPrices([obs({ currency: 'EUR', askingPrice: 100 })], opts);
    expect(s.median).toBeUndefined();
  });

  it('reports its own median over the counted points', () => {
    const s = summariseOwnPrices(
      [obs({ askingPrice: 10 }), obs({ askingPrice: 20 }), obs({ askingPrice: 30 })],
      opts,
    );
    expect(s.median).toBe(20);
  });
});

describe('blending own prices into the market', () => {
  it('moves the estimate toward what you actually saw', () => {
    // Vendor: 4 listings at a $10 median. You logged $30 twice.
    const b = blendOwnPrices(vendor(), [obs({ askingPrice: 30 }), obs({ askingPrice: 30 })], opts)!;
    // Pool is 10,10,10,10,30,30 -> median 10, and the max moves to 30.
    expect(b.price!.median).toBe(10);
    expect(b.price!.max).toBe(30);
    expect(b.own.basis).toBe('blended');
    // The vendor aggregate stood in for its listings, and the result says so.
    expect(b.own.approximated).toBe(true);
  });

  it('keeps the vendor sample weight, rather than treating it as one point', () => {
    // If the vendor median counted once, two of your $30s would drag the
    // median to 30. Weighted by its four listings, it does not.
    const b = blendOwnPrices(vendor(), [obs({ askingPrice: 30 }), obs({ askingPrice: 30 })], opts)!;
    expect(b.price!.median).toBeLessThan(30);
  });

  it('shows your records as their own source', () => {
    const b = blendOwnPrices(vendor(), [obs({ askingPrice: 30 }), obs({ askingPrice: 40 })], opts)!;
    const mine = b.stores.find((s) => s.storeId === OWN_RECORDS_STORE_ID)!;
    expect(mine.listings).toBe(2);
    expect(mine.medianPrice).toBe(35);
  });

  /**
   * The case that makes this worth building: 1,703 species have no vendor
   * price at all, and your own record was the only evidence in the app.
   */
  it('creates an estimate for a species the vendors cannot price', () => {
    const unpriced = vendor({ price: undefined, priceBySize: [], stores: [], comparableCount: 0, totalListings: 0 });
    const b = blendOwnPrices(
      unpriced,
      [obs({ askingPrice: 10 }), obs({ askingPrice: 20 }), obs({ askingPrice: 30 })],
      opts,
    )!;
    expect(b.price!.median).toBe(20);
    expect(b.own.basis).toBe('own-only');
    expect(b.own.approximated).toBe(false);
  });

  it('still refuses a median under the sample floor, whoever supplied the points', () => {
    const unpriced = vendor({ price: undefined, priceBySize: [], stores: [], comparableCount: 0, totalListings: 0 });
    const b = blendOwnPrices(unpriced, [obs({ askingPrice: 10 }), obs({ askingPrice: 20 })], opts)!;
    // Two is what the rest of the app already calls not enough.
    expect(b.price).toBeUndefined();
    expect(b.own.points).toHaveLength(2);
  });

  it('leaves a vendor row untouched when nothing of yours counts', () => {
    const v = vendor();
    const b = blendOwnPrices(v, [obs({ currency: 'EUR' })], opts)!;
    expect(b.price).toEqual(v.price);
    expect(b.stores).toEqual(v.stores);
    expect(b.own.basis).toBe('vendor-only');
  });

  it('does not pool across a currency the vendor priced in', () => {
    const eur = vendor({ price: { median: 10, min: 8, max: 12, currency: 'EUR' } });
    const b = blendOwnPrices(eur, [obs({ askingPrice: 30 })], opts)!;
    // The vendor figure has the larger sample, so it stands alone.
    expect(b.price!.currency).toBe('EUR');
    expect(b.price!.median).toBe(10);
    expect(b.own.basis).toBe('vendor-only');
  });

  it('returns nothing when there is nothing at all to say', () => {
    expect(blendOwnPrices(undefined, [], opts)).toBeUndefined();
    expect(blendOwnPrices(undefined, [obs({ currency: 'EUR' })], opts)).toBeUndefined();
  });

  it('puts a sized observation in the band a buyer would call it', () => {
    // 4.25in floors to the 4in band, exactly as the index builder does.
    const b = blendOwnPrices(
      vendor({ priceBySize: [] }),
      [obs({ askingPrice: 25, observedSize: { value: 4.25, unit: 'in' } })],
      opts,
    )!;
    expect(b.priceBySize).toEqual([{ sizeIn: 4, medianPrice: 25, listings: 1 }]);
  });

  /**
   * The bug this pins: folding observations in one at a time and re-medianing
   * makes step two's median step three's input, so 180/200/240 came out at
   * $190. Every own value is in hand; only the vendor side needs approximating.
   */
  it('medians a band over all your prices at once, not one at a time', () => {
    const at24 = (price: number) =>
      obs({ askingPrice: price, observedSize: { value: 24, unit: 'in' } });
    const b = blendOwnPrices(
      vendor({ priceBySize: [] }),
      [at24(180), at24(200), at24(240)],
      opts,
    )!;
    expect(b.priceBySize).toEqual([{ sizeIn: 24, medianPrice: 200, listings: 3 }]);
  });

  it('merges your prices into a band the vendors already have', () => {
    const b = blendOwnPrices(
      vendor({ priceBySize: [{ sizeIn: 3, medianPrice: 10, listings: 2 }] }),
      [obs({ askingPrice: 30, observedSize: { value: 3, unit: 'in' } }),
       obs({ askingPrice: 30, observedSize: { value: 3.9, unit: 'in' } })],
      opts,
    )!;
    // Pool 10,10,30,30 -> median 20, over four listings.
    expect(b.priceBySize).toEqual([{ sizeIn: 3, medianPrice: 20, listings: 4 }]);
  });

  it('converts centimetres before banding', () => {
    const b = blendOwnPrices(
      vendor({ priceBySize: [] }),
      [obs({ askingPrice: 25, observedSize: { value: 10.16, unit: 'cm' } })],  // 4in
      opts,
    )!;
    expect(b.priceBySize[0]!.sizeIn).toBe(4);
  });

  it('is idempotent — blending twice does not double-count', () => {
    const once = blendOwnPrices(vendor(), [obs({ askingPrice: 30 })], opts)!;
    const twice = blendOwnPrices(once, [obs({ askingPrice: 30 })], opts)!;
    expect(twice.stores.filter((s) => s.storeId === OWN_RECORDS_STORE_ID)).toHaveLength(1);
  });

  it('carries a version, so a stored figure can be traced to its rules', () => {
    expect(DEFAULT_OWN_PRICE_CONFIG.version).toMatch(/^own-prices-v/);
  });
});

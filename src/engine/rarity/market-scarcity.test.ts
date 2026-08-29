import { describe, expect, it } from 'vitest';
import {
  bandForScore, computeMarketScarcity, DEFAULT_SCARCITY_CONFIG,
  type MarketScarcityResult, type ScarcityWitness,
} from './market-scarcity';
import type { MarketSpeciesStats } from '@/data/market';

/** Witnesses well clear of the gate, so a test opts into the gate deliberately. */
const witnesses = (n: number): ScarcityWitness[] =>
  Array.from({ length: n }, (_, i) => ({ storeId: `w${i}`, resolveRate: 0.5, coverage: 0.5 }));

function stats(storeIds: string[], listingsEach = 2): MarketSpeciesStats {
  return {
    speciesId: 'sp_x',
    comparableCount: storeIds.length * listingsEach,
    totalListings: storeIds.length * listingsEach,
    inStock: 1,
    soldOut: 1,
    price: { median: 50, min: 10, max: 100, currency: 'USD' },
    priceBySize: [],
    stores: storeIds.map((storeId) => ({
      storeId, listings: listingsEach, inStock: 1, medianPrice: 50,
    })),
  };
}

const rate = (ids: string[], n = 4, each = 2) =>
  computeMarketScarcity(stats(ids, each), witnesses(n)) as MarketScarcityResult;

describe('breadth is the rating', () => {
  it('scores zero when every witness carries it', () => {
    expect(rate(['w0', 'w1', 'w2', 'w3']).components.storeBreadth).toBe(0);
  });

  it('scores highest when exactly one witness carries it', () => {
    expect(rate(['w0']).components.storeBreadth).toBe(75); // 100 * (1 - 1/4)
  });

  it('falls monotonically as more witnesses carry it', () => {
    let previous = Infinity;
    for (let n = 1; n <= 4; n += 1) {
      const points = rate(['w0', 'w1', 'w2', 'w3'].slice(0, n)).components.storeBreadth;
      expect(points).toBeLessThanOrEqual(previous);
      previous = points;
    }
  });

  it('ignores specialist stores entirely: they are not witnesses', () => {
    const withPf = rate(['w0', 'predatory-fins']);
    expect(withPf.score).toBe(rate(['w0']).score);
    expect(withPf.basis.carriedBy).toEqual(['w0']);
  });
});

describe('depth is a nudge, not a signal', () => {
  it('is negative: a deep catalogue makes a fish more findable, never less', () => {
    expect(rate(['w0'], 4, 40).components.listingDepth).toBeLessThan(0);
  });

  it('caps at the configured maximum', () => {
    expect(rate(['w0'], 4, 10_000).components.listingDepth)
      .toBe(-DEFAULT_SCARCITY_CONFIG.depthNudgeMax);
  });

  it('never outweighs breadth', () => {
    // One witness with a huge catalogue still outranks two witnesses.
    expect(rate(['w0'], 4, 10_000).score).toBeGreaterThan(rate(['w0', 'w1'], 4, 2).score);
  });
});

describe('the witness gate', () => {
  it('refuses when the community stores cannot resolve their own catalogues', () => {
    const weak: ScarcityWitness[] = [
      { storeId: 'w0', resolveRate: 0.02, coverage: 0.5 },
      { storeId: 'w1', resolveRate: 0.03, coverage: 0.5 },
    ];
    const r = computeMarketScarcity(stats(['w0']), weak);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe('No local-shelf sample');
  });

  it('rates the same species once those stores clear the threshold', () => {
    const strong: ScarcityWitness[] = [
      { storeId: 'w0', resolveRate: 0.5, coverage: 0.5 },
      { storeId: 'w1', resolveRate: 0.5, coverage: 0.5 },
    ];
    expect(computeMarketScarcity(stats(['w0']), strong).available).toBe(true);
  });

  it('uses the configured threshold, not a hardcoded one', () => {
    const stores: ScarcityWitness[] = [
      { storeId: 'w0', resolveRate: 0.05, coverage: 0.5 },
      { storeId: 'w1', resolveRate: 0.05, coverage: 0.5 },
    ];
    const lenient = { ...DEFAULT_SCARCITY_CONFIG, witnessMinResolveRate: 0.01 };
    expect(computeMarketScarcity(stats(['w0']), stores, lenient).available).toBe(true);
  });

  it('refuses a store that is legible but carries almost nothing', () => {
    // Aquarium Co-Op's shape: clean listings, 1.6% of the catalog. Its
    // silence is coverage, not scarcity.
    const thin: ScarcityWitness[] = [
      { storeId: 'w0', resolveRate: 0.5, coverage: 0.5 },
      { storeId: 'w1', resolveRate: 0.5, coverage: 0.01 },
    ];
    const r = computeMarketScarcity(stats(['w0']), thin);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe('No local-shelf sample');
  });

  it('refuses on a single witness, because one store cannot make a comparison', () => {
    const r = computeMarketScarcity(stats(['w0']), witnesses(1));
    expect(r.available).toBe(false);
    if (!r.available) expect(r.explanation).toMatch(/at least 2 general stores/i);
  });
});

describe('refusing to rate is one rule: no witness carries it', () => {
  it('refuses for a species with no index entry', () => {
    const r = computeMarketScarcity(undefined, witnesses(4));
    expect(r.available).toBe(false);
    if (!r.available) {
      expect(r.reason).toBe('Not enough data');
      // A missing species is an unmatched title, not a rare fish.
      expect(r.explanation).toMatch(/not that it is rare/i);
    }
  });

  it('refuses for a species only specialists carry, rather than calling it rare', () => {
    const r = computeMarketScarcity(stats(['predatory-fins']), witnesses(4));
    expect(r.available).toBe(false);
    expect(r).not.toHaveProperty('band');
    expect(r).not.toHaveProperty('score');
  });

  it('names the stores that do carry it, so the refusal is diagnosable', () => {
    const r = computeMarketScarcity(stats(['predatory-fins']), witnesses(4));
    if (!r.available) expect(r.explanation).toMatch(/predatory-fins/);
  });

  it('rates a species the vendors never sized, now that price is gone', () => {
    // v0.1.0 refused these outright, because the price component had no median
    // to read. Breadth does not need one.
    const unpriced = { ...stats(['w0', 'w1']), price: undefined };
    expect(computeMarketScarcity(unpriced, witnesses(4)).available).toBe(true);
  });
});

describe('the ceiling rises with the witness count', () => {
  // The band comes from breadth = 100 * (1 - 1/N), so a sole-witness fish
  // climbs as the sample grows. The guard against "fixing" thin coverage by
  // loosening the gate: doing that has to move visible bands.
  const sole = (n: number) => rate(['w0'], n);

  it('cannot call anything rarely listed on two witnesses', () => {
    expect(sole(2).components.storeBreadth).toBe(50);
    expect(sole(2).band).toBe('uncommon');
  });

  it('reaches scarce at three', () => {
    expect(sole(3).band).toBe('scarce');
  });

  it('reaches rarely listed at four, which the real store list can produce', () => {
    // The point of taking depth out of the band decision. While the nudge
    // could move a band, breadth 75 scored 72 and the top band was
    // unreachable at every witness count STORE_CHANNELS can actually yield.
    expect(sole(4).components.storeBreadth).toBe(75);
    expect(sole(4).band).toBe('rarely-listed');
  });

  it('stays there as more witnesses join', () => {
    expect(sole(6).band).toBe('rarely-listed');
  });
});

describe('depth orders within a band but never moves one', () => {
  it('gives the same band to a thin and a deep sole-witness listing', () => {
    const thin = rate(['w0'], 4, 1);
    const deep = rate(['w0'], 4, 500);
    expect(thin.band).toBe(deep.band);
    // ...while still ranking the deep one as easier to find.
    expect(deep.score).toBeLessThan(thin.score);
  });

  it('is not swayed across a boundary by variant granularity', () => {
    // `listings` counts Shopify variant rows, so one product split into 20
    // sizes must not promote a fish a whole band. This is the assertion that
    // keeps that catalogue artifact out of the rating.
    const bands = new Set([1, 5, 20, 100, 1000].map((n) => rate(['w0'], 3, n).band));
    expect(bands.size).toBe(1);
  });
});

describe('the deleted signals stay deleted', () => {
  it('exposes only breadth and depth', () => {
    expect(Object.keys(rate(['w0']).components).sort()).toEqual(['listingDepth', 'storeBreadth']);
  });

  it('ignores stock: most of the dataset is sold-out back catalogue', () => {
    const base = stats(['w0', 'w1']);
    const soldOut = computeMarketScarcity({ ...base, inStock: 0, soldOut: 4 }, witnesses(4));
    const stocked = computeMarketScarcity({ ...base, inStock: 4, soldOut: 0 }, witnesses(4));
    expect(soldOut).toEqual(stocked);
  });

  it('ignores price: it is a consequence of rarity, not evidence of it', () => {
    const base = stats(['w0', 'w1']);
    const dear = computeMarketScarcity(
      { ...base, price: { median: 5000, min: 1000, max: 9000, currency: 'USD' } },
      witnesses(4),
    ) as MarketScarcityResult;
    expect(dear.score).toBe(rate(['w0', 'w1']).score);
  });
});

describe('bands', () => {
  const cases: Array<[number, string]> = [
    [0, 'widely-available'], [19, 'widely-available'],
    [20, 'available'], [39, 'available'],
    [40, 'uncommon'], [59, 'uncommon'],
    [60, 'scarce'], [74, 'scarce'],
    [75, 'rarely-listed'], [100, 'rarely-listed'],
  ];
  it.each(cases)('maps %i to %s', (score, band) => {
    expect(bandForScore(score, DEFAULT_SCARCITY_CONFIG)).toBe(band);
  });
});

describe('transparency and determinism', () => {
  it('reports the basis the rating rests on', () => {
    expect(rate(['w0', 'w1'], 4).basis).toMatchObject({
      witnessesCarrying: 2, witnessesTracked: 4, witnessListings: 4,
    });
  });

  it('stamps the formula version', () => {
    expect(rate(['w0']).formulaVersion).toBe('market-scarcity-v1.0.0');
  });

  it('is deterministic', () => {
    expect(rate(['w0', 'w1'])).toEqual(rate(['w0', 'w1']));
  });

  it('clamps to 0-100', () => {
    expect(rate(['w0', 'w1', 'w2', 'w3'], 4, 10_000).score).toBe(0);
  });
});

describe('separation from the Discovery Tier (FR-P05)', () => {
  it('produces no field that the personal tier consumes', () => {
    const json = JSON.stringify(rate(['w0']));
    expect(json).not.toMatch(/discoveryTier|personalEncounterScarcity|dreamList|firstConfirmed/i);
  });
});

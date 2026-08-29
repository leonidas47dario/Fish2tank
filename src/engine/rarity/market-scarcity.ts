/**
 * Market scarcity - how hard a fish is to BUY from the tracked stores.
 *
 * This is a second, separate rating that sits alongside the Personal Discovery
 * Tier. It is not folded into it, and that separation is deliberate:
 *
 *   - Discovery Tier (PRD 5.3) answers "how novel is this to ME" from Ryan's
 *     own catch history and Dream List.
 *   - Market scarcity answers "how hard is this to source online" from 3,395
 *     listings across three mail-order retailers.
 *
 * They genuinely differ. A fish Predatory Fins stocks continuously may still
 * be one Ryan has never seen in a Chicago shop, and a flowerhorn that is
 * always sold out online may be on every local shelf. Averaging the two would
 * produce a number that answers neither question, which is what FR-P05
 * ("online availability never increases collecting rarity") is protecting
 * against. Showing both, labelled, gives strictly more information.
 *
 * THE MOST IMPORTANT RULE HERE. Absence from the index is NOT evidence of
 * scarcity. Only 7% of listings resolve to a catalog species, so a fish
 * missing from the index is overwhelmingly likely to be an unmatched title
 * rather than a rare animal. Missing data returns "not enough data", never
 * "rarely listed" - the same discipline the compatibility engine follows.
 */
import type { MarketSpeciesStats } from '@/data/market';

export type MarketScarcityBand =
  | 'widely-available'
  | 'available'
  | 'uncommon'
  | 'scarce'
  | 'rarely-listed';

export interface MarketScarcityComponents {
  /** Fewer of the tracked stores carrying it means narrower supply. */
  storeBreadth: number;
  /** A thin back catalogue means it is seldom offered. */
  listingDepth: number;
  /** Consistently sold out means you cannot get one when you want one. */
  stockPressure: number;
  /** Priced well above the typical indexed species. */
  priceLevel: number;
}

export interface MarketScarcityConfig {
  formulaVersion: string;
  points: {
    storeBreadthMax: number;
    listingDepthMax: number;
    stockPressureMax: number;
    priceLevelMax: number;
  };
  /**
   * Total vendors behind the index.
   *
   * Do not rely on the default: callers should pass the real count, which
   * `scarcityFor()` in data/market.ts reads from the index itself. The default
   * exists only so the engine is usable standalone in tests.
   */
  trackedStores: number;
  /** Listings at or above which a species counts as freely offered. */
  depthSaturation: number;
  /** Median price at or above which the price signal maxes out. */
  priceCeiling: number;
  /** Below this many listings we decline to rate at all. */
  minimumListings: number;
  bands: Array<{ band: MarketScarcityBand; minScore: number }>;
}

export const DEFAULT_SCARCITY_CONFIG: MarketScarcityConfig = {
  formulaVersion: 'market-scarcity-v0.1.0',
  points: { storeBreadthMax: 30, listingDepthMax: 30, stockPressureMax: 25, priceLevelMax: 15 },
  trackedStores: 8,
  depthSaturation: 20,
  priceCeiling: 200,
  minimumListings: 3,
  bands: [
    { band: 'rarely-listed', minScore: 80 },
    { band: 'scarce', minScore: 60 },
    { band: 'uncommon', minScore: 40 },
    { band: 'available', minScore: 20 },
    { band: 'widely-available', minScore: 0 },
  ],
};

export interface MarketScarcityResult {
  available: true;
  score: number;
  band: MarketScarcityBand;
  components: MarketScarcityComponents;
  formulaVersion: string;
  /** Carried through so the UI can show what the rating rests on. */
  basis: {
    storesCarrying: number;
    totalListings: number;
    inStock: number;
    medianPrice: number;
    currency: string;
  };
}

export interface MarketScarcityUnavailable {
  available: false;
  reason: string;
  explanation: string;
}

export type MarketScarcity = MarketScarcityResult | MarketScarcityUnavailable;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function bandForScore(score: number, cfg: MarketScarcityConfig): MarketScarcityBand {
  for (const b of cfg.bands) if (score >= b.minScore) return b.band;
  return 'widely-available';
}

/**
 * Rate a species from its market index entry.
 *
 * Pass `undefined` for a species with no entry - the result is explicitly
 * "not enough data", because absence here means "we could not match the
 * title", not "nobody sells it".
 */
export function computeMarketScarcity(
  stats: MarketSpeciesStats | undefined,
  cfg: MarketScarcityConfig = DEFAULT_SCARCITY_CONFIG,
): MarketScarcity {
  if (!stats) {
    return {
      available: false,
      reason: 'Not enough data',
      explanation:
        'This species does not appear in the tracked stores. That most likely means its listing title did not match the catalog, not that it is rare - only a small share of listings resolve to a known species. Absence is not evidence of scarcity.',
    };
  }
  if (stats.totalListings < cfg.minimumListings) {
    return {
      available: false,
      reason: 'Not enough data',
      explanation: `Only ${stats.totalListings} listing${stats.totalListings === 1 ? '' : 's'} found, below the ${cfg.minimumListings} needed to say anything useful.`,
    };
  }

  const storesCarrying = stats.stores.length;
  const { points } = cfg;

  // Narrower supply scores higher. Carried by every tracked store scores zero.
  const breadthFraction = clamp01((cfg.trackedStores - storesCarrying) / Math.max(1, cfg.trackedStores - 1));
  const storeBreadth = Math.round(points.storeBreadthMax * breadthFraction);

  // A thin catalogue scores higher; past saturation it is freely offered.
  const depthFraction = clamp01(1 - stats.totalListings / cfg.depthSaturation);
  const listingDepth = Math.round(points.listingDepthMax * depthFraction);

  // Consistently sold out scores higher.
  const inStockRatio = stats.totalListings > 0 ? stats.inStock / stats.totalListings : 0;
  const stockPressure = Math.round(points.stockPressureMax * clamp01(1 - inStockRatio));

  // Expensive relative to the ceiling. A weak signal, weighted lowest.
  const priceFraction = clamp01(stats.price.median / cfg.priceCeiling);
  const priceLevel = Math.round(points.priceLevelMax * priceFraction);

  const components: MarketScarcityComponents = { storeBreadth, listingDepth, stockPressure, priceLevel };
  const score = Math.max(0, Math.min(100, storeBreadth + listingDepth + stockPressure + priceLevel));

  return {
    available: true,
    score,
    band: bandForScore(score, cfg),
    components,
    formulaVersion: cfg.formulaVersion,
    basis: {
      storesCarrying,
      totalListings: stats.totalListings,
      inStock: stats.inStock,
      medianPrice: stats.price.median,
      currency: stats.price.currency,
    },
  };
}

export const SCARCITY_LABELS: Record<MarketScarcityBand, string> = {
  'widely-available': 'Widely available',
  available: 'Available',
  uncommon: 'Uncommon',
  scarce: 'Scarce',
  'rarely-listed': 'Rarely listed',
};

export const SCARCITY_COMPONENT_LABELS: Record<keyof MarketScarcityComponents, string> = {
  storeBreadth: 'Carried by few of the tracked stores',
  listingDepth: 'Seldom offered',
  stockPressure: 'Usually sold out',
  priceLevel: 'Priced above the typical species',
};

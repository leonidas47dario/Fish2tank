/**
 * Market reference data - reading side.
 *
 * The index is built offline by the ETL (see etl/) and shipped as a static
 * JSON asset. There is no runtime scraping: the app never touches a store.
 *
 * WHAT THIS IS ALLOWED TO INFLUENCE. Price estimation only. FR-P05 states
 * "Online availability never increases collecting rarity in the MVP", and
 * FR-R07 forbids objective rarity claims below a sample threshold. Nothing
 * exported here is read by the Discovery Tier.
 */
import type { LengthMeasurement } from '@/domain/types';
import { toCm } from '@/domain/units';
import { computeMarketScarcity, DEFAULT_SCARCITY_CONFIG } from '@/engine/rarity/market-scarcity';
import indexJson from './seed/market/market-index.json';

export interface MarketSizeBand {
  sizeIn: number;
  medianPrice: number;
  listings: number;
}

export interface MarketSpeciesStats {
  speciesId: string;
  comparableCount: number;
  totalListings: number;
  inStock: number;
  soldOut: number;
  price: { median: number; min: number; max: number; currency: string };
  sizeRangeIn?: { min: number; max: number };
  priceBySize: MarketSizeBand[];
  stores: Array<{ storeId: string; listings: number; inStock: number; medianPrice: number }>;
  listedBetween?: { earliest: string; latest: string };
}

export interface MarketIndex {
  schemaVersion: number;
  builtAt: string;
  minimumSampleCount: number;
  sources: Array<{ id: string; name: string; host: string; listingsFetched: number; retrievedAt: string }>;
  species: Record<string, MarketSpeciesStats>;
  unmatchedScientificNames: Array<{ scientificName: string; listings: number }>;
}

export const MARKET_INDEX = indexJson as unknown as MarketIndex;

export const STORE_NAMES: Record<string, string> = Object.fromEntries(
  MARKET_INDEX.sources.map((s) => [s.id, s.name]),
);

export function marketFor(speciesId: string | undefined): MarketSpeciesStats | undefined {
  if (!speciesId) return undefined;
  return MARKET_INDEX.species[speciesId];
}

/**
 * How many vendors produced this index.
 *
 * Read from the data rather than configured, because the scarcity rating
 * divides by it. A hardcoded count that drifts from the real vendor list
 * silently mis-rates every species - and it drifts the moment someone adds a
 * store without remembering there is a second place to update.
 */
export const TRACKED_STORES = MARKET_INDEX.sources.length;

/**
 * Rate a species' market scarcity with the store count the index was actually
 * built from.
 *
 * The single entry point the UI should use. Calling computeMarketScarcity
 * directly with the default config works, but risks the drift above; this
 * cannot.
 */
export function scarcityFor(speciesId: string | undefined) {
  return computeMarketScarcity(marketFor(speciesId), {
    ...DEFAULT_SCARCITY_CONFIG,
    trackedStores: TRACKED_STORES,
  });
}

/**
 * The band matching an observed size.
 *
 * This is the number that actually answers "is this fish well priced". A
 * pooled median across a jaguar cichlid's $12-at-1-inch to $250-at-12-inches
 * range answers a question nobody asked.
 */
export function bandForSize(
  stats: MarketSpeciesStats,
  size: LengthMeasurement | undefined,
): MarketSizeBand | undefined {
  const cm = toCm(size);
  if (cm === undefined) return undefined;
  const inch = Math.floor(cm / 2.54);
  return stats.priceBySize.find((b) => b.sizeIn === inch);
}

/**
 * How old the newest listing behind these numbers is.
 *
 * Sold-out listings are frozen at their publish date - most of this dataset is
 * the back catalogue, and some of it is years old. A price the user cannot
 * date is a price they cannot judge, so this drives a visible warning rather
 * than being left implicit.
 */
export function marketAgeDays(stats: MarketSpeciesStats, now: Date = new Date()): number | undefined {
  const latest = stats.listedBetween?.latest;
  if (!latest) return undefined;
  return Math.floor((now.getTime() - Date.parse(latest)) / 86_400_000);
}

export const STALE_AFTER_DAYS = 365;

export function isStale(stats: MarketSpeciesStats, now: Date = new Date()): boolean {
  const age = marketAgeDays(stats, now);
  return age !== undefined && age > STALE_AFTER_DAYS;
}

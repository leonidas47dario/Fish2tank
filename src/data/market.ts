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
import {
  computeMarketScarcity, DEFAULT_SCARCITY_CONFIG, type ScarcityWitness,
} from '@/engine/rarity/market-scarcity';
import { STORE_CHANNELS } from './store-channels';
import indexJson from './seed/marts/market-index.json';

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
  /**
   * Absent when too few listings carry a size to estimate from. The stores
   * below are still real and still linked - absence of a price is not absence
   * of a market. See hasPriceEstimate().
   */
  price?: { median: number; min: number; max: number; currency: string };
  sizeRangeIn?: { min: number; max: number };
  priceBySize: MarketSizeBand[];
  stores: Array<{
    storeId: string;
    listings: number;
    inStock: number;
    medianPrice: number;
    /** Deep link to the store's product page, so a price can be checked at source. */
    productUrl?: string;
    /** Whether that link points at something in stock. Never inferred. */
    productInStock?: boolean;
    /** That listing's own asking price. One observation, not an aggregate. */
    productPrice?: number;
    /** And the option text it is priced for - "3 Fish", "4 - 4.5 inches". */
    productSizeLabel?: string;
  }>;
  listedBetween?: { earliest: string; latest: string };
}

export interface MarketIndex {
  schemaVersion: number;
  builtAt: string;
  minimumSampleCount: number;
  sources: Array<{ id: string; name: string; host: string; listingsFetched: number; retrievedAt: string }>;
  /** Vendors the ETL could not reach. Present only on a --allow-partial build. */
  partial?: Array<{ storeId: string; reason: string }>;
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
 * Whether this species has enough size-bearing listings to be worth a number.
 *
 * The distinction the whole panel turns on: a species can have real vendors,
 * real links and real asking prices and still not support an estimate. Ask
 * this before rendering anything that reads as "what it costs"; render the
 * store references either way.
 */
export function hasPriceEstimate(
  stats: MarketSpeciesStats | undefined,
): stats is MarketSpeciesStats & { price: NonNullable<MarketSpeciesStats['price']> } {
  return stats?.price !== undefined;
}

/**
 * How many vendors produced this index.
 *
 * Read from the data rather than configured. The UI quotes it; it no longer
 * drives the rating, which counts witnesses instead - see WITNESS_STORES.
 */
export const TRACKED_STORES = MARKET_INDEX.sources.length;

/** Listings each store actually contributed to the published index. */
function publishedListingsByStore(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stats of Object.values(MARKET_INDEX.species)) {
    for (const s of stats.stores) counts[s.storeId] = (counts[s.storeId] ?? 0) + s.listings;
  }
  return counts;
}

/**
 * What share of each store's catalogue the index could actually read.
 *
 * The number the witness gate turns on, and derived rather than declared so it
 * can never disagree with the index it describes.
 *
 * It counts PUBLISHED listings, so it excludes species buildMarketIndex
 * dropped. That makes it a little lower than the ETL's own match rate, which
 * is the conservative direction for a gate: a store whose match was dropped
 * genuinely cannot testify about that species either.
 */
export const STORE_RESOLVE_RATES: Record<string, number> = (() => {
  const published = publishedListingsByStore();
  return Object.fromEntries(
    MARKET_INDEX.sources.map((s) => [
      s.id,
      s.listingsFetched > 0 ? (published[s.id] ?? 0) / s.listingsFetched : 0,
    ]),
  );
})();

/** Every community-channel store in the index, gate not yet applied. */
export const COMMUNITY_WITNESSES: ScarcityWitness[] = MARKET_INDEX.sources
  .filter((s) => STORE_CHANNELS[s.id] === 'community')
  .map((s) => ({ storeId: s.id, resolveRate: STORE_RESOLVE_RATES[s.id] ?? 0 }));

/**
 * The community stores that clear the gate - the actual denominator.
 *
 * Exported so the UI can say how many shelves the rating rests on, rather than
 * implying it consulted every vendor in the list.
 */
export const WITNESS_STORES: ScarcityWitness[] = COMMUNITY_WITNESSES.filter(
  (w) => w.resolveRate >= DEFAULT_SCARCITY_CONFIG.witnessMinResolveRate,
);

/**
 * Rate a species' local-shelf scarcity.
 *
 * The single entry point the UI should use. Calling computeMarketScarcity
 * directly works but risks passing a witness list that drifted from the index;
 * this cannot.
 */
export function scarcityFor(speciesId: string | undefined) {
  return computeMarketScarcity(marketFor(speciesId), COMMUNITY_WITNESSES);
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

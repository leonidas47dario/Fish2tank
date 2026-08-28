/**
 * ETL types - market price sourcing.
 *
 * Scope note (PRD 4.5 / FR-P06): "Automate selected public pricing research
 * only after source licensing and normalization are approved. Automated values
 * retain source, retrieval date, shipping, size, and confidence."
 *
 * So every record below carries where it came from and when it was retrieved.
 * A listing is never collapsed into a bare number.
 */
import type { LengthMeasurement } from '@/domain/types';

export interface StoreConfig {
  /** Stable key used in output files and the market index. */
  id: string;
  name: string;
  host: string;
  /** Coarse location, for context only. Never used to infer local rarity. */
  region?: string;
  /**
   * Shopify's products.json does not report a currency, so it is declared per
   * store rather than assumed globally. All three tracked stores are US-based
   * and list in USD; a non-USD store would need this set correctly before its
   * prices could be pooled with the others.
   */
  currency: string;
}

/** One store listing at one size, normalized. The unit of the dataset. */
export interface MarketListing {
  storeId: string;
  productId: number;
  variantId: number;
  handle: string;
  url: string;
  title: string;
  vendor?: string;
  productType?: string;
  tags: string[];

  /** Resolved catalog species, when the title matched confidently. */
  speciesId?: string;
  /** How the match was made, so a bad match is traceable. */
  matchMethod?: 'scientific-name' | 'common-name' | 'alias';
  /** Scientific name lifted from the title, even when it matched no catalog entry. */
  scientificNameInTitle?: string;

  /** Listed price for this variant. */
  price: number;
  /** Shopify's "was" price, when the listing shows one. */
  compareAtPrice?: number;
  currency: string;

  /**
   * Size parsed from the variant option. Undefined when the option carried no
   * usable size ("Default Title", "Large") - left unknown rather than guessed,
   * because the price engine excludes size-unknown listings from comparison
   * rather than mis-comparing a juvenile against an adult.
   */
  size?: LengthMeasurement;
  /** The raw option text, always kept. */
  sizeLabel?: string;

  /** False means sold out. The sold-out backlog is most of this dataset. */
  available: boolean;
  /** When the product was first published by the store. */
  publishedAt?: string;
  /** Last time the store touched the record. Not a price-change timestamp. */
  updatedAt?: string;

  /** When WE fetched it (NFR-05, FR-P06: retain retrieval date). */
  retrievedAt: string;
}

/** Per-species aggregate shipped with the app. */
export interface MarketSpeciesStats {
  speciesId: string;
  /** Listings that carried a usable size, and so can be price-compared. */
  comparableCount: number;
  /** Every listing matched to this species, sized or not. */
  totalListings: number;
  inStock: number;
  soldOut: number;
  price: {
    median: number;
    min: number;
    max: number;
    currency: string;
  };
  sizeRangeIn?: { min: number; max: number };
  /**
   * Median price per inch-band.
   *
   * A single median is close to useless for these fish: a jaguar cichlid runs
   * $12 at 1in and $250 at 12in, so pooling the range answers a question
   * nobody asked. The ladder is what actually tells you whether the fish in
   * front of you is well priced at the size it actually is.
   */
  priceBySize: Array<{ sizeIn: number; medianPrice: number; listings: number }>;
  /** Which stores carry it and how many listings each. */
  stores: Array<{ storeId: string; listings: number; inStock: number; medianPrice: number }>;
  /** Earliest and latest publish date seen, as a rough catalogue span. */
  listedBetween?: { earliest: string; latest: string };
}

export interface MarketIndex {
  schemaVersion: 1;
  builtAt: string;
  /** Minimum comparable listings before stats are published at all. */
  minimumSampleCount: number;
  sources: Array<StoreConfig & { listingsFetched: number; retrievedAt: string }>;
  species: Record<string, MarketSpeciesStats>;
  /**
   * Titles that look like a species we do not have in the catalog. Surfaced so
   * the gap is visible rather than silently dropped.
   */
  unmatchedScientificNames: Array<{ scientificName: string; listings: number }>;
}

export const STORES: StoreConfig[] = [
  { id: 'global-exoticquatics', name: 'Global Exoticquatics', host: 'globalexoticquatics.com', currency: 'USD' },
  { id: 'j4-flowerhorns', name: 'J4 Flowerhorns', host: 'www.j4flowerhorns.com', currency: 'USD' },
  { id: 'predatory-fins', name: 'Predatory Fins', host: 'www.predatoryfins.com', currency: 'USD' },
];

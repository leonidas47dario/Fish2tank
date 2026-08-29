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
import type { MatchMethod } from './normalize/species';

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
  /**
   * What the store mostly sells.
   *
   * Declared because LiveAquaria is overwhelmingly marine - corals, anemones
   * and reef fish - while every other tracked store and every tank the owner
   * actually keeps is freshwater. Without this the catalog fills with 3,000
   * coral frags that no freshwater keeper will ever screen, and the library
   * stops being about their hobby. Used to tag the species it discovers, not
   * to exclude the store.
   */
  waterType?: 'freshwater' | 'marine' | 'mixed';
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
  /**
   * How the species was resolved, so a bad match is traceable.
   * 'derived-binomial' means the vendor stated a scientific name the curated
   * catalog does not cover, and a species was minted from it.
   * 'product-type' means the binomial came from Shopify's product_type field
   * rather than the title - see etl/normalize/species.ts.
   */
  matchMethod?: MatchMethod;
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
  /**
   * What the fish is worth, or absent when too few listings carry a size to
   * say. Absent does NOT mean unsold: the stores below are still real, and
   * still linked. See the threshold note in index-builder.ts.
   */
  price?: {
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
  stores: Array<{
    storeId: string;
    listings: number;
    inStock: number;
    medianPrice: number;
    /**
     * A link straight to the product page, so a price can be checked against
     * the shop rather than taken on trust.
     *
     * Which listing it points at matters. A store often has several listings
     * for one species, and the useful one is the one you can actually buy, so
     * an in-stock listing is always preferred over a sold-out one. Absent when
     * the store's listings carry no usable URL.
     */
    productUrl?: string;
    /** Whether productUrl points at something in stock. Never implied. */
    productInStock?: boolean;
    /** That listing's own asking price. One observation, not an aggregate. */
    productPrice?: number;
    /** And the option text it is priced for - "3 Fish", "4 - 4.5 inches". */
    productSizeLabel?: string;
  }>;
  /** Earliest and latest publish date seen, as a rough catalogue span. */
  listedBetween?: { earliest: string; latest: string };
}

export interface MarketIndex {
  schemaVersion: 1;
  builtAt: string;
  /** Minimum comparable listings before stats are published at all. */
  minimumSampleCount: number;
  sources: Array<StoreConfig & { listingsFetched: number; retrievedAt: string }>;
  /**
   * Stores that STORES declares but that did not contribute to this build.
   *
   * Present only on an index published with --allow-partial. Every median here
   * and the market-scarcity denominator behind it were computed over the
   * stores that answered, so an index missing a vendor is a different
   * measurement, not the same one with a gap. Recorded in the artifact rather
   * than only in a console line nobody kept.
   */
  partial?: Array<{ storeId: string; reason: string }>;
  species: Record<string, MarketSpeciesStats>;
  /**
   * Titles that look like a species we do not have in the catalog. Surfaced so
   * the gap is visible rather than silently dropped.
   */
  unmatchedScientificNames: Array<{ scientificName: string; listings: number }>;
}

/**
 * Tracked vendors.
 *
 * Every one is a Shopify storefront whose robots.txt states that public
 * product data is crawlable, and none disallow /products.json - checked per
 * host, not assumed from the platform.
 *
 * Breadth matters for more than volume. With only three stores, "carried by
 * one store" was worth 30 scarcity points on very thin evidence, which is why
 * largemouth bass - a fish you would buy from a pond supplier, not an exotics
 * importer - rated as rarely listed. More independent vendors make that signal
 * mean something.
 */
export const STORES: StoreConfig[] = [
  { id: 'global-exoticquatics', name: 'Global Exoticquatics', host: 'globalexoticquatics.com', currency: 'USD' },
  { id: 'j4-flowerhorns', name: 'J4 Flowerhorns', host: 'www.j4flowerhorns.com', currency: 'USD' },
  { id: 'predatory-fins', name: 'Predatory Fins', host: 'www.predatoryfins.com', currency: 'USD' },
  { id: 'imperial-tropicals', name: 'Imperial Tropicals', host: 'imperialtropicals.com', currency: 'USD' },
  { id: 'aquatic-arts', name: 'Aquatic Arts', host: 'aquaticarts.com', currency: 'USD' },
  { id: 'aquarium-coop', name: 'Aquarium Co-Op', host: 'www.aquariumcoop.com', currency: 'USD' },
  { id: 'flip-aquatics', name: 'Flip Aquatics', host: 'flipaquatics.com', currency: 'USD' },
  { id: 'aquahuna', name: 'AquaHuna', host: 'www.aquahuna.com', currency: 'USD' },
  /**
   * Added 2026-08-29. Both verified the same way as the original eight:
   * Shopify, robots.txt states public product data is crawlable, and neither
   * disallows /products.json.
   *
   * Nu Aqua is a Chicagoland shop (Orland Park, IL) and the first tracked
   * vendor the owner can actually walk into, which is the point - this app is
   * about the fish in front of you, and a local price is the one that decides
   * anything. 936 products.
   *
   * LiveAquaria is Petco's aquatics brand, and is here because Petco itself
   * cannot be read: it is not Shopify, exposes no product feed, and is blocked
   * at the network edge. This is the honest substitute for a big-box baseline,
   * and it is tagged marine because that is what it mostly sells. 3,000
   * products.
   */
  { id: 'nu-aqua', name: 'Nu Aqua', host: 'nuaquashop.com', region: 'Chicagoland', currency: 'USD', waterType: 'freshwater' },
  { id: 'liveaquaria', name: 'LiveAquaria', host: 'www.liveaquaria.com', currency: 'USD', waterType: 'marine' },
];

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
   * What the store sells, when it sells ONE kind only.
   *
   * A fallback, not the primary signal. Vendors that sort their own shop by
   * salinity tag it per product, and those tags always win - see
   * normalize/water-type.ts. This exists for the nine freshwater specialists
   * that tag nothing, whose catalogues would otherwise read as unknown.
   *
   * 'mixed' means "do not assume": the store sells both, so only its
   * per-listing tags may speak for it. LiveAquaria is the case that made this
   * necessary. It used to declare 'marine' on the grounds of being
   * "overwhelmingly marine", which was measurably wrong - 1,147 of its
   * livestock listings are tagged freshwater, and the blanket declaration was
   * filing roughly 180 freshwater species under saltwater.
   */
  waterType?: 'freshwater' | 'marine' | 'mixed';
  /**
   * Which reader this store needs.
   *
   * Absent means Shopify, because every store tracked before the big-box
   * vendors was one and re-stating it ten times would say nothing.
   */
  platform?: 'shopify' | 'petsmart' | 'petco';
  /**
   * What this vendor actually contributes, stated up front so a reader is
   * never left wondering whether zero listings means a broken run.
   *
   * 'listings'       - prices and products, the normal case.
   * 'store-locations' - branches only, by design rather than by accident.
   *
   * Petco declares 'listings' because the pipeline attempts them on every run.
   * Whether it GETS them depends on whether its CDN edge accepts the caller,
   * which is a property of the network rather than of the configuration - so
   * the outcome is recorded per run as MarketIndex.sources[].accessNote, not
   * frozen into this table. See sources/petco.ts.
   */
  dataScope?: 'listings' | 'store-locations';
}

/**
 * A physical branch of a vendor.
 *
 * This is the first thing in the dataset that is not mail order. Every vendor
 * up to now answered "can this fish be shipped to me"; a branch answers "is it
 * in a tank I can drive to", which is the question this app was built around.
 */
export interface LocalStore {
  vendorId: string;
  /** The vendor's own store number, normalized (no zero padding). */
  storeNumber: string;
  name: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  /** The page this was read from, so any row can be checked. */
  url: string;
  /**
   * Departments the branch says it operates, verbatim. Empty means the vendor
   * publishes no department list - which is not the same as having no fish,
   * and must never be read as one.
   */
  departments: string[];
}

/**
 * On-hand stock of one sku at one branch, at one moment.
 *
 * Deliberately its own record rather than a field on MarketListing. A listing
 * is a price the vendor publishes nationally; this is a count in one building
 * that changes hourly. Folding them together would let a stale count masquerade
 * as a price observation, and the grain of fact_listing would stop being true.
 */
export interface StoreInventory {
  vendorId: string;
  storeNumber: string;
  sku: string;
  /**
   * Units in the store. Null means the vendor reported nothing for this sku at
   * this store, which is not zero - see `carried`.
   */
  onHand: number | null;
  /** Whether the store carries the sku at all, however many it has today. */
  carried: boolean;
  retrievedAt: string;
}

/**
 * A product from a vendor that is not Shopify, in the shape the normalizer
 * needs. Shopify products keep their own richer type; this is the minimum a
 * MarketListing can honestly be built from.
 */
export interface RetailProduct {
  productId: string;
  variantId: string;
  sku: string;
  title: string;
  url: string;
  /** The page actually fetched, when it differs from the canonical url. */
  sourceUrl?: string;
  price: number;
  compareAtPrice?: number;
  currency: string;
  available: boolean;
  productType?: string;
  imageUrl?: string;
  gtin?: string;
  tags: string[];
  /** Vendor-stated size text, when there is one. Never inferred.  */
  sizeLabel?: string;
  publishedAt?: string;
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
  sources: Array<StoreConfig & {
    listingsFetched: number;
    retrievedAt: string;
    /**
     * Why this vendor contributed no listings, when it contributed none for a
     * reason rather than by scope. Present on Petco whenever its storefront
     * refused the run, so a zero in the shipped index is always explained
     * rather than left looking like a broken pipeline.
     */
    accessNote?: string;
  }>;
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
  { id: 'global-exoticquatics', name: 'Global Exoticquatics', host: 'globalexoticquatics.com', currency: 'USD', waterType: 'freshwater' },
  { id: 'j4-flowerhorns', name: 'J4 Flowerhorns', host: 'www.j4flowerhorns.com', currency: 'USD', waterType: 'freshwater' },
  { id: 'predatory-fins', name: 'Predatory Fins', host: 'www.predatoryfins.com', currency: 'USD', waterType: 'freshwater' },
  { id: 'imperial-tropicals', name: 'Imperial Tropicals', host: 'imperialtropicals.com', currency: 'USD', waterType: 'freshwater' },
  { id: 'aquatic-arts', name: 'Aquatic Arts', host: 'aquaticarts.com', currency: 'USD', waterType: 'freshwater' },
  { id: 'aquarium-coop', name: 'Aquarium Co-Op', host: 'www.aquariumcoop.com', currency: 'USD', waterType: 'freshwater' },
  { id: 'flip-aquatics', name: 'Flip Aquatics', host: 'flipaquatics.com', currency: 'USD', waterType: 'freshwater' },
  { id: 'aquahuna', name: 'AquaHuna', host: 'www.aquahuna.com', currency: 'USD', waterType: 'freshwater' },
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
  { id: 'liveaquaria', name: 'LiveAquaria', host: 'www.liveaquaria.com', currency: 'USD', waterType: 'mixed' },
  /**
   * Added 2026-08-29. The first two big-box vendors, and the first two that
   * are not Shopify - each needed its own reader, and each was permission-
   * checked on its own host rather than by brand.
   *
   * PETSMART is readable and generous about it. Its robots.txt names the
   * sitemap and explicitly allows the store-inventory search endpoint for
   * every user agent, and every product page publishes schema.org Product
   * JSON-LD. It also does something no vendor here has done before: reports
   * on-hand counts per store, so the dataset can finally say whether a fish is
   * in a tank down the road today rather than only whether it can be shipped.
   * Chicago has eight branches; all eight are sampled.
   *
   * PETCO contributes locations only, and the entry says so via dataScope
   * rather than looking like a failed run. www.petco.com answers HTTP 403 from
   * the CDN edge to every automated request - robots.txt included, browser
   * User-Agent included - so there is no retrievable crawl permission and no
   * permitted route to its catalogue. Its Yext-hosted store directory at
   * stores.petco.com is a different host with a different answer: no Disallow
   * rules, its own sitemaps, and schema.org PetStore records naming each
   * branch's departments. That is where the Chicago aquatics departments come
   * from. The nearest honest substitute for Petco's prices is LiveAquaria
   * above, which is Petco's own aquatics brand.
   */
  {
    id: 'petsmart', name: 'PetSmart', host: 'www.petsmart.com', currency: 'USD',
    platform: 'petsmart', dataScope: 'listings', waterType: 'freshwater',
  },
  {
    id: 'petco', name: 'Petco', host: 'stores.petco.com', currency: 'USD',
    platform: 'petco', dataScope: 'listings', waterType: 'mixed',
  },
];

/**
 * The branches sampled for on-hand stock.
 *
 * Chicago, because that is where the owner actually shops, and because the
 * PRD's rarity language is about Chicago encounters specifically. City-wide
 * rather than a hand-picked few: eight PetSmart and eight Petco branches is
 * small enough to be polite and complete enough that "no Chicago store has
 * it" means something.
 */
export const SAMPLED_CITY = { state: 'il', citySlug: 'chicago', label: 'Chicago, IL' } as const;

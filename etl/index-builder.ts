/**
 * Aggregate normalized listings into the per-species market index.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR.
 *
 * For: price estimation. PRD FR-P06 sanctions automated pricing research that
 * "retains source, retrieval date, shipping, size, and confidence", and every
 * figure here carries its sample count and size range.
 *
 * NOT for: rarity. FR-P05 is explicit - "Online availability never increases
 * collecting rarity in the MVP" - and FR-R07 forbids objective rarity claims
 * below a sample threshold. Three mail-order retailers measure how easy a fish
 * is to BUY ONLINE, which is a different thing from how rarely Ryan encounters
 * one in a Chicago shop. Nothing in this file feeds the Discovery Tier, and
 * the app renders it in a separate panel labelled market availability.
 */
import type { MarketIndex, MarketListing, MarketSpeciesStats, StoreConfig } from './types';
import { median } from '@/engine/pricing/price-fit';
import { toCm } from '@/domain/units';

/** Below this many size-bearing listings, no price stats are published. */
export const DEFAULT_MIN_SAMPLE = 3;

function inches(l: MarketListing): number | undefined {
  const cm = toCm(l.size);
  return cm === undefined ? undefined : cm / 2.54;
}

export interface BuildOptions {
  minimumSampleCount?: number;
  builtAt?: string;
  sources?: Array<StoreConfig & { listingsFetched: number; retrievedAt: string }>;
  /** Stores that were configured but did not contribute. See MarketIndex.partial. */
  partial?: Array<{ storeId: string; reason: string }>;
}

export function buildMarketIndex(listings: MarketListing[], options: BuildOptions = {}): MarketIndex {
  const minimumSampleCount = options.minimumSampleCount ?? DEFAULT_MIN_SAMPLE;

  const bySpecies = new Map<string, MarketListing[]>();
  const unmatched = new Map<string, number>();

  for (const l of listings) {
    if (l.speciesId) {
      const bucket = bySpecies.get(l.speciesId) ?? [];
      bucket.push(l);
      bySpecies.set(l.speciesId, bucket);
    } else if (l.scientificNameInTitle) {
      unmatched.set(l.scientificNameInTitle, (unmatched.get(l.scientificNameInTitle) ?? 0) + 1);
    }
  }

  const species: Record<string, MarketSpeciesStats> = {};

  for (const [speciesId, all] of bySpecies) {
    // Only size-bearing listings can be honestly price-compared: a $20 juvenile
    // and a $200 adult of the same species are not the same product.
    const comparable = all.filter((l) => l.size !== undefined && l.price > 0);

    /**
     * The threshold gates the ESTIMATE, not the OBSERVATIONS.
     *
     * It used to skip the species outright, which conflated two different
     * statements: "we cannot say what this is worth" and "nobody sells this".
     * The first was true; the second was a fabrication, and it applied to 779
     * of 1,076 species. Butterfly Fish had six listings across three stores,
     * one of them J4's at $25, and the app showed no market data at all
     * because only two of the six carried a parseable size.
     *
     * So a species with any listing at all is published with its stores, their
     * asking prices and their links. `price`, `sizeRangeIn` and `priceBySize`
     * stay absent until there are enough size-bearing samples to mean
     * something - the app renders the references and says plainly that it
     * cannot estimate, which is FR-P06 satisfied rather than dodged.
     */
    const estimable = comparable.length >= minimumSampleCount;

    const prices = comparable.map((l) => l.price);
    const sizes = comparable.map(inches).filter((n): n is number => n !== undefined);

    const storeIds = [...new Set(all.map((l) => l.storeId))];
    const stores = storeIds.map((storeId) => {
      const mine = all.filter((l) => l.storeId === storeId);
      const minePriced = mine.filter((l) => l.size !== undefined && l.price > 0).map((l) => l.price);

      // Link to something you can actually buy. Most of this dataset is
      // sold-out back catalogue, so picking the first listing would usually
      // send you to a dead page; an in-stock one wins whenever there is one.
      const linkable = mine.filter((l) => l.url);
      const best = linkable.find((l) => l.available) ?? linkable[0];

      return {
        storeId,
        listings: mine.length,
        inStock: mine.filter((l) => l.available).length,
        medianPrice: minePriced.length ? round2(median(minePriced)) : 0,
        // The linked listing's own price and option text. A fact about one
        // listing rather than an aggregate, so it stays true where a median
        // would not: "3 Fish - $41.99" must never read as $41.99 a fish.
        ...(best
          ? {
              productUrl: best.url,
              productInStock: best.available,
              ...(best.price > 0 ? { productPrice: round2(best.price) } : {}),
              ...(best.sizeLabel ? { productSizeLabel: best.sizeLabel } : {}),
            }
          : {}),
      };
    });

    // Bucket by whole inch. Floor rather than round, so a "4 - 4.5 inches"
    // listing (midpoint 4.25) lands in the 4in band a buyer would call it.
    const buckets = new Map<number, number[]>();
    for (const l of comparable) {
      const inch = inches(l);
      if (inch === undefined) continue;
      const band = Math.max(0, Math.floor(inch));
      const bucket = buckets.get(band) ?? [];
      bucket.push(l.price);
      buckets.set(band, bucket);
    }
    const priceBySize = [...buckets.entries()]
      .map(([sizeIn, ps]) => ({ sizeIn, medianPrice: round2(median(ps)), listings: ps.length }))
      .sort((a, b) => a.sizeIn - b.sizeIn);

    const published = all.map((l) => l.publishedAt).filter((d): d is string => Boolean(d)).sort();

    species[speciesId] = {
      speciesId,
      comparableCount: comparable.length,
      totalListings: all.length,
      inStock: all.filter((l) => l.available).length,
      soldOut: all.filter((l) => !l.available).length,
      ...(estimable
        ? {
            price: {
              median: round2(median(prices)),
              min: round2(Math.min(...prices)),
              max: round2(Math.max(...prices)),
              // Pooling is only valid because every tracked store lists in the
              // same currency; StoreConfig.currency is what guarantees that.
              currency: comparable[0]!.currency,
            },
            ...(sizes.length
              ? { sizeRangeIn: { min: round2(Math.min(...sizes)), max: round2(Math.max(...sizes)) } }
              : {}),
          }
        : {}),
      priceBySize: estimable ? priceBySize : [],
      stores: stores.sort((a, b) => b.listings - a.listings),
      listedBetween: published.length
        ? { earliest: published[0]!.slice(0, 10), latest: published[published.length - 1]!.slice(0, 10) }
        : undefined,
    };
  }

  return {
    schemaVersion: 1,
    builtAt: options.builtAt ?? new Date().toISOString(),
    minimumSampleCount,
    sources: options.sources ?? [],
    ...(options.partial?.length ? { partial: options.partial } : {}),
    species,
    unmatchedScientificNames: [...unmatched.entries()]
      .map(([scientificName, listings]) => ({ scientificName, listings }))
      .sort((a, b) => b.listings - a.listings)
      .slice(0, 100),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

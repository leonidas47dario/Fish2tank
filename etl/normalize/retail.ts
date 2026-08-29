/**
 * Turn a non-Shopify retail product into a normalized MarketListing.
 *
 * The counterpart to normalize/listing.ts, which handles Shopify's richer
 * product+variant shape. Everything downstream - the index, the warehouse, the
 * app - sees one type, so a big-box listing is compared on exactly the same
 * terms as a specialist importer's.
 *
 * Kept a pure function so the whole normalization step is testable without
 * touching the network.
 */
import type { Species } from '@/domain/types';
import type { MarketListing, RetailProduct, StoreConfig } from '../types';
import { parseSize } from './size';
import { buildMatcher } from './species';
import { derivedSpeciesId } from './derive-species';

/** The last path segment of a product URL, which is the vendor's own slug. */
export function handleFromUrl(url: string): string {
  const path = url.split('?')[0]!.split('#')[0]!;
  const last = path.split('/').filter(Boolean).pop() ?? '';
  return last.replace(/\.html$/, '');
}

/**
 * A numeric key for a sku that may not be numeric.
 *
 * fact_listing types product_id and variant_id as BIGINT, and PetSmart skus
 * happen to be numeric. A vendor whose skus are not gets a stable hash rather
 * than a collision at zero.
 */
export function numericKey(sku: string): number {
  const n = Number(sku);
  if (Number.isSafeInteger(n) && n > 0) return n;
  let h = 2166136261;
  for (let i = 0; i < sku.length; i += 1) {
    h = Math.imul(h ^ sku.charCodeAt(i), 16777619);
  }
  return Math.abs(h);
}

export function normalizeRetailProduct(
  store: StoreConfig,
  product: RetailProduct,
  match: ReturnType<typeof buildMatcher>,
  retrievedAt: string,
): MarketListing {
  const m = match(product.title, product.productType);

  /**
   * Same rule as the Shopify path: a binomial the curated catalog does not
   * cover still names a real species, so it gets a derived id. It never
   * guesses that one fish is another.
   *
   * In practice this fires far less often here. A big-box retailer titles its
   * fish by trade name - "Delhezi Bichir", "Comet Goldfish" - where a
   * specialist writes "Polypterus delhezi". So most of these listings resolve
   * to no species at all, which is the honest outcome: the vendor never said
   * which species it was, and inferring one from a trade name is exactly the
   * mis-match that filed Bass under Peacock Bass.
   */
  const speciesId = m.speciesId
    ?? (m.scientificNameInTitle ? derivedSpeciesId(m.scientificNameInTitle) : undefined);
  const matchMethod: MarketListing['matchMethod'] = m.speciesId
    ? m.method
    : (m.scientificNameInTitle ? 'derived-binomial' : undefined);

  /**
   * ONLY a size the vendor actually stated as a size.
   *
   * Never the title. PetSmart titles its live plants "... Live Aquarium Plant
   * for Fish Tanks - 4 in", where the 4 in is the pot, and its tanks by
   * gallonage; mining a marketing string for the first number it contains is
   * how a plant pot becomes a fish length and poisons a size ladder. Big-box
   * live fish are sold at one unstated size, so in practice this leaves the
   * size unknown - which correctly excludes them from price comparison rather
   * than comparing a $19.99 bichir against a ladder it has no rung on.
   */
  const parsed = parseSize(product.sizeLabel);

  return {
    storeId: store.id,
    productId: numericKey(product.productId),
    variantId: numericKey(product.variantId),
    handle: handleFromUrl(product.sourceUrl ?? product.url),
    url: product.url,
    title: product.title,
    vendor: store.name,
    productType: product.productType,
    tags: product.tags ?? [],

    speciesId,
    matchMethod,
    scientificNameInTitle: m.scientificNameInTitle,

    price: Number.isFinite(product.price) ? product.price : 0,
    compareAtPrice: product.compareAtPrice,
    currency: product.currency || store.currency,

    size: parsed.size,
    sizeLabel: parsed.label || undefined,

    available: product.available,
    publishedAt: product.publishedAt,
    retrievedAt,
  };
}

export function normalizeRetailStore(
  store: StoreConfig,
  products: RetailProduct[],
  catalog: Species[],
  retrievedAt: string,
): MarketListing[] {
  const match = buildMatcher(catalog);
  return products.map((p) => normalizeRetailProduct(store, p, match, retrievedAt));
}

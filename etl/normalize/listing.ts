/**
 * Turn a Shopify product + variant into a normalized MarketListing.
 *
 * Kept as a pure function so the whole normalization step is testable without
 * touching the network.
 */
import type { Species } from '@/domain/types';
import type { MarketListing, StoreConfig } from '../types';
import type { ShopifyProduct, ShopifyVariant } from '../sources/shopify';
import { productUrl } from '../sources/shopify';
import { parseSize } from './size';
import { buildMatcher } from './species';
import { derivedSpeciesId } from './derive-species';

/**
 * The size can appear on any of the three option slots depending on how the
 * store set the product up ("Sizes", "Size", "Fish Size"), so each is tried in
 * order and the first that yields a real measurement wins.
 */
function sizeFromVariant(variant: ShopifyVariant) {
  const candidates = [variant.option1, variant.option2, variant.option3, variant.title];
  for (const c of candidates) {
    const parsed = parseSize(c);
    if (parsed.size) return parsed;
  }
  // Nothing parsed: keep the most informative label we saw for the record.
  return parseSize(variant.option1 ?? variant.title);
}

export function normalizeProduct(
  store: StoreConfig,
  product: ShopifyProduct,
  match: ReturnType<typeof buildMatcher>,
  retrievedAt: string,
): MarketListing[] {
  const m = match(product.title, product.product_type);

  /**
   * A binomial the curated catalog does not cover still names a real species,
   * so it gets a derived id rather than being dropped. Without this the
   * library showed 47 of the 1,068 species these vendors actually sell.
   *
   * Note what this is NOT: it never guesses that one fish is another. It only
   * mints a new species from a name the vendor stated explicitly.
   */
  const speciesId = m.speciesId
    ?? (m.scientificNameInTitle ? derivedSpeciesId(m.scientificNameInTitle) : undefined);
  const matchMethod: MarketListing['matchMethod'] = m.speciesId
    ? m.method
    : (m.scientificNameInTitle ? 'derived-binomial' : undefined);

  return product.variants.map((variant): MarketListing => {
    const parsed = sizeFromVariant(variant);
    const price = Number(variant.price);
    const compareAt = variant.compare_at_price === null ? undefined : Number(variant.compare_at_price);

    return {
      storeId: store.id,
      productId: product.id,
      variantId: variant.id,
      handle: product.handle,
      url: productUrl(store.host, product.handle),
      title: product.title,
      vendor: product.vendor || undefined,
      productType: product.product_type || undefined,
      tags: product.tags ?? [],

      speciesId,
      matchMethod,
      scientificNameInTitle: m.scientificNameInTitle,

      price: Number.isFinite(price) ? price : 0,
      compareAtPrice: compareAt !== undefined && Number.isFinite(compareAt) ? compareAt : undefined,
      currency: store.currency,

      size: parsed.size,
      sizeLabel: parsed.label || undefined,

      available: Boolean(variant.available),
      publishedAt: product.published_at ?? undefined,
      updatedAt: variant.updated_at,
      retrievedAt,
    };
  });
}

/**
 * Listings that are not livestock at all - food, gear, gift cards.
 *
 * Kept deliberately narrow: it only drops things that are clearly not an
 * animal. A fish that fails to match the catalog is NOT dropped, because an
 * unmatched fish is a gap worth seeing, not noise.
 */
const NON_LIVESTOCK_TYPES = new Set([
  'gear / merch', 'frozen food', 'food', 'merch', 'gift card', 'dry goods',
  'food and grooming tools', 'equipment', 'supplies',
]);

export function isLivestock(listing: MarketListing): boolean {
  const type = (listing.productType ?? '').toLowerCase().trim();
  if (NON_LIVESTOCK_TYPES.has(type)) return false;
  const title = listing.title.toLowerCase();
  if (/\bgift card\b|\bt-?shirt\b|\bhoodie\b|\bsticker\b|\bfood\b|\bpellets?\b/.test(title)) return false;
  return true;
}

export function normalizeStore(
  store: StoreConfig,
  products: ShopifyProduct[],
  catalog: Species[],
  retrievedAt: string,
): MarketListing[] {
  const match = buildMatcher(catalog);
  return products.flatMap((p) => normalizeProduct(store, p, match, retrievedAt));
}

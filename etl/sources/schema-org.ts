/**
 * Read the structured data retailers publish for machines.
 *
 * WHY THIS IS THE PATTERN, not a PetSmart quirk. Neither big-box vendor is
 * Shopify, so there is no `/products.json` to read and no shared platform to
 * lean on. What they DO have in common is schema.org: every SEO-driven
 * retailer publishes `Product` JSON-LD on its product pages, because Google
 * requires it to show a price in search results. That block is maintained
 * deliberately, for machines, by the vendor - which makes it the same bargain
 * as Shopify's documented endpoint, and far more stable than scraping markup
 * that a redesign will change next quarter.
 *
 * So the extraction contract is schema.org, and a new non-Shopify vendor needs
 * a sitemap filter and a store-number rule, not a new parser.
 */
import type { RetailProduct } from '../types';
import { jsonLdBlocks } from './http';

/** schema.org availability values that mean you can actually buy it. */
const AVAILABLE_RE = /InStock|LimitedAvailability|OnlineOnly|InStoreOnly|PreOrder/i;

function firstOfType(blocks: unknown[], type: string): Record<string, any> | undefined {
  return blocks.find((b) => {
    const t = (b as { '@type'?: unknown })?.['@type'];
    return t === type || (Array.isArray(t) && t.includes(type));
  }) as Record<string, any> | undefined;
}

/** The vendor's own aisle for a product, from its breadcrumb trail. */
export function breadcrumbTrail(blocks: unknown[]): string[] {
  const crumbs = firstOfType(blocks, 'BreadcrumbList');
  return (crumbs?.itemListElement ?? [])
    .map((i: any) => String(i?.name ?? i?.item?.name ?? ''))
    .filter(Boolean);
}

/**
 * The `Product` block from a product page, as a RetailProduct.
 *
 * Returns undefined rather than a half-built record. A listing with no price
 * or no sku is not a listing, and carrying it forward as zeroes would quietly
 * poison every median downstream - the same rule parseSize follows for an
 * unreadable size.
 */
export function parseProductJsonLd(html: string, url: string): RetailProduct | undefined {
  const blocks = jsonLdBlocks(html);
  const product = firstOfType(blocks, 'Product');
  if (!product) return undefined;

  const sku = product.sku ?? product.productID ?? product.mpn;
  // An offers array is how a vendor expresses variants. The lowest-priced
  // in-stock offer is the one a buyer would actually be quoted; where none is
  // in stock, the first is kept so the listing is still recorded.
  const offers: Record<string, any>[] = Array.isArray(product.offers)
    ? product.offers
    : product.offers
      ? [product.offers]
      : [];
  // AggregateOffer states a range rather than a price; lowPrice is the only
  // honest single number to take from it.
  const aggregate = offers.find((o) => o?.['@type'] === 'AggregateOffer');
  const priced = offers
    .filter((o) => o?.['@type'] !== 'AggregateOffer' && Number.isFinite(Number(o?.price)))
    .sort((a, b) => Number(a.price) - Number(b.price));
  const inStock = priced.find((o) => AVAILABLE_RE.test(String(o.availability ?? '')));
  const offer = inStock ?? priced[0] ?? aggregate;

  const price = Number(offer?.price ?? offer?.lowPrice);
  if (!sku || !Number.isFinite(price)) return undefined;

  const trail = breadcrumbTrail(blocks);
  const image = Array.isArray(product.image) ? product.image[0] : product.image;

  return {
    productId: String(sku),
    variantId: String(sku),
    sku: String(sku),
    title: String(product.name ?? ''),
    url: String(offer?.url ?? product.url ?? url),
    // The canonical URL and the URL we fetched can differ. Keeping the one we
    // actually requested is what makes a bad row traceable to the request.
    sourceUrl: url,
    price,
    currency: String(offer?.priceCurrency ?? aggregate?.priceCurrency ?? 'USD'),
    // Nationwide availability. Per-store on-hand counts are a different fact
    // and are kept in their own records.
    available: AVAILABLE_RE.test(String(offer?.availability ?? (aggregate ? 'InStock' : ''))),
    // The breadcrumb's second-to-last entry is the aisle; the last is the
    // product itself.
    productType: trail.length > 1 ? trail[trail.length - 2] : undefined,
    imageUrl: typeof image === 'string' ? image : (image?.url ? String(image.url) : undefined),
    gtin: product.gtin13 ?? product.gtin ?? product.gtin12
      ? String(product.gtin13 ?? product.gtin ?? product.gtin12)
      : undefined,
    tags: trail.slice(1, -1),
  };
}

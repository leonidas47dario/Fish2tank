/**
 * Shopify storefront product reader.
 *
 * All three tracked stores are Shopify and expose the public `/products.json`
 * endpoint. Their robots.txt states plainly: "Public product, collection,
 * page, blog, policy, cart, and localized HTML is crawlable", and none of them
 * disallow /products.json. This reads that documented endpoint rather than
 * parsing storefront HTML, which is both kinder to the stores and far less
 * brittle.
 *
 * POLITENESS IS NOT OPTIONAL. This is someone's small business's
 * infrastructure. The client identifies itself, waits between requests, backs
 * off on 429 and 5xx, and stops at a page cap so a pagination bug cannot turn
 * into a hammering loop.
 */

import { getWithRetry, sleep, USER_AGENT, type PoliteOptions } from './http';

export interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  sku: string | null;
  price: string;
  compare_at_price: string | null;
  available: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
  variants: ShopifyVariant[];
  options?: Array<{ name: string; values: string[] }>;
}

export interface FetchOptions extends PoliteOptions {
  /** Seconds to wait between page requests. */
  delayMs?: number;
  /** Hard cap on pages, so a pagination bug cannot loop forever. */
  maxPages?: number;
  /** Products per page. Shopify caps this at 250. */
  pageSize?: number;
  onPage?: (page: number, count: number) => void;
}

const DEFAULTS = {
  delayMs: 1_000,
  maxPages: 20,
  pageSize: 250,
  backoffMs: 2_000,
  userAgent: USER_AGENT,
};

/**
 * Read every published product from a Shopify storefront.
 *
 * Pagination ends when a page returns fewer products than the page size, which
 * is how Shopify signals the last page.
 */
export async function fetchAllProducts(host: string, options: FetchOptions = {}): Promise<ShopifyProduct[]> {
  const { delayMs, maxPages, pageSize, userAgent, backoffMs } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const all: ShopifyProduct[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `https://${host}/products.json?limit=${pageSize}&page=${page}`;
    const res = await getWithRetry(url, { userAgent, backoffMs, fetchImpl });
    const body = (await res.json()) as { products?: ShopifyProduct[] };
    const products = body.products ?? [];

    all.push(...products);
    options.onPage?.(page, products.length);

    if (products.length < pageSize) break;
    if (page < maxPages) await sleep(delayMs);
  }

  return all;
}

/** Canonical public URL for a product listing. */
export function productUrl(host: string, handle: string): string {
  return `https://${host}/products/${handle}`;
}

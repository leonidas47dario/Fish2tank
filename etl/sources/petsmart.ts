/**
 * PetSmart storefront reader.
 *
 * PetSmart is not Shopify and publishes no product feed, so this reads the two
 * machine-readable surfaces it *does* maintain deliberately:
 *
 *   1. `sitemap_index.xml` -> the product sitemaps, which is PetSmart's own
 *      list of every product URL it wants read. robots.txt names it.
 *   2. schema.org `Product` JSON-LD on each product page - sku, name, price,
 *      availability, image, GTIN. That block exists so machines can read it.
 *   3. The Algolia-backed store inventory index at
 *      `/api/search/1/indexes/p-inventories/query`, which robots.txt
 *      explicitly ALLOWS for every user agent:
 *
 *          Allow: /api/search/1/indexes/p-inventories/query?*
 *
 * WHAT ROBOTS.TXT FORBIDS, AND WHAT THAT COSTS US. `Disallow: /*?` bans every
 * URL carrying a query string other than the three allowed API paths. Category
 * pages return 40 products at a time and paginate on `?start=`, so the cheap
 * bulk route - 5 category requests instead of 178 product requests - is off
 * limits. We walk the sitemap and read one product page each instead. It is
 * more requests, and it is the one they said yes to.
 *
 * WHY THIS VENDOR IS WORTH THE TROUBLE. Every other tracked vendor is a
 * specialist or a mail-order importer. PetSmart is a shop the owner can drive
 * to, and its inventory index reports on-hand counts PER STORE - so for the
 * first time the dataset can answer "is it in the tank down the road today",
 * not just "can it be shipped".
 */
import { getWithRetry, postJsonWithRetry, sleep, jsonLdBlocks, sitemapLocations, USER_AGENT } from './http';
import { parseProductJsonLd } from './schema-org';
import type { LocalStore, RetailProduct, StoreInventory } from '../types';

const HOST = 'www.petsmart.com';
const SITEMAP_INDEX = `https://${HOST}/sitemap_index.xml`;
const INVENTORY_API = `https://${HOST}/api/search/1/indexes/p-inventories/query`;

/**
 * The live-animal aisles, and only those.
 *
 * The `/fish/` department is 1,544 product URLs, of which roughly 1,300 are
 * ornaments, filters, gravel and food that `isLivestock` would drop the moment
 * they were normalized. Fetching them would be 1,300 requests at PetSmart's
 * expense to produce nothing, so the crawl is scoped to the aisles this
 * dataset can actually hold. Widening it is one line.
 */
export const LIVE_PATH_PREFIXES = [
  '/fish/live-fish/',
  '/fish/decor-gravel-and-substrate/live-plants/',
];

/** Store-locator pages carry the store number in the filename. */
const STORE_URL_RE = /\/stores\/us\/([a-z]{2})\/([a-z0-9-]+)-store(\d+)\.html$/;

export interface PetsmartOptions {
  delayMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  backoffMs?: number;
  onProgress?: (done: number, total: number) => void;
}

const DEFAULTS = { delayMs: 1_000, userAgent: USER_AGENT, backoffMs: 2_000 };

// --- Sitemap ---------------------------------------------------------------

/**
 * Every product and store URL PetSmart publishes, from its own sitemap index.
 *
 * Sitemaps are fetched with the same delay as everything else; there are only
 * a handful of them.
 */
export async function fetchSitemapUrls(options: PetsmartOptions = {}): Promise<string[]> {
  const { delayMs, userAgent, backoffMs } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const get = async (url: string) =>
    (await getWithRetry(url, { userAgent, backoffMs, fetchImpl, accept: 'application/xml' })).text();

  const index = await get(SITEMAP_INDEX);
  const urls: string[] = [];
  for (const child of sitemapLocations(index)) {
    await sleep(delayMs);
    urls.push(...sitemapLocations(await get(child)));
  }
  return urls;
}

/** Product URLs in the live-animal aisles. */
export function liveProductUrls(all: string[], prefixes: string[] = LIVE_PATH_PREFIXES): string[] {
  const seen = new Set<string>();
  return all.filter((u) => {
    if (!prefixes.some((p) => u.includes(p)) || !u.endsWith('.html')) return false;
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

/** Store-locator URLs for one city, e.g. `chicago` in `il`. */
export function storeUrlsForCity(all: string[], state: string, citySlug: string): string[] {
  return all.filter((u) => {
    const m = STORE_URL_RE.exec(u);
    return m !== null && m[1] === state && m[2] === citySlug;
  });
}

// --- Product pages ---------------------------------------------------------

/**
 * The `Product` block from a product page.
 *
 * The reading itself is schema.org and shared with the other big-box vendor -
 * see sources/schema-org.ts for why that is the contract rather than markup.
 */
export function parseProduct(html: string, url: string): RetailProduct | undefined {
  return parseProductJsonLd(html, url);
}

/** Walk a list of product URLs, one polite request each. */
export async function fetchProducts(urls: string[], options: PetsmartOptions = {}): Promise<RetailProduct[]> {
  const { delayMs, userAgent, backoffMs } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const out: RetailProduct[] = [];

  for (const [i, url] of urls.entries()) {
    if (i > 0) await sleep(delayMs);
    let html: string;
    try {
      html = await (await getWithRetry(url, { userAgent, backoffMs, fetchImpl, accept: 'text/html' })).text();
    } catch (e) {
      // A product that 404s since the sitemap was written is a gap, not a
      // failure of the run. It is reported and skipped, never invented.
      console.warn(`    skipped ${url}: ${(e as Error).message}`);
      continue;
    }
    const parsed = parseProduct(html, url);
    if (parsed) out.push(parsed);
    options.onProgress?.(i + 1, urls.length);
  }
  return out;
}

// --- Store locator ---------------------------------------------------------

/** The `Store` block from a store-locator page. */
export function parseStore(html: string, url: string): LocalStore | undefined {
  const m = STORE_URL_RE.exec(url);
  const store = jsonLdBlocks(html).find(
    (b) => (b as { '@type'?: string })?.['@type'] === 'Store',
  ) as Record<string, any> | undefined;
  if (!m || !store) return undefined;

  // "chicago-store0428.html" is store 428 in the inventory index: the locator
  // zero-pads, the index does not. Getting this wrong silently returns "not
  // carried" for every product in that store, so it is normalized once, here.
  const storeNumber = String(Number(m[3]));

  return {
    vendorId: 'petsmart',
    storeNumber,
    name: String(store.name ?? ''),
    street: String(store.address?.streetAddress ?? ''),
    city: String(store.address?.addressLocality ?? ''),
    state: String(store.address?.addressRegion ?? ''),
    postalCode: String(store.address?.postalCode ?? ''),
    phone: store.telephone ? String(store.telephone) : undefined,
    url,
    // Every PetSmart carries live fish, so there is no department flag to
    // read; the honest statement is that we did not check, not that we did.
    departments: [],
  };
}

export async function fetchStores(urls: string[], options: PetsmartOptions = {}): Promise<LocalStore[]> {
  const { delayMs, userAgent, backoffMs } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const out: LocalStore[] = [];

  for (const [i, url] of urls.entries()) {
    if (i > 0) await sleep(delayMs);
    const html = await (
      await getWithRetry(url, { userAgent, backoffMs, fetchImpl, accept: 'text/html' })
    ).text();
    const parsed = parseStore(html, url);
    if (parsed) out.push(parsed);
  }
  return out;
}

// --- Store inventory -------------------------------------------------------

/**
 * How many SKUs to ask about in one query.
 *
 * The filter is an `OR` chain, so this trades request count against URL-ish
 * body size. 50 keeps the body small and turns 178 products into 4 requests.
 */
export const INVENTORY_BATCH = 50;

/**
 * Build the Algolia params string for one batch.
 *
 * `attributesToRetrieve` is restricted to the stores we sampled. Without it
 * every hit carries an on-hand count for all ~1,600 PetSmart stores - roughly
 * 30 KB per SKU of data we did not ask for and would not use.
 */
export function inventoryParams(skus: string[], storeNumbers: string[]): string {
  const filters = skus.map((s) => `sku=${s}`).join(' OR ');
  const attrs = ['sku', ...storeNumbers.map((s) => `store_${s}`)];
  return [
    'query=',
    `hitsPerPage=${skus.length}`,
    `filters=${encodeURIComponent(filters)}`,
    `attributesToRetrieve=${encodeURIComponent(JSON.stringify(attrs))}`,
  ].join('&');
}

/**
 * Read the per-store on-hand count for each sku at each sampled store.
 *
 * ABSENT IS NOT ZERO. A hit carries `store_1658: 0` when that store stocks the
 * product and has none today, and omits the key entirely when the store does
 * not carry it at all. Those are different facts about whether it is worth
 * driving there, so the first becomes `onHand: 0` and the second `onHand:
 * null` - never both flattened into a zero.
 */
export async function fetchStoreInventory(
  skus: string[],
  stores: LocalStore[],
  options: PetsmartOptions = {},
): Promise<StoreInventory[]> {
  const { delayMs, userAgent, backoffMs } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const storeNumbers = stores.map((s) => s.storeNumber);
  const retrievedAt = new Date().toISOString();
  const out: StoreInventory[] = [];

  for (let i = 0; i < skus.length; i += INVENTORY_BATCH) {
    if (i > 0) await sleep(delayMs);
    const batch = skus.slice(i, i + INVENTORY_BATCH);
    const res = await postJsonWithRetry(
      INVENTORY_API,
      { params: inventoryParams(batch, storeNumbers) },
      { userAgent, backoffMs, fetchImpl },
    );
    const body = (await res.json()) as { hits?: Array<Record<string, unknown>> };

    for (const hit of body.hits ?? []) {
      const sku = String(hit.sku ?? hit.objectID ?? '');
      if (!sku) continue;
      for (const store of stores) {
        const raw = hit[`store_${store.storeNumber}`];
        out.push({
          vendorId: 'petsmart',
          storeNumber: store.storeNumber,
          sku,
          onHand: typeof raw === 'number' ? raw : null,
          carried: raw !== undefined,
          retrievedAt,
        });
      }
    }
  }
  return out;
}

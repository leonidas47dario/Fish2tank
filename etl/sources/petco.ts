/**
 * Petco reader - two hosts, two very different answers.
 *
 * Petco publishes no product feed and is not Shopify, so this is built from
 * scratch around the two surfaces it does expose. They behave so differently
 * that the reader treats them as separate sources that happen to share a
 * brand.
 *
 * ── stores.petco.com: open, and read every run ─────────────────────────────
 * A Yext-hosted store directory. Serves a robots.txt with NO Disallow rules at
 * all, points at its own sitemaps, and publishes each branch as schema.org
 * `PetStore` JSON-LD - address, geo, phone, hours, and the list of departments
 * that branch operates, including "Aquatics Department". That answers a
 * question the price data never could: which branches near you actually keep
 * fish. It is a location fact, so it lands in `dim_local_store` and never in
 * `fact_listing`.
 *
 * ── www.petco.com: attempted every run, and often refused ──────────────────
 * The storefront sits behind a CDN bot manager that, from a datacentre IP,
 * answers HTTP 403 to EVERY path - including `/robots.txt` itself - with a
 * "Whoops! We can't find what you're looking for" page carrying an error id
 * and the caller's IP. It is not a User-Agent check: a plain browser
 * User-Agent gets the identical 403. That was the answer from the network this
 * was developed on, and it is why the shipped data has no Petco prices.
 *
 * WHY THE READER EXISTS ANYWAY. The block is a property of the network, not of
 * the code. Akamai-class bot managers routinely refuse cloud egress and pass
 * ordinary residential traffic, so the same pipeline run from the owner's own
 * machine may well be allowed straight through. Hard-coding "Petco has no
 * catalogue" would bake an accident of hosting into the design. So the reader
 * is complete, `probeStorefront()` asks the host on every run, and the outcome
 * is recorded as data:
 *
 *   - allowed  -> walk the sitemap, read schema.org Product JSON-LD, populate
 *   - refused  -> record the status and the reason, keep the locations, and
 *                 say so in the run output and in the market index
 *
 * TWO RULES THIS FILE WILL NOT BEND. Permission is checked per host, not per
 * brand - which is why the open directory is read and the refusing storefront
 * is asked rather than assumed either way. And a refusal is never routed
 * around: no disguised User-Agent, no proxy, no scraping a cache. If Petco's
 * edge says no, the answer recorded is no.
 *
 * The closest thing to a Petco price series the project can hold in the
 * meantime is LiveAquaria, Petco's own aquatics brand, already tracked as its
 * own vendor - see its entry in etl/types.ts.
 */
import { getWithRetry, sleep, jsonLdBlocks, sitemapLocations, USER_AGENT } from './http';
import { parseProductJsonLd } from './schema-org';
import type { LocalStore, RetailProduct } from '../types';

const STORE_HOST = 'stores.petco.com';
const STORE_SITEMAP = `https://${STORE_HOST}/sitemap.xml`;
const SHOP_HOST = 'www.petco.com';

/**
 * The live-animal aisles on the storefront.
 *
 * Petco's URL scheme has moved from `/shop/en/petcostore/category/...` to a
 * flat `/category/...`; both are matched so a sitemap written in either shape
 * still resolves. Same reasoning as PetSmart: fetching the gravel and filters
 * would be thousands of requests at the vendor's expense to produce rows that
 * `isLivestock` drops on arrival.
 */
export const LIVE_PATH_PREFIXES = [
  '/category/fish/live-fish/',
  '/category/fish/live-aquarium-plants/',
  '/shop/en/petcostore/category/fish/live-fish/',
  '/shop/en/petcostore/category/fish/live-aquarium-plants/',
];

/**
 * A branch page, as opposed to a service landing page.
 *
 * The directory also publishes `/grooming/il/chicago/...`, `/aquatics/...`
 * and city roll-ups. Only `/{state}/{city}/pet-supplies-{city}-{state}-{n}.html`
 * is a store, and the trailing number is Petco's store number.
 */
const STORE_URL_RE =
  /^https:\/\/stores\.petco\.com\/([a-z]{2})\/([a-z0-9-]+)\/pet-supplies-[a-z0-9-]+-[a-z]{2}-(\d+)\.html$/;

export interface PetcoOptions {
  delayMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  backoffMs?: number;
  onProgress?: (done: number, total: number) => void;
}

const DEFAULTS = { delayMs: 1_000, userAgent: USER_AGENT, backoffMs: 2_000 };

// --- Storefront access -----------------------------------------------------

/** What the storefront said when we asked, this run. */
export interface StorefrontAccess {
  readable: boolean;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
  /** Plain-English reason, written into the market index when refused. */
  reason: string;
  checkedAt: string;
}

/**
 * Ask www.petco.com whether it will talk to us, before spending any requests.
 *
 * robots.txt is the right thing to ask for first regardless: if it comes back,
 * its rules are honoured; if it 403s, the host has refused to publish rules at
 * all and there is nothing to read under. Either way this is ONE request, and
 * its answer decides whether the crawl happens.
 */
export async function probeStorefront(options: PetcoOptions = {}): Promise<StorefrontAccess> {
  // Deliberately a bare fetch, not getWithRetry: this is asking whether we are
  // welcome, and a host that says 403 should be asked once, not four times.
  const { userAgent } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const checkedAt = new Date().toISOString();
  const url = `https://${SHOP_HOST}/robots.txt`;

  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'text/plain' } });
    if (!res.ok) {
      return {
        readable: false,
        status: res.status,
        reason:
          `${SHOP_HOST} answered HTTP ${res.status} for /robots.txt. The CDN edge refuses ` +
          'automated clients from this network, so no crawl permission is published and none ' +
          'is assumed. Locations only this run.',
        checkedAt,
      };
    }
    const body = await res.text();
    // A robots.txt that bans everyone is a refusal too, and an explicit one.
    const bansEveryone = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/im.test(body);
    if (bansEveryone) {
      return {
        readable: false,
        status: res.status,
        reason: `${SHOP_HOST}/robots.txt disallows all crawling for every user agent.`,
        checkedAt,
      };
    }
    return { readable: true, status: res.status, reason: 'robots.txt retrieved and permits reading.', checkedAt };
  } catch (e) {
    return {
      readable: false,
      status: 0,
      reason: `${SHOP_HOST} unreachable: ${(e as Error).message}. Locations only this run.`,
      checkedAt,
    };
  }
}

// --- Storefront listings ---------------------------------------------------

/**
 * Product URLs in the live-animal aisles, from Petco's own sitemap.
 *
 * Only ever called after probeStorefront() said yes.
 */
export async function fetchProductUrls(options: PetcoOptions = {}): Promise<string[]> {
  const { delayMs, userAgent, backoffMs } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const get = async (url: string) =>
    (await getWithRetry(url, { userAgent, backoffMs, fetchImpl, accept: 'application/xml' })).text();

  const root = await get(`https://${SHOP_HOST}/sitemap.xml`);
  const children = sitemapLocations(root);
  // A sitemap index lists sitemaps; a plain sitemap lists pages. Telling them
  // apart by what the entries look like avoids depending on the root being one
  // or the other, which Petco has changed before.
  const looksLikeIndex = children.some((u) => /sitemap.*\.xml(\.gz)?$/i.test(u));

  const all: string[] = looksLikeIndex ? [] : children;
  if (looksLikeIndex) {
    for (const child of children) {
      await sleep(delayMs);
      all.push(...sitemapLocations(await get(child)));
    }
  }
  return liveProductUrls(all);
}

/** Filter any URL list down to the live-animal aisles, de-duplicated. */
export function liveProductUrls(all: string[], prefixes: string[] = LIVE_PATH_PREFIXES): string[] {
  const seen = new Set<string>();
  return all.filter((u) => {
    if (!prefixes.some((p) => u.includes(p))) return false;
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

/**
 * The `Product` block from a storefront product page.
 *
 * schema.org, shared with PetSmart - see sources/schema-org.ts. Petco's
 * markup has never been read from the development network, so this leans
 * entirely on the standard rather than on anything Petco-specific, and a page
 * that yields no Product block is skipped and counted rather than guessed at.
 */
export function parseProduct(html: string, url: string): RetailProduct | undefined {
  return parseProductJsonLd(html, url);
}

/** Walk a list of product URLs, one polite request each. */
export async function fetchProducts(urls: string[], options: PetcoOptions = {}): Promise<RetailProduct[]> {
  const { delayMs, userAgent, backoffMs } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const out: RetailProduct[] = [];

  for (const [i, url] of urls.entries()) {
    if (i > 0) await sleep(delayMs);
    let html: string;
    try {
      html = await (await getWithRetry(url, { userAgent, backoffMs, fetchImpl, accept: 'text/html' })).text();
    } catch (e) {
      console.warn(`    skipped ${url}: ${(e as Error).message}`);
      continue;
    }
    const parsed = parseProduct(html, url);
    if (parsed) out.push(parsed);
    options.onProgress?.(i + 1, urls.length);
  }
  return out;
}

/** Every URL in the store directory's own sitemaps. */
export async function fetchStoreDirectoryUrls(options: PetcoOptions = {}): Promise<string[]> {
  const { delayMs, userAgent, backoffMs } = { ...DEFAULTS, ...options };
  const fetchImpl = options.fetchImpl ?? fetch;
  const get = async (url: string) =>
    (await getWithRetry(url, { userAgent, backoffMs, fetchImpl, accept: 'application/xml' })).text();

  const index = await get(STORE_SITEMAP);
  const urls: string[] = [];
  for (const child of sitemapLocations(index)) {
    await sleep(delayMs);
    urls.push(...sitemapLocations(await get(child)));
  }
  return urls;
}

/** Branch pages for one city, e.g. `chicago` in `il`. */
export function storeUrlsForCity(all: string[], state: string, citySlug: string): string[] {
  return all.filter((u) => {
    const m = STORE_URL_RE.exec(u);
    return m !== null && m[1] === state && m[2] === citySlug;
  });
}

/**
 * The `PetStore` block from a branch page.
 *
 * `department[]` is the branch's own list of what it operates. It is copied
 * through verbatim rather than reduced to a hasAquatics boolean, because a
 * branch that lists no departments has told us nothing, and an empty array
 * must not read as "no fish here".
 */
export function parseStore(html: string, url: string): LocalStore | undefined {
  const m = STORE_URL_RE.exec(url);
  const store = jsonLdBlocks(html).find(
    (b) => (b as { '@type'?: string })?.['@type'] === 'PetStore',
  ) as Record<string, any> | undefined;
  if (!m || !store) return undefined;

  const departments: string[] = (Array.isArray(store.department) ? store.department : [])
    .map((d: any) => String(d?.name ?? ''))
    .filter(Boolean);

  return {
    vendorId: 'petco',
    storeNumber: m[3]!,
    name: String(store.name ?? ''),
    street: String(store.address?.streetAddress ?? ''),
    city: String(store.address?.addressLocality ?? ''),
    state: String(store.address?.addressRegion ?? ''),
    postalCode: String(store.address?.postalCode ?? ''),
    phone: store.telephone ? String(store.telephone) : undefined,
    latitude: typeof store.geo?.latitude === 'number' ? store.geo.latitude : undefined,
    longitude: typeof store.geo?.longitude === 'number' ? store.geo.longitude : undefined,
    url,
    departments,
  };
}

/** True when the branch itself says it runs an aquatics department. */
export function hasAquatics(store: LocalStore): boolean {
  return store.departments.some((d) => /aquatic/i.test(d));
}

export async function fetchStores(urls: string[], options: PetcoOptions = {}): Promise<LocalStore[]> {
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

/**
 * Petco reader - store locations and aquatics departments.
 *
 * READ THIS BEFORE LOOKING FOR THE PRICES. There are none, and that is not an
 * oversight.
 *
 * `www.petco.com` is unreadable from any automated client. Every path on that
 * host - including `/robots.txt` itself - answers HTTP 403 from the CDN edge
 * with a "Whoops! We can't find what you're looking for" page carrying an
 * error id and the caller's IP. It is not a User-Agent check: a plain browser
 * User-Agent gets the identical 403. Because robots.txt cannot be retrieved at
 * all, there is no published crawl permission to rely on either, and the
 * project's rule is that permission is checked per host rather than assumed.
 *
 * So Petco's catalogue and prices are NOT captured, and nothing in this file
 * invents a stand-in for them. What IS captured is real and separately
 * published: `stores.petco.com` is a Yext-hosted store directory, serves a
 * robots.txt with no Disallow rules at all, points at its own sitemaps, and
 * publishes each branch as schema.org `PetStore` JSON-LD - address, geo,
 * phone, hours, and the list of departments that branch operates, including
 * "Aquatics Department".
 *
 * That answers a question the price data never could: which Petco branches
 * near you actually keep fish. It is a location fact, not a market fact, so it
 * lands in `dim_local_store` and never in `fact_listing` or the market index.
 *
 * The closest thing to a Petco price series the project can honestly hold is
 * LiveAquaria, Petco's own aquatics brand, which is already tracked as its own
 * vendor and says so in its entry in etl/types.ts.
 */
import { getWithRetry, sleep, jsonLdBlocks, sitemapLocations, USER_AGENT } from './http';
import type { LocalStore } from '../types';

const STORE_HOST = 'stores.petco.com';
const STORE_SITEMAP = `https://${STORE_HOST}/sitemap.xml`;

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
}

const DEFAULTS = { delayMs: 1_000, userAgent: USER_AGENT, backoffMs: 2_000 };

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

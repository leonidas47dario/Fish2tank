/**
 * Vendor product descriptions, as a care-data source of last resort.
 *
 * WHY A STORE COUNTS AS A SOURCE HERE. Wikipedia states a tank volume for
 * roughly 3% of these species; a store states one whenever it wants the fish
 * to survive the customer. A trade claim is weaker evidence than a taxonomic
 * one - it is written to sell - so anything sourced this way is labelled as
 * vendor evidence, exactly as `species-overrides.ts` labels `viaVendor` names.
 * Weaker and labelled beats absent and silent.
 *
 * WHY `.json` AND NOT THE PRODUCT PAGE. Every tracked store is Shopify, and
 * appending `.json` to a product URL returns the same public product record
 * `/products.json` already serves - one small document instead of a rendered
 * page, and no HTML parsing to rot.
 *
 * BLOCKED HOSTS ARE RECORDED, NOT RETRIED. Two of the eight stores sit behind
 * DRW's Menlo Security isolation proxy, which answers 503 or an HTML
 * interstitial. Retrying that is a loop against a wall, so those hosts are
 * skipped by name and the reason is carried into the run summary. This is the
 * same limit spec 002 hit and it is a property of this network, not the store.
 */

const USER_AGENT =
  'Fish2TankResearch/0.1 (personal aquarium field guide; +https://github.com/leonidas47dario/Fish2tank)';

/**
 * Hosts that the corporate proxy blocks. Verified 2026-08-29: both return a
 * 503 or a Menlo interstitial to curl, headless Chromium and WebFetch alike.
 */
export const BLOCKED_HOSTS = new Set(['aquaticarts.com', 'www.predatoryfins.com', 'predatoryfins.com']);

export interface VendorBody {
  productUrl: string;
  storeId: string;
  /** Absent when the fetch was skipped or the store returned nothing usable. */
  text?: string;
  title?: string;
  /** Why there is no text. Always set when `text` is absent. */
  skipReason?: string;
}

export interface VendorFetchOptions {
  backoffMs?: number;
  maxAttempts?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The public product record behind a Shopify product page. */
export function productJsonUrl(productUrl: string): string {
  const clean = (productUrl.split('?')[0] ?? productUrl).replace(/\/+$/, '');
  return `${clean}.json`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Reduce a product description to prose.
 *
 * Stores write care data in `<li>` rows and `<br>`-separated lines as often as
 * in sentences, so block-level tags become newlines rather than vanishing -
 * "Minimum Tank Size: 55 gallons" must not end up glued to the line above it,
 * or the quote a reader takes from it will not match this text later.
 */
export function bodyText(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6]|ul|ol|table)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * One product. Never throws for an unreachable store: an unreachable store is
 * an outcome to record, not a reason to abandon the other 298 species.
 */
export async function fetchProductBody(
  productUrl: string,
  storeId: string,
  opts: VendorFetchOptions = {},
): Promise<VendorBody> {
  const host = hostOf(productUrl);
  if (BLOCKED_HOSTS.has(host)) {
    return { productUrl, storeId, skipReason: `host ${host} is blocked by the corporate proxy` };
  }

  const { backoffMs = 1500, maxAttempts = 3, userAgent = USER_AGENT, fetchImpl = fetch } = opts;
  const url = productJsonUrl(productUrl);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': userAgent } });
    } catch (err) {
      // A network error is a fact about this run, not something to swallow.
      if (attempt === maxAttempts) {
        return { productUrl, storeId, skipReason: `fetch failed: ${(err as Error).message}` };
      }
      await sleep(backoffMs * attempt);
      continue;
    }

    if (res.status === 404) return { productUrl, storeId, skipReason: 'product 404 (delisted)' };
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) {
        return { productUrl, storeId, skipReason: `HTTP ${res.status} after ${maxAttempts} attempts` };
      }
      await sleep(backoffMs * attempt);
      continue;
    }
    if (!res.ok) return { productUrl, storeId, skipReason: `HTTP ${res.status}` };

    const raw = await res.text();
    let product: { title?: string; body_html?: string } | undefined;
    try {
      product = (JSON.parse(raw) as { product?: { title?: string; body_html?: string } }).product;
    } catch {
      // The proxy answers HTML where JSON was asked for. Say that plainly
      // rather than reporting an empty description.
      return { productUrl, storeId, skipReason: 'response was not JSON (proxy interstitial?)' };
    }

    const text = bodyText(product?.body_html);
    if (!text) return { productUrl, storeId, skipReason: 'product has an empty description' };
    return { productUrl, storeId, text, ...(product?.title ? { title: product.title } : {}) };
  }

  return { productUrl, storeId, skipReason: 'exhausted retries' };
}

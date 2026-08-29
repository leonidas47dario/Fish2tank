/**
 * The polite HTTP client every source shares.
 *
 * POLITENESS IS NOT OPTIONAL. Some of these hosts are small businesses and the
 * rest are big-box retailers whose edge will (rightly) throttle anything that
 * behaves like a crawler. One implementation, so a new source cannot
 * accidentally ship without the manners: a contactable User-Agent, a wait
 * between requests, Retry-After honoured, exponential backoff on 429/5xx, and
 * a bounded number of attempts.
 *
 * Extracted from sources/shopify.ts, which was the only source when it was
 * written and now imports this instead of keeping its own copy.
 */

export const USER_AGENT =
  'Fish2TankResearch/0.1 (personal aquarium price research; +https://github.com/leonidas47dario/Fish2tank)';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PoliteOptions {
  userAgent?: string;
  /** Base for exponential backoff on a retryable failure. */
  backoffMs?: number;
  /** Attempts after the first before giving up. */
  maxRetries?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  accept?: string;
}

/**
 * GET with retries on the failures that are worth retrying, and only those.
 *
 * A 404 or a 403 is an answer, not a hiccup: retrying it just means asking a
 * host that already said no three more times. Only 429 and 5xx come back.
 */
export async function getWithRetry(url: string, options: PoliteOptions = {}): Promise<Response> {
  const {
    userAgent = USER_AGENT,
    backoffMs = 2_000,
    maxRetries = 3,
    accept = 'application/json',
  } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: accept } });
    if (res.ok) return res;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      throw new Error(`GET ${url} failed: HTTP ${res.status}`);
    }
    // Honour Retry-After whenever the host sends one - including 0, which
    // means "retry now" and must not be mistaken for "header absent".
    const header = res.headers.get('retry-after');
    const retryAfter = header === null ? NaN : Number(header);
    await sleep(
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt,
    );
  }
}

/** POST a JSON body, with the same manners. */
export async function postJsonWithRetry(
  url: string,
  body: unknown,
  options: PoliteOptions = {},
): Promise<Response> {
  const { userAgent = USER_AGENT, backoffMs = 2_000, maxRetries = 3 } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      throw new Error(`POST ${url} failed: HTTP ${res.status}`);
    }
    const header = res.headers.get('retry-after');
    const retryAfter = header === null ? NaN : Number(header);
    await sleep(
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt,
    );
  }
}

/**
 * Every `<script type="application/ld+json">` payload on a page, parsed, with
 * `@graph` flattened.
 *
 * Both big-box retailers publish the facts we want as schema.org JSON-LD -
 * which is the part of the page they maintain deliberately for machines to
 * read. Parsing that is far more stable than scraping their markup, and it is
 * the same bargain as reading Shopify's products.json.
 */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]!.trim());
    } catch {
      // A malformed block is skipped, never guessed at.
      continue;
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      const graph = (node as { '@graph'?: unknown })?.['@graph'];
      if (Array.isArray(graph)) out.push(...graph);
      else out.push(node);
    }
  }
  return out;
}

/** Every `<loc>` in a sitemap or sitemap index. */
export function sitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
}

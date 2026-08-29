import { describe, expect, it, vi } from 'vitest';
import { fetchAllProducts, productUrl } from './shopify';

function product(id: number) {
  return {
    id, title: `Fish ${id}`, handle: `fish-${id}`, body_html: '', vendor: 'v',
    product_type: 'Live Fish', tags: [], published_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    variants: [],
  };
}

function jsonResponse(products: unknown[], init: ResponseInit = {}) {
  return new Response(JSON.stringify({ products }), { status: 200, ...init });
}

const opts = { delayMs: 0, pageSize: 3, backoffMs: 0 };

describe('pagination', () => {
  it('stops when a page returns fewer products than the page size', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([product(1), product(2), product(3)]))
      .mockResolvedValueOnce(jsonResponse([product(4)]));
    const all = await fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never });
    expect(all).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on an empty store', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
    expect(await fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never exceeds the page cap, even if the store keeps returning full pages', async () => {
    // Guards against a pagination bug turning into an unbounded hammering loop.
    // A factory, not a shared Response: a body can only be read once.
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse([product(1), product(2), product(3)])));
    await fetchAllProducts('example.com', { ...opts, maxPages: 4, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('requests the documented endpoint with limit and page', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
    await fetchAllProducts('shop.example', { ...opts, fetchImpl: fetchImpl as never });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://shop.example/products.json?limit=3&page=1');
  });
});

describe('politeness', () => {
  it('identifies itself with a contactable User-Agent', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
    await fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never });
    const headers = fetchImpl.mock.calls[0]![1].headers;
    expect(headers['User-Agent']).toMatch(/Fish2TankResearch/);
    expect(headers['User-Agent']).toMatch(/github\.com/);
  });

  it('retries a 429 and then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse([product(1)]));
    const all = await fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never });
    expect(all).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 and then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('down', { status: 503, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse([product(1)]));
    expect(await fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never })).toHaveLength(1);
  });

  it('honours retry-after: 0 as retry now, not as a missing header', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse([product(1)]));
    const started = Date.now();
    await fetchAllProducts('example.com', { ...opts, backoffMs: 60_000, fetchImpl: fetchImpl as never });
    // Would take a minute if 0 fell through to the backoff.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('gives up rather than retrying forever', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response('down', { status: 500 })));
    await expect(fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/HTTP 500/);
    // Initial attempt plus three retries.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not retry a 404, which will never succeed', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response('nope', { status: 404 })));
    await expect(fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/HTTP 404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('telling a vendor outage apart from our own network', () => {
  /**
   * A corporate filter answers for the origin, so a blocked host is
   * indistinguishable from a down one: a plain 5xx, retried to exhaustion,
   * that never recovers. On 2026-08-29 predatoryfins.com was retried for an
   * hour on the assumption it was down. It was up; the network was blocking
   * it, and the proof was sitting in the response body the whole time.
   */
  const interstitial = `<!DOCTYPE html>
<html lang="en"><head><script>
  var paloCategory = "society"
  var url = "www.predatoryfins.com/"
  window.location = "https://safe.menlosecurity.com/" + url;
</script></head><body>Blocked</body></html>`;

  it('says so when the 5xx body is a network filter, not the store', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(interstitial, { status: 503, headers: { 'content-type': 'text/html' } }),
    );
    await expect(fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/network filter.*retrying will not help/s);
  });

  it('leaves a genuine store error alone', async () => {
    // A real 503 from the origin carries no interstitial, and the message must
    // stay exactly as terse as it was.
    const fetchImpl = vi.fn().mockResolvedValue(new Response('service unavailable', { status: 503 }));
    await expect(fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/^GET .* failed: HTTP 503$/);
  });

  it('does not mistake an HTML error page for a filter', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<!DOCTYPE html><html><body>500 Internal Server Error</body></html>', { status: 500 }),
    );
    await expect(fetchAllProducts('example.com', { ...opts, fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/^GET .* failed: HTTP 500$/);
  });
});

describe('productUrl', () => {
  it('builds the canonical listing URL', () => {
    expect(productUrl('www.predatoryfins.com', 'black-kumpay-goby'))
      .toBe('https://www.predatoryfins.com/products/black-kumpay-goby');
  });
});

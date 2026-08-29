import { describe, expect, it, vi } from 'vitest';
import { bodyText, fetchProductBody, hostOf, productJsonUrl } from './vendor-text';

describe('productJsonUrl', () => {
  it('appends .json to a product page', () => {
    expect(productJsonUrl('https://imperialtropicals.com/products/armored-bichir-polypterus-delhezi'))
      .toBe('https://imperialtropicals.com/products/armored-bichir-polypterus-delhezi.json');
  });

  it('drops a query string and a trailing slash first', () => {
    expect(productJsonUrl('https://x.com/products/fish/?variant=1')).toBe('https://x.com/products/fish.json');
  });
});

describe('hostOf', () => {
  it('returns an empty host for a malformed URL rather than throwing', () => {
    expect(hostOf('not a url')).toBe('');
  });
});

describe('bodyText', () => {
  it('turns list rows into lines, so a care row is quotable on its own', () => {
    const html = '<ul><li>Minimum Tank Size: 55 gallons</li><li>Temperament: Peaceful</li></ul>';
    expect(bodyText(html)).toBe('Minimum Tank Size: 55 gallons\nTemperament: Peaceful');
  });

  it('breaks on <br>, which is how half these stores format care data', () => {
    expect(bodyText('Temp: 72-78F<br>pH: 6.5')).toBe('Temp: 72-78F\npH: 6.5');
  });

  it('decodes entities and collapses runs of spaces', () => {
    expect(bodyText('<p>Keep&nbsp;in   groups &amp; provide cover.</p>'))
      .toBe('Keep in groups & provide cover.');
  });

  it('returns empty string for a missing description', () => {
    expect(bodyText(undefined)).toBe('');
  });
});

describe('fetchProductBody', () => {
  const json = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as unknown as Response;

  it('reads the description out of the Shopify product record', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ product: { title: 'Armored Bichir', body_html: '<p>Minimum tank: 75 gallons</p>' } }),
    );
    const out = await fetchProductBody('https://imperialtropicals.com/products/x', 'imperial-tropicals', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.text).toBe('Minimum tank: 75 gallons');
    expect(out.title).toBe('Armored Bichir');
    expect(out.skipReason).toBeUndefined();
  });

  it('skips a proxy-blocked host without spending a request', async () => {
    const fetchImpl = vi.fn();
    const out = await fetchProductBody('https://aquaticarts.com/products/x', 'aquatic-arts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.text).toBeUndefined();
    expect(out.skipReason).toMatch(/blocked by the corporate proxy/);
  });

  it('names the proxy interstitial rather than reporting an empty description', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => '<!DOCTYPE html><html>blocked</html>' }) as unknown as Response,
    );
    const out = await fetchProductBody('https://globalexoticquatics.com/products/x', 'global-exoticquatics', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.skipReason).toMatch(/not JSON/);
  });

  it('records a delisted product as a 404, not as a failure to retry', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    const out = await fetchProductBody('https://imperialtropicals.com/products/gone', 'imperial-tropicals', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.skipReason).toBe('product 404 (delisted)');
  });

  it('retries a 503 and succeeds on the second attempt', async () => {
    // A realistic failure response: the shared client reads Retry-After and
    // clones the body looking for a network-filter interstitial, so a bare
    // `{ ok, status }` stub is not enough to exercise the retry path.
    const failure = {
      ok: false,
      status: 503,
      headers: new Headers(),
      clone: () => ({ text: async () => 'upstream unavailable' }),
    } as unknown as Response;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(json({ product: { body_html: '<p>Peaceful.</p>' } }));
    const out = await fetchProductBody('https://imperialtropicals.com/products/x', 'imperial-tropicals', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 1,
    });
    expect(out.text).toBe('Peaceful.');
  });

  it('carries the shared client\'s network-filter hint into the skip reason', async () => {
    // The distinction this whole refactor exists for: a store that is down
    // and a store our own proxy is blocking look identical without it, and
    // 243 of the 272 listings in this campaign are the second case.
    const blocked = {
      ok: false,
      status: 503,
      headers: new Headers(),
      clone: () => ({
        text: async () => '<!DOCTYPE html><html><script>var paloCategory = "society"</script></html>',
      }),
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => blocked);
    const out = await fetchProductBody('https://globalexoticquatics.com/products/x', 'global-exoticquatics', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 1,
      maxAttempts: 1,
    });
    expect(out.text).toBeUndefined();
    expect(out.skipReason).toMatch(/network filter/);
  });

  it('reports a thrown network error instead of swallowing it', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const out = await fetchProductBody('https://imperialtropicals.com/products/x', 'imperial-tropicals', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 1,
      maxAttempts: 2,
    });
    expect(out.skipReason).toMatch(/ECONNRESET/);
  });
});

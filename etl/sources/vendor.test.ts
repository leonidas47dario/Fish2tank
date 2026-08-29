import { describe, expect, it } from 'vitest';
import { fetchVendorPortrait, isReachableVendor, storeNameFor } from './vendor';

const productJson = {
  product: {
    title: 'Albino Millennium Rainbowfish',
    images: [
      { src: 'https://cdn.shopify.com/s/files/1/x/Albino_Millennium_Male.jpg?v=1', width: 2048, height: 1365 },
      { src: 'https://cdn.shopify.com/s/files/1/x/Albino_Millennium_Female.jpg', width: 2048, height: 1366 },
    ],
  },
};

const stub = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;

describe('isReachableVendor', () => {
  it('accepts hosts that respond from this network', () => {
    expect(isReachableVendor('https://imperialtropicals.com/products/x')).toBe(true);
  });

  it('rejects predatoryfins, which the corporate proxy 503s', () => {
    // 79 of the 88 product URLs on uncovered species point here. Attempting
    // them wastes a minute per run and logs 79 identical failures.
    expect(isReachableVendor('https://www.predatoryfins.com/products/x')).toBe(false);
  });

  it('rejects a malformed url rather than throwing', () => {
    expect(isReachableVendor('not a url')).toBe(false);
  });
});

describe('storeNameFor', () => {
  it('gives a human-readable credit name', () => {
    expect(storeNameFor('https://imperialtropicals.com/products/x')).toBe('Imperial Tropicals');
  });

  it('falls back to the hostname for an unmapped store', () => {
    expect(storeNameFor('https://example-fish.com/products/x')).toBe('example-fish.com');
  });
});

describe('fetchVendorPortrait', () => {
  it('takes the first product image, credited to the store', async () => {
    const got = await fetchVendorPortrait(
      'sp_glossolepis_pseudoincisus',
      'https://imperialtropicals.com/products/albino-millenium-rainbowfish',
      { fetchImpl: stub(productJson) },
    );
    expect(got?.url).toBe('https://cdn.shopify.com/s/files/1/x/Albino_Millennium_Male.jpg?v=1');
    expect(got?.provenance).toBe('vendor');
    expect(got?.license).toBeUndefined();
    expect(got?.artist).toBe('Imperial Tropicals');
    expect(got?.attributionUrl)
      .toBe('https://imperialtropicals.com/products/albino-millenium-rainbowfish');
    expect(got?.width).toBe(2048);
  });

  it('returns undefined for a product with no images', async () => {
    const got = await fetchVendorPortrait('sp_x', 'https://imperialtropicals.com/products/y',
      { fetchImpl: stub({ product: { title: 'y', images: [] } }) });
    expect(got).toBeUndefined();
  });

  it('returns undefined for a delisted product', async () => {
    const got = await fetchVendorPortrait('sp_x', 'https://imperialtropicals.com/products/gone',
      { fetchImpl: stub({}, 404) });
    expect(got).toBeUndefined();
  });

  it('does not attempt an unreachable host', async () => {
    let called = false;
    const spy = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    const got = await fetchVendorPortrait('sp_x', 'https://www.predatoryfins.com/products/z',
      { fetchImpl: spy });
    expect(got).toBeUndefined();
    expect(called).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  hasAquatics, liveProductUrls, parseProduct, parseStore, probeStorefront, storeUrlsForCity,
} from './petco';

const STORE_HTML = `
<html><head><script type="application/ld+json">
{"@graph":[
 {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]},
 {"@context":"https://schema.org","@type":"PetStore","name":"Petco Pet Store in Chicago Halsted",
  "address":{"@type":"PostalAddress","streetAddress":"3046 N Halsted","addressLocality":"Chicago",
   "addressRegion":"IL","postalCode":"60657","addressCountry":"US"},
  "telephone":"+17739357547",
  "geo":{"@type":"GeoCoordinates","latitude":41.93761112665786,"longitude":-87.6500203338705},
  "department":[{"@type":"LocalBusiness","name":"Dog Grooming"},
                {"@type":"LocalBusiness","name":"Aquatics Department"}]}
]}
</script></head></html>`;

const URL = 'https://stores.petco.com/il/chicago/pet-supplies-chicago-il-696.html';

describe('parseStore', () => {
  it('reads the branch out of the @graph-wrapped PetStore block', () => {
    expect(parseStore(STORE_HTML, URL)).toMatchObject({
      vendorId: 'petco',
      storeNumber: '696',
      name: 'Petco Pet Store in Chicago Halsted',
      street: '3046 N Halsted',
      city: 'Chicago',
      state: 'IL',
      postalCode: '60657',
      latitude: 41.93761112665786,
    });
  });

  it('keeps the departments verbatim rather than reducing them to a flag', () => {
    expect(parseStore(STORE_HTML, URL)!.departments).toEqual(['Dog Grooming', 'Aquatics Department']);
  });

  it('reports no departments as empty, which is not the same as no fish', () => {
    // A branch that publishes no department list has told us nothing. An empty
    // array must never be read as "this branch has no aquatics".
    const bare = STORE_HTML.replace(/"department":\[[^\]]*\}\]/, '"department":[]');
    const store = parseStore(bare, URL)!;
    expect(store.departments).toEqual([]);
    expect(hasAquatics(store)).toBe(false);
  });

  it('returns nothing for a page with no PetStore block', () => {
    expect(parseStore('<html></html>', URL)).toBeUndefined();
  });
});

describe('storeUrlsForCity', () => {
  const urls = [
    'https://stores.petco.com/il/chicago/pet-supplies-chicago-il-696.html',
    'https://stores.petco.com/il/chicago/full-service-grooming-chicago-il-696.html',
    'https://stores.petco.com/aquatics/il/chicago',
    'https://stores.petco.com/il/chicago',
    'https://stores.petco.com/il/chicago-heights/pet-supplies-chicago-heights-il-2500.html',
    'https://stores.petco.com/ca/chico/pet-supplies-chico-ca-800.html',
  ];

  it('keeps branch pages only, for the city asked for', () => {
    expect(storeUrlsForCity(urls, 'il', 'chicago')).toEqual([
      'https://stores.petco.com/il/chicago/pet-supplies-chicago-il-696.html',
    ]);
  });
});

describe('hasAquatics', () => {
  it('is true only when the branch itself names an aquatics department', () => {
    expect(hasAquatics(parseStore(STORE_HTML, URL)!)).toBe(true);
  });
});

describe('probeStorefront', () => {
  // The storefront is asked on every run rather than assumed either way. The
  // block observed during development is a property of the network, not of the
  // code - the same pipeline from an ordinary connection may be let straight
  // through - so the answer is data, not a constant.

  it('records a 403 as refused, with a reason worth reading', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('blocked', { status: 403 }));
    const access = await probeStorefront({ fetchImpl: fetchImpl as never });

    expect(access.readable).toBe(false);
    expect(access.status).toBe(403);
    expect(access.reason).toContain('403');
    expect(access.checkedAt).toMatch(/^\d{4}-/);
  });

  it('asks exactly once — a host that says no is not asked four times', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('blocked', { status: 403 }));
    await probeStorefront({ fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats an unreachable host as refused rather than throwing', async () => {
    // A refusal must never take the store directory down with it.
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const access = await probeStorefront({ fetchImpl: fetchImpl as never });
    expect(access).toMatchObject({ readable: false, status: 0 });
    expect(access.reason).toContain('ECONNRESET');
  });

  it('allows the crawl when robots.txt comes back and permits it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('User-agent: *\nDisallow: /checkout\nSitemap: https://www.petco.com/sitemap.xml', { status: 200 }),
    );
    expect((await probeStorefront({ fetchImpl: fetchImpl as never })).readable).toBe(true);
  });

  it('honours a robots.txt that bans everyone', async () => {
    // Readable is not the same as permitted. A blanket disallow is a refusal
    // that arrived with an HTTP 200.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('User-agent: *\nDisallow: /', { status: 200 }),
    );
    const access = await probeStorefront({ fetchImpl: fetchImpl as never });
    expect(access.readable).toBe(false);
    expect(access.reason).toContain('disallows all crawling');
  });
});

describe('liveProductUrls', () => {
  const urls = [
    'https://www.petco.com/category/fish/live-fish/betta-fish/some-betta.html',
    'https://www.petco.com/shop/en/petcostore/category/fish/live-fish/goldfish/comet.html',
    'https://www.petco.com/category/fish/live-aquarium-plants/anubias.html',
    'https://www.petco.com/category/fish/aquarium-filters/filter.html',
    'https://www.petco.com/category/dog/dog-food/kibble.html',
    'https://www.petco.com/category/fish/live-fish/betta-fish/some-betta.html',
  ];

  it('keeps the live-animal aisles under either URL scheme, and de-duplicates', () => {
    // Petco has moved from /shop/en/petcostore/category/... to a flat
    // /category/...; a sitemap written in either shape must still resolve.
    expect(liveProductUrls(urls)).toEqual([
      'https://www.petco.com/category/fish/live-fish/betta-fish/some-betta.html',
      'https://www.petco.com/shop/en/petcostore/category/fish/live-fish/goldfish/comet.html',
      'https://www.petco.com/category/fish/live-aquarium-plants/anubias.html',
    ]);
  });
});

describe('parseProduct', () => {
  it('reads a storefront product through the shared schema.org contract', () => {
    // Petco's own markup has never been readable from the development network,
    // so this leans on the standard rather than on anything Petco-specific.
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","sku":"3184901","name":"Betta Fish",
       "offers":{"@type":"Offer","priceCurrency":"USD","price":"5.99",
       "availability":"https://schema.org/InStock"}}</script>`;
    const p = parseProduct(html, 'https://www.petco.com/category/fish/live-fish/betta.html')!;
    expect(p).toMatchObject({ sku: '3184901', title: 'Betta Fish', price: 5.99, available: true });
  });

  it('skips a page with no Product block rather than inventing a listing', () => {
    expect(parseProduct('<html>403</html>', 'https://www.petco.com/x.html')).toBeUndefined();
  });
});

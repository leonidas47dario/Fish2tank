import { describe, expect, it, vi } from 'vitest';
import {
  fetchStoreInventory, inventoryParams, liveProductUrls, parseProduct, parseStore,
  storeUrlsForCity,
} from './petsmart';
import type { LocalStore } from '../types';

const PRODUCT_HTML = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
 {"@type":"ListItem","position":1,"name":"Fish"},
 {"@type":"ListItem","position":2,"name":"Live Fish"},
 {"@type":"ListItem","position":3,"name":"Goldfish, Betta & More"},
 {"@type":"ListItem","position":4,"name":"Delhezi Bichir"}]}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","sku":"5382009","name":"Delhezi Bichir",
 "image":"https://s7d2.scene7.com/is/image/PetSmart/5382009","gtin13":"0196481143296",
 "offers":{"@type":"Offer","priceCurrency":"USD","price":"19.99","availability":"https://schema.org/InStock",
 "url":"https://www.petsmart.com/fish/live-fish/goldfish-betta-and-more/delhezi-bichir-5382009.html"}}
</script>
</head></html>`;

const STORE_HTML = `
<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Store","name":"Chicago (South Loop)",
 "address":{"@type":"PostalAddress","streetAddress":"1101 South Canal Street",
 "addressLocality":"Chicago","addressRegion":"Illinois","postalCode":"60607"},
 "telephone":"3125880138"}
</script></head></html>`;

const PAGE_URL =
  'https://www.petsmart.com/fish/live-fish/goldfish-betta-and-more/delhezi-bichir-99418.html';

describe('parseProduct', () => {
  it('reads sku, price and availability from the Product JSON-LD', () => {
    const p = parseProduct(PRODUCT_HTML, PAGE_URL)!;
    expect(p.sku).toBe('5382009');
    expect(p.title).toBe('Delhezi Bichir');
    expect(p.price).toBe(19.99);
    expect(p.currency).toBe('USD');
    expect(p.available).toBe(true);
    expect(p.gtin).toBe('0196481143296');
  });

  it('keeps both URLs: the canonical one to link, the fetched one to trace', () => {
    // The sitemap URL and the canonical URL carry different ids for the same
    // product. A row that cannot be traced back to the request that made it is
    // a row nobody can check.
    const p = parseProduct(PRODUCT_HTML, PAGE_URL)!;
    expect(p.url).toContain('delhezi-bichir-5382009.html');
    expect(p.sourceUrl).toBe(PAGE_URL);
  });

  it('takes the aisle from the breadcrumb, not from the title', () => {
    expect(parseProduct(PRODUCT_HTML, PAGE_URL)!.productType).toBe('Goldfish, Betta & More');
  });

  it('returns nothing rather than a listing with no price', () => {
    const noPrice = PRODUCT_HTML.replace('"price":"19.99",', '');
    expect(parseProduct(noPrice, PAGE_URL)).toBeUndefined();
  });

  it('returns nothing for a page with no Product block at all', () => {
    expect(parseProduct('<html><body>maintenance</body></html>', PAGE_URL)).toBeUndefined();
  });

  it('reads sold out as sold out', () => {
    const out = PRODUCT_HTML.replace('schema.org/InStock', 'schema.org/OutOfStock');
    expect(parseProduct(out, PAGE_URL)!.available).toBe(false);
  });
});

describe('parseStore', () => {
  it('strips the locator zero-padding from the store number', () => {
    // chicago-store0428.html is store_428 in the inventory index. Getting this
    // wrong silently reports "not carried" for every product in that store.
    const s = parseStore(STORE_HTML, 'https://www.petsmart.com/stores/us/il/chicago-store0428.html')!;
    expect(s.storeNumber).toBe('428');
  });

  it('reads the address the branch publishes', () => {
    const s = parseStore(STORE_HTML, 'https://www.petsmart.com/stores/us/il/chicago-store1658.html')!;
    expect(s).toMatchObject({
      vendorId: 'petsmart', storeNumber: '1658', city: 'Chicago', postalCode: '60607',
    });
  });
});

describe('sitemap filtering', () => {
  const urls = [
    'https://www.petsmart.com/fish/live-fish/goldfish-betta-and-more/comet-goldfish-15410.html',
    'https://www.petsmart.com/fish/decor-gravel-and-substrate/live-plants/anubias-72149.html',
    'https://www.petsmart.com/fish/decor-gravel-and-substrate/ornaments/skull-1234.html',
    'https://www.petsmart.com/dog/food/dry-food/kibble-99.html',
    'https://www.petsmart.com/fish/live-fish/goldfish-betta-and-more/comet-goldfish-15410.html',
    'https://www.petsmart.com/stores/us/il/chicago-store1658.html',
    'https://www.petsmart.com/stores/us/il/chicago-heights-store2262.html',
    'https://www.petsmart.com/stores/us/ny/chicago-store9999.html',
    'https://www.petsmart.com/stores/us/il/chicago',
  ];

  it('keeps the live-animal aisles and drops the gear', () => {
    expect(liveProductUrls(urls)).toEqual([
      'https://www.petsmart.com/fish/live-fish/goldfish-betta-and-more/comet-goldfish-15410.html',
      'https://www.petsmart.com/fish/decor-gravel-and-substrate/live-plants/anubias-72149.html',
    ]);
  });

  it('matches the city exactly, so Chicago Heights is not Chicago', () => {
    expect(storeUrlsForCity(urls, 'il', 'chicago')).toEqual([
      'https://www.petsmart.com/stores/us/il/chicago-store1658.html',
    ]);
  });
});

describe('inventoryParams', () => {
  it('asks only for the sampled stores', () => {
    // Without this every hit carries on-hand counts for ~1,600 stores.
    const params = new URLSearchParams(inventoryParams(['1', '2'], ['1658', '428']));
    expect(JSON.parse(params.get('attributesToRetrieve')!)).toEqual(['sku', 'store_1658', 'store_428']);
    expect(params.get('filters')).toBe('sku=1 OR sku=2');
  });
});

describe('fetchStoreInventory', () => {
  const stores: LocalStore[] = [
    { vendorId: 'petsmart', storeNumber: '1658', name: 'A', street: '', city: 'Chicago', state: 'IL', postalCode: '', url: '', departments: [] },
    { vendorId: 'petsmart', storeNumber: '428', name: 'B', street: '', city: 'Chicago', state: 'IL', postalCode: '', url: '', departments: [] },
  ];

  it('distinguishes "none today" from "not carried here"', async () => {
    // The index reports store_1658: 0 for a product the store stocks and has
    // none of, and omits the key entirely for one it never stocks. Those are
    // different answers to "is it worth driving there", so they must not both
    // collapse into a zero.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hits: [{ sku: 5382009, store_1658: 0 }] }), { status: 200 }),
    );
    const rows = await fetchStoreInventory(['5382009'], stores, { delayMs: 0, fetchImpl: fetchImpl as never });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ storeNumber: '1658', onHand: 0, carried: true });
    expect(rows[1]).toMatchObject({ storeNumber: '428', onHand: null, carried: false });
  });

  it('emits a row per store per sku, so a missing hit is visibly missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hits: [{ sku: 1, store_1658: 6, store_428: 4 }] }), { status: 200 }),
    );
    const rows = await fetchStoreInventory(['1'], stores, { delayMs: 0, fetchImpl: fetchImpl as never });
    expect(rows.map((r) => r.onHand)).toEqual([6, 4]);
  });
});

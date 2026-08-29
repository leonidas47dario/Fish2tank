import { describe, expect, it } from 'vitest';
import { breadcrumbTrail, parseProductJsonLd } from './schema-org';
import { jsonLdBlocks } from './http';

const ld = (obj: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

const product = (over: Record<string, unknown> = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  sku: '5382009',
  name: 'Delhezi Bichir',
  offers: {
    '@type': 'Offer', priceCurrency: 'USD', price: '19.99',
    availability: 'https://schema.org/InStock',
  },
  ...over,
});

const URL = 'https://example.com/fish/delhezi-bichir.html';

describe('parseProductJsonLd', () => {
  it('reads the fields a listing cannot exist without', () => {
    const p = parseProductJsonLd(ld(product()), URL)!;
    expect(p).toMatchObject({ sku: '5382009', title: 'Delhezi Bichir', price: 19.99, available: true });
  });

  it('returns nothing without a price, rather than a listing priced at zero', () => {
    // A zero would sit in every median downstream looking like a real number.
    expect(parseProductJsonLd(ld(product({ offers: { '@type': 'Offer' } })), URL)).toBeUndefined();
  });

  it('returns nothing without a sku', () => {
    const noSku = product();
    delete (noSku as Record<string, unknown>).sku;
    expect(parseProductJsonLd(ld(noSku), URL)).toBeUndefined();
  });

  it('falls back to productID when the vendor uses that instead of sku', () => {
    const alt = product({ sku: undefined, productID: '99417' });
    expect(parseProductJsonLd(ld(alt), URL)!.sku).toBe('99417');
  });

  it('quotes the cheapest in-stock offer when a product has several', () => {
    // That is the price a buyer is actually offered. Taking the first would
    // quote a sold-out variant.
    const p = parseProductJsonLd(ld(product({
      offers: [
        { '@type': 'Offer', price: '4.99', availability: 'https://schema.org/OutOfStock' },
        { '@type': 'Offer', price: '19.99', availability: 'https://schema.org/InStock' },
        { '@type': 'Offer', price: '29.99', availability: 'https://schema.org/InStock' },
      ],
    })), URL)!;
    expect(p.price).toBe(19.99);
    expect(p.available).toBe(true);
  });

  it('still records a product whose every offer is sold out', () => {
    const p = parseProductJsonLd(ld(product({
      offers: [{ '@type': 'Offer', price: '4.99', availability: 'https://schema.org/OutOfStock' }],
    })), URL)!;
    expect(p.price).toBe(4.99);
    expect(p.available).toBe(false);
  });

  it('takes lowPrice from an AggregateOffer rather than inventing a midpoint', () => {
    const p = parseProductJsonLd(ld(product({
      offers: { '@type': 'AggregateOffer', lowPrice: '8.99', highPrice: '24.99', priceCurrency: 'USD' },
    })), URL)!;
    expect(p.price).toBe(8.99);
  });

  it('reads a @graph-wrapped page', () => {
    const html = ld({ '@graph': [{ '@type': 'WebPage' }, product()] });
    expect(parseProductJsonLd(html, URL)!.sku).toBe('5382009');
  });

  it('takes the aisle from the breadcrumb, never from the title', () => {
    const html = ld({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', name: 'Fish' },
        { '@type': 'ListItem', name: 'Live Fish' },
        { '@type': 'ListItem', name: 'Goldfish, Betta & More' },
        { '@type': 'ListItem', name: 'Delhezi Bichir' },
      ],
    }) + ld(product());
    const p = parseProductJsonLd(html, URL)!;
    expect(p.productType).toBe('Goldfish, Betta & More');
    expect(p.tags).toEqual(['Live Fish', 'Goldfish, Betta & More']);
  });

  it('keeps the fetched URL alongside the canonical one', () => {
    const p = parseProductJsonLd(ld(product({
      offers: { '@type': 'Offer', price: '19.99', url: 'https://example.com/canonical.html' },
    })), URL)!;
    expect(p.url).toBe('https://example.com/canonical.html');
    expect(p.sourceUrl).toBe(URL);
  });

  it('takes the first image when the vendor lists several', () => {
    const p = parseProductJsonLd(ld(product({ image: ['https://img/a.jpg', 'https://img/b.jpg'] })), URL)!;
    expect(p.imageUrl).toBe('https://img/a.jpg');
  });
});

describe('jsonLdBlocks', () => {
  it('skips a malformed block instead of failing the whole page', () => {
    const html = '<script type="application/ld+json">{ not json </script>' + ld(product());
    expect(jsonLdBlocks(html)).toHaveLength(1);
  });

  it('finds nothing on a page with no structured data', () => {
    expect(jsonLdBlocks('<html><body>hello</body></html>')).toEqual([]);
  });
});

describe('breadcrumbTrail', () => {
  it('is empty when the page publishes no breadcrumb', () => {
    expect(breadcrumbTrail(jsonLdBlocks(ld(product())))).toEqual([]);
  });
});

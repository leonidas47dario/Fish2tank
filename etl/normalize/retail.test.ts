import { describe, expect, it } from 'vitest';
import { handleFromUrl, normalizeRetailProduct, numericKey } from './retail';
import { buildMatcher } from './species';
import type { RetailProduct, StoreConfig } from '../types';
import type { Species } from '@/domain/types';

const store: StoreConfig = {
  id: 'petsmart', name: 'PetSmart', host: 'www.petsmart.com', currency: 'USD',
  platform: 'petsmart',
};

const catalog: Species[] = [
  { id: 'sp-jaguar', commonName: 'Jaguar Cichlid', scientificName: 'Parachromis managuensis', aliases: [] },
  { id: 'sp-bichir', commonName: 'Delhezi Bichir', scientificName: 'Polypterus delhezi', aliases: [] },
] as unknown as Species[];

const match = buildMatcher(catalog);

function product(over: Partial<RetailProduct> = {}): RetailProduct {
  return {
    productId: '5382009', variantId: '5382009', sku: '5382009',
    title: 'Delhezi Bichir',
    url: 'https://www.petsmart.com/fish/live-fish/goldfish-betta-and-more/delhezi-bichir-5382009.html',
    sourceUrl: 'https://www.petsmart.com/fish/live-fish/goldfish-betta-and-more/delhezi-bichir-99418.html',
    price: 19.99, currency: 'USD', available: true,
    productType: 'Goldfish, Betta & More', tags: [],
    ...over,
  };
}

describe('normalizeRetailProduct', () => {
  it('produces the same MarketListing shape a Shopify listing produces', () => {
    const l = normalizeRetailProduct(store, product(), match, '2026-08-29T00:00:00Z');
    expect(l).toMatchObject({
      storeId: 'petsmart',
      title: 'Delhezi Bichir',
      price: 19.99,
      currency: 'USD',
      available: true,
      speciesId: 'sp-bichir',
      retrievedAt: '2026-08-29T00:00:00Z',
    });
  });

  it('leaves the size unknown when the vendor never stated one', () => {
    // Big-box live fish are sold at one unstated size. An unknown size is
    // excluded from price comparison, which is right - the alternative is
    // comparing a $19.99 bichir against a ladder it has no rung on.
    const l = normalizeRetailProduct(store, product(), match, '2026-08-29T00:00:00Z');
    expect(l.size).toBeUndefined();
    expect(l.sizeLabel).toBeUndefined();
  });

  it('never mines a marketing title for a number', () => {
    // "- 4 in" here is the plant's pot, not a fish's length. Reading it as a
    // size would put a pot into a size ladder.
    const l = normalizeRetailProduct(
      store,
      product({ title: 'Top Fin Anubias Barteri Live Plant - Live Aquarium Plant for Fish Tanks - 4 in' }),
      match,
      '2026-08-29T00:00:00Z',
    );
    expect(l.size).toBeUndefined();
  });

  it('takes a size the vendor did state', () => {
    const l = normalizeRetailProduct(store, product({ sizeLabel: '3 inches' }), match, 'now');
    expect(l.size).toMatchObject({ value: 3, unit: 'in' });
  });

  it('resolves no species from a trade name the catalog does not know', () => {
    // A big-box vendor titles by trade name, never by binomial. Guessing a
    // species from "Assorted Male Betta" is the mis-match that files Bass
    // under Peacock Bass, so it resolves to nothing at all.
    const l = normalizeRetailProduct(store, product({ title: 'Assorted Male Betta' }), match, 'now');
    expect(l.speciesId).toBeUndefined();
    expect(l.matchMethod).toBeUndefined();
  });
});

describe('handleFromUrl', () => {
  it('takes the vendor slug from the page actually fetched', () => {
    expect(handleFromUrl('https://www.petsmart.com/fish/live-fish/x/delhezi-bichir-99418.html'))
      .toBe('delhezi-bichir-99418');
  });
});

describe('numericKey', () => {
  it('passes a numeric sku straight through', () => {
    expect(numericKey('5382009')).toBe(5382009);
  });

  it('hashes a non-numeric sku rather than collapsing it to zero', () => {
    expect(numericKey('AB-12')).toBeGreaterThan(0);
    expect(numericKey('AB-12')).not.toBe(numericKey('AB-13'));
  });
});

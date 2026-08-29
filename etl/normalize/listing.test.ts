import { describe, expect, it } from 'vitest';
import { normalizeStore } from './listing';
import { buildMarketIndex } from '../index-builder';
import type { StoreConfig } from '../types';
import type { ShopifyProduct } from '../sources/shopify';

const STORE: StoreConfig = {
  id: 'test-store',
  name: 'Test Store',
  host: 'test.example.com',
  currency: 'USD',
};

let nextId = 1;

/** A Shopify product with one priced, size-bearing variant per size given. */
function product(title: string, sizes: string[], price: number): ShopifyProduct {
  const id = nextId++;
  return {
    id,
    title,
    handle: `p-${id}`,
    body_html: '',
    vendor: 'Test',
    product_type: 'Freshwater Fish',
    tags: [],
    published_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    variants: sizes.map((option1, i) => ({
      id: id * 1000 + i,
      product_id: id,
      title: option1,
      option1,
      option2: null,
      option3: null,
      price: String(price),
      compare_at_price: null,
      available: true,
      updated_at: '2026-01-01T00:00:00Z',
    })),
  } as ShopifyProduct;
}

const normalize = (products: ShopifyProduct[]) =>
  normalizeStore(STORE, products, [], '2026-01-01T00:00:00Z');

describe('a species the vendors spelled several ways', () => {
  /**
   * THE BUG THIS COVERS. `Symphysodon aequifasciatus` is sold under three
   * spellings, and the derivation faithfully minted three species from them.
   * build-marts.ts drops the two non-canonical records from the catalog, but
   * the market index is built by a different stage that never knew about the
   * drop, so their listings stayed attached to ids the catalog no longer
   * shows. The shipped Discus median came from the minority record.
   */
  it('pools every spelling into the one record the catalog keeps', () => {
    const listings = normalize([
      product('Blue Discus (Symphysodon aequifasciatus)', ['3 inches'], 95),
      product('Red Discus (Symphysodon aequifasciata)', ['3 inches'], 60),
      product('Turquoise Discus (Symphysodon aequifaciatus)', ['4 inches'], 80),
    ]);

    expect(new Set(listings.map((l) => l.speciesId))).toEqual(
      new Set(['sp_symphysodon_aequifasciatus']),
    );

    const index = buildMarketIndex(listings, { minimumSampleCount: 3 });
    expect(Object.keys(index.species)).toEqual(['sp_symphysodon_aequifasciatus']);
    expect(index.species.sp_symphysodon_aequifasciatus?.comparableCount).toBe(3);
  });

  it('keeps the binomial the vendor actually wrote, so the fold stays auditable', () => {
    const [listing] = normalize([
      product('Red Discus (Symphysodon aequifasciata)', ['3 inches'], 60),
    ]);
    expect(listing?.speciesId).toBe('sp_symphysodon_aequifasciatus');
    expect(listing?.scientificNameInTitle).toBe('Symphysodon aequifasciata');
  });

  it('does not fold a genuinely different species in the same genus', () => {
    const listings = normalize([
      product('Heckel Discus (Symphysodon discus)', ['3 inches'], 275),
      product('Blue Discus (Symphysodon aequifasciatus)', ['3 inches'], 95),
    ]);
    expect(listings.map((l) => l.speciesId)).toEqual([
      'sp_symphysodon_discus',
      'sp_symphysodon_aequifasciatus',
    ]);
  });
});

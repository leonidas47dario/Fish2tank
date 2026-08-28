/**
 * One-shot ETL: pull every published listing from the tracked stores,
 * normalize it, and build the market index the app ships with.
 *
 *   npm run etl            # fetch + normalize + index
 *   npm run etl -- --offline   # rebuild from the last raw snapshot, no network
 *
 * Re-runnable: each run overwrites the outputs and stamps a fresh retrievedAt.
 * Because sold-out products stay published on Shopify, a single run already
 * captures years of back catalogue - 84% of the listings across these three
 * stores are sold out.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAllProducts, type ShopifyProduct } from './sources/shopify';
import { normalizeStore, isLivestock } from './normalize/listing';
import { buildMarketIndex } from './index-builder';
import { STORES, type MarketListing } from './types';
import { SPECIES_CATALOG } from '@/data/seed/species-catalog';

const RAW_DIR = 'etl/raw';
const OUT_DIR = 'data/market';
const APP_INDEX = 'src/data/seed/market/market-index.json';

const offline = process.argv.includes('--offline');
const catalog = SPECIES_CATALOG.map((e) => e.species);

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync('src/data/seed/market', { recursive: true });

  const allListings: MarketListing[] = [];
  const sources: Array<(typeof STORES)[number] & { listingsFetched: number; retrievedAt: string }> = [];

  for (const store of STORES) {
    const rawPath = join(RAW_DIR, `${store.id}.json`);
    const retrievedAt = new Date().toISOString();
    let products: ShopifyProduct[];

    if (offline) {
      if (!existsSync(rawPath)) {
        console.error(`  ${store.id}: no cached snapshot at ${rawPath}, skipping`);
        continue;
      }
      const cached = JSON.parse(readFileSync(rawPath, 'utf8')) as { retrievedAt: string; products: ShopifyProduct[] };
      products = cached.products;
      console.log(`  ${store.name}: ${products.length} products from cache (${cached.retrievedAt})`);
    } else {
      process.stdout.write(`  ${store.name}: fetching`);
      products = await fetchAllProducts(store.host, {
        onPage: (page, count) => process.stdout.write(` p${page}:${count}`),
      });
      process.stdout.write(`  -> ${products.length} products\n`);
      writeFileSync(rawPath, JSON.stringify({ store: store.id, retrievedAt, products }, null, 2));
    }

    const normalized = normalizeStore(store, products, catalog, retrievedAt).filter(isLivestock);
    allListings.push(...normalized);
    sources.push({ ...store, listingsFetched: normalized.length, retrievedAt });
  }

  // --- Outputs ------------------------------------------------------------
  writeFileSync(join(OUT_DIR, 'listings.jsonl'), allListings.map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(join(OUT_DIR, 'listings.csv'), toCsv(allListings));

  const index = buildMarketIndex(allListings, { sources });
  writeFileSync(APP_INDEX, JSON.stringify(index, null, 2));

  report(allListings, index);
}

function toCsv(listings: MarketListing[]): string {
  const cols = [
    'storeId', 'title', 'speciesId', 'matchMethod', 'scientificNameInTitle',
    'price', 'compareAtPrice', 'currency', 'sizeLabel', 'sizeValue', 'sizeUnit',
    'available', 'publishedAt', 'retrievedAt', 'url',
  ];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = listings.map((l) => [
    l.storeId, l.title, l.speciesId, l.matchMethod, l.scientificNameInTitle,
    l.price, l.compareAtPrice, l.currency, l.sizeLabel, l.size?.value, l.size?.unit,
    l.available, l.publishedAt, l.retrievedAt, l.url,
  ].map(esc).join(','));
  return [cols.join(','), ...rows].join('\n') + '\n';
}

function report(listings: MarketListing[], index: ReturnType<typeof buildMarketIndex>) {
  const matched = listings.filter((l) => l.speciesId).length;
  const sized = listings.filter((l) => l.size).length;
  const soldOut = listings.filter((l) => !l.available).length;

  console.log('\n─── ETL summary ───');
  console.log(`  listings           ${listings.length}`);
  console.log(`  sold out           ${soldOut}  (${pct(soldOut, listings.length)})  <- the back catalogue`);
  console.log(`  with a real size   ${sized}  (${pct(sized, listings.length)})`);
  console.log(`  matched to catalog ${matched}  (${pct(matched, listings.length)})`);
  console.log(`  species indexed    ${Object.keys(index.species).length}  (>= ${index.minimumSampleCount} sized listings)`);
  console.log(`  unmatched binomials ${index.unmatchedScientificNames.length}`);
  console.log(`\n  wrote ${OUT_DIR}/listings.jsonl, ${OUT_DIR}/listings.csv, ${APP_INDEX}`);
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%');

main().catch((e) => { console.error(e); process.exitCode = 1; });

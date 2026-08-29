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
import * as petsmart from './sources/petsmart';
import * as petco from './sources/petco';
import { normalizeStore, isLivestock } from './normalize/listing';
import { normalizeRetailStore } from './normalize/retail';
import { buildMarketIndex } from './index-builder';
import {
  SAMPLED_CITY, STORES,
  type LocalStore, type MarketListing, type RetailProduct, type StoreInventory,
} from './types';
import { SPECIES_CATALOG } from '@/data/seed/species-catalog';

const RAW_DIR = 'etl/raw';
const OUT_DIR = 'data/market';
const APP_INDEX = 'src/data/seed/marts/market-index.json';

const offline = process.argv.includes('--offline');
const catalog = SPECIES_CATALOG.map((e) => e.species);

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync('src/data/seed/marts', { recursive: true });

  const allListings: MarketListing[] = [];
  const localStores: LocalStore[] = [];
  const storeInventory: StoreInventory[] = [];
  const sources: Array<(typeof STORES)[number] & { listingsFetched: number; retrievedAt: string }> = [];

  /** Read a cached snapshot, or the file that says why there is none. */
  const readCache = <T,>(path: string): T | undefined =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;

  for (const store of STORES) {
    const rawPath = join(RAW_DIR, `${store.id}.json`);
    const retrievedAt = new Date().toISOString();
    const platform = store.platform ?? 'shopify';

    // ---- Shopify -------------------------------------------------------
    if (platform === 'shopify') {
      let products: ShopifyProduct[];
      if (offline) {
        const cached = readCache<{ retrievedAt: string; products: ShopifyProduct[] }>(rawPath);
        if (!cached) {
          console.error(`  ${store.id}: no cached snapshot at ${rawPath}, skipping`);
          continue;
        }
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
      continue;
    }

    // ---- PetSmart ------------------------------------------------------
    //
    // Three separate reads, because they are three separate facts: the
    // national catalogue, the branches, and today's count in each branch.
    if (platform === 'petsmart') {
      type Snapshot = {
        retrievedAt: string;
        products: RetailProduct[];
        stores: LocalStore[];
        inventory: StoreInventory[];
      };
      let snap: Snapshot;

      if (offline) {
        const cached = readCache<Snapshot>(rawPath);
        if (!cached) {
          console.error(`  ${store.id}: no cached snapshot at ${rawPath}, skipping`);
          continue;
        }
        snap = cached;
        console.log(
          `  ${store.name}: ${snap.products.length} products, ${snap.stores.length} ${SAMPLED_CITY.label} stores from cache (${snap.retrievedAt})`,
        );
      } else {
        process.stdout.write(`  ${store.name}: sitemap`);
        const urls = await petsmart.fetchSitemapUrls();
        const productUrls = petsmart.liveProductUrls(urls);
        const storeUrls = petsmart.storeUrlsForCity(urls, SAMPLED_CITY.state, SAMPLED_CITY.citySlug);
        process.stdout.write(
          ` -> ${productUrls.length} live products, ${storeUrls.length} ${SAMPLED_CITY.label} stores\n`,
        );

        process.stdout.write(`    stores`);
        const stores = await petsmart.fetchStores(storeUrls);
        process.stdout.write(` -> ${stores.length}\n`);

        process.stdout.write(`    products`);
        const products = await petsmart.fetchProducts(productUrls, {
          onProgress: (done, total) => {
            if (done % 25 === 0 || done === total) process.stdout.write(` ${done}/${total}`);
          },
        });
        process.stdout.write(`\n`);

        process.stdout.write(`    on-hand counts`);
        const inventory = await petsmart.fetchStoreInventory(products.map((p) => p.sku), stores);
        process.stdout.write(` -> ${inventory.length} store/sku rows\n`);

        snap = { retrievedAt, products, stores, inventory };
        writeFileSync(rawPath, JSON.stringify({ store: store.id, ...snap }, null, 2));
      }

      const normalized = normalizeRetailStore(store, snap.products, catalog, snap.retrievedAt).filter(isLivestock);
      allListings.push(...normalized);
      localStores.push(...snap.stores);
      storeInventory.push(...snap.inventory);
      sources.push({ ...store, listingsFetched: normalized.length, retrievedAt: snap.retrievedAt });
      continue;
    }

    // ---- Petco ---------------------------------------------------------
    //
    // Two hosts, asked separately every run. The store directory is open and
    // always read. The storefront is behind a CDN bot manager that refuses
    // datacentre traffic, so it is PROBED rather than assumed either way: the
    // block is a property of the network, not of the code, and the same run
    // from an ordinary connection may be waved straight through. Whatever it
    // answers is recorded as data - see sources/petco.ts.
    if (platform === 'petco') {
      type Snapshot = {
        retrievedAt: string;
        stores: LocalStore[];
        products: RetailProduct[];
        access: petco.StorefrontAccess;
      };
      let snap: Snapshot;

      if (offline) {
        const cached = readCache<Snapshot>(rawPath);
        if (!cached) {
          console.error(`  ${store.id}: no cached snapshot at ${rawPath}, skipping`);
          continue;
        }
        snap = cached;
        console.log(
          `  ${store.name}: ${snap.products?.length ?? 0} products, ${snap.stores.length} ${SAMPLED_CITY.label} stores from cache (${snap.retrievedAt})`,
        );
      } else {
        process.stdout.write(`  ${store.name}: store directory`);
        const urls = await petco.fetchStoreDirectoryUrls();
        const storeUrls = petco.storeUrlsForCity(urls, SAMPLED_CITY.state, SAMPLED_CITY.citySlug);
        process.stdout.write(` -> ${storeUrls.length} ${SAMPLED_CITY.label} branches\n`);
        const stores = await petco.fetchStores(storeUrls);
        const aquatics = stores.filter(petco.hasAquatics).length;
        process.stdout.write(`    read ${stores.length}, ${aquatics} run an aquatics department\n`);

        process.stdout.write(`    storefront: asking www.petco.com`);
        const access = await petco.probeStorefront();
        let products: RetailProduct[] = [];
        if (!access.readable) {
          process.stdout.write(` -> HTTP ${access.status}, refused\n`);
          console.warn(`    ${access.reason}`);
        } else {
          process.stdout.write(` -> allowed\n`);
          const productUrls = await petco.fetchProductUrls();
          process.stdout.write(`    products: ${productUrls.length} live URLs`);
          products = await petco.fetchProducts(productUrls, {
            onProgress: (done, total) => {
              if (done % 25 === 0 || done === total) process.stdout.write(` ${done}/${total}`);
            },
          });
          process.stdout.write(`\n`);
          // Allowed in but nothing parsed is a real finding, not a quiet zero:
          // it means the storefront stopped publishing Product JSON-LD.
          if (productUrls.length > 0 && products.length === 0) {
            console.warn(
              '    storefront was readable but no product carried schema.org Product JSON-LD - ' +
              'the extraction contract has changed, see etl/sources/schema-org.ts',
            );
          }
        }

        snap = { retrievedAt, stores, products, access };
        writeFileSync(rawPath, JSON.stringify({ store: store.id, ...snap }, null, 2));
      }

      const normalized = normalizeRetailStore(store, snap.products ?? [], catalog, snap.retrievedAt)
        .filter(isLivestock);
      allListings.push(...normalized);
      localStores.push(...snap.stores);
      sources.push({
        ...store,
        listingsFetched: normalized.length,
        retrievedAt: snap.retrievedAt,
        // Stated in the shipped index so "Petco: 0 listings" is never left
        // looking like a broken run.
        ...(snap.access?.readable ? {} : { accessNote: snap.access?.reason }),
      });
    }
  }

  // --- Outputs ------------------------------------------------------------
  writeFileSync(join(OUT_DIR, 'listings.jsonl'), allListings.map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(join(OUT_DIR, 'listings.csv'), toCsv(allListings));

  // Branches and their on-hand counts are separate outputs, because they are
  // separate grains. Both are small and both are committed, unlike listings.
  writeFileSync(
    join(OUT_DIR, 'local-stores.jsonl'),
    localStores.map((s) => JSON.stringify(s)).join('\n') + (localStores.length ? '\n' : ''),
  );
  writeFileSync(
    join(OUT_DIR, 'store-inventory.jsonl'),
    storeInventory.map((s) => JSON.stringify(s)).join('\n') + (storeInventory.length ? '\n' : ''),
  );

  const index = buildMarketIndex(allListings, { sources });
  writeFileSync(APP_INDEX, JSON.stringify(index, null, 2));

  report(allListings, index, localStores, storeInventory);
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

function report(
  listings: MarketListing[],
  index: ReturnType<typeof buildMarketIndex>,
  localStores: LocalStore[],
  storeInventory: StoreInventory[],
) {
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

  if (localStores.length) {
    console.log(`\n─── ${SAMPLED_CITY.label} branches ───`);
    for (const vendorId of [...new Set(localStores.map((s) => s.vendorId))]) {
      const mine = localStores.filter((s) => s.vendorId === vendorId);
      const withAquatics = mine.filter((s) => s.departments.some((d) => /aquatic/i.test(d))).length;
      const rows = storeInventory.filter((i) => i.vendorId === vendorId);
      const carried = rows.filter((i) => i.carried).length;
      const inStock = rows.filter((i) => (i.onHand ?? 0) > 0).length;
      console.log(`  ${vendorId.padEnd(10)} ${String(mine.length).padStart(2)} branches` +
        (withAquatics ? `, ${withAquatics} with an aquatics department` : '') +
        (rows.length ? `, ${rows.length} store/sku rows (${carried} carried, ${inStock} with stock on hand)` : ', no per-store stock published'));
    }
  }

  const refused = index.sources.filter((s) => s.accessNote);
  if (refused.length) {
    console.log('\n─── vendors that refused this run ───');
    for (const s of refused) {
      console.log(`  ${s.name}: ${s.accessNote}`);
    }
  }

  console.log(`\n  wrote ${OUT_DIR}/listings.jsonl, ${OUT_DIR}/listings.csv, ` +
    `${OUT_DIR}/local-stores.jsonl, ${OUT_DIR}/store-inventory.jsonl, ${APP_INDEX}`);
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%');

main().catch((e) => { console.error(e); process.exitCode = 1; });

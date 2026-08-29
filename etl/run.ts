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
import { discoverSpecies } from './normalize/derive-species';
import { normalizeRetailStore } from './normalize/retail';
import { buildMarketIndex } from './index-builder';
import {
  SAMPLED_CITY, STORES,
  type LocalStore, type MarketListing, type RetailProduct, type StoreInventory,
} from './types';
import type { Species } from '@/domain/types';
import { SPECIES_CATALOG } from '@/data/seed/species-catalog';

const RAW_DIR = 'etl/raw';
const OUT_DIR = 'data/market';
const APP_INDEX = 'src/data/seed/marts/market-index.json';

const offline = process.argv.includes('--offline');
/** Publish an index built from fewer stores than STORES declares. See main(). */
const allowPartial = process.argv.includes('--allow-partial');
const catalog = SPECIES_CATALOG.map((e) => e.species);

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync('src/data/seed/marts', { recursive: true });

  const allListings: MarketListing[] = [];
  const localStores: LocalStore[] = [];
  const storeInventory: StoreInventory[] = [];
  const sources: Array<(typeof STORES)[number] & {
    listingsFetched: number; retrievedAt: string; accessNote?: string;
  }> = [];
  const failures: Array<{ storeId: string; reason: string }> = [];
  /** Shopify stores held back for the second matching pass below. */
  const shopify: Array<{ store: (typeof STORES)[number]; products: ShopifyProduct[]; retrievedAt: string }> = [];

  const readCache = <T,>(path: string): T | undefined =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;

  for (const store of STORES) {
    const rawPath = join(RAW_DIR, `${store.id}.json`);
    const retrievedAt = new Date().toISOString();
    const platform = store.platform ?? 'shopify';
    let products: ShopifyProduct[];

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
          console.error(`  ${store.name}: no cached snapshot at ${rawPath} -> SKIPPED`);
          failures.push({ storeId: store.id, reason: `no cached snapshot at ${rawPath}` });
          continue;
        }
        snap = cached;
        console.log(
          `  ${store.name}: ${snap.products.length} products, ${snap.stores.length} ${SAMPLED_CITY.label} stores from cache (${snap.retrievedAt})`,
        );
      } else {
        try {
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
          const fetched = await petsmart.fetchProducts(productUrls, {
            onProgress: (done, total) => {
              if (done % 25 === 0 || done === total) process.stdout.write(` ${done}/${total}`);
            },
          });
          process.stdout.write(`\n`);

          process.stdout.write(`    on-hand counts`);
          const inventory = await petsmart.fetchStoreInventory(fetched.map((p) => p.sku), stores);
          process.stdout.write(` -> ${inventory.length} store/sku rows\n`);

          snap = { retrievedAt, products: fetched, stores, inventory };
          writeFileSync(rawPath, JSON.stringify({ store: store.id, ...snap }, null, 2));
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          process.stdout.write(`  -> FAILED\n`);
          console.error(`      ${reason}`);
          failures.push({ storeId: store.id, reason });
          continue;
        }
      }

      const normalized = normalizeRetailStore(store, snap.products, catalog, snap.retrievedAt)
        .filter(isLivestock);
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
    //
    // A refusal is NOT a run failure. The vendor answered, the answer was no,
    // and that is recorded rather than treated as an outage - unlike the store
    // directory going down, which is.
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
          console.error(`  ${store.name}: no cached snapshot at ${rawPath} -> SKIPPED`);
          failures.push({ storeId: store.id, reason: `no cached snapshot at ${rawPath}` });
          continue;
        }
        snap = cached;
        console.log(
          `  ${store.name}: ${snap.products?.length ?? 0} products, ${snap.stores.length} ${SAMPLED_CITY.label} stores from cache (${snap.retrievedAt})`,
        );
      } else {
        try {
          process.stdout.write(`  ${store.name}: store directory`);
          const urls = await petco.fetchStoreDirectoryUrls();
          const storeUrls = petco.storeUrlsForCity(urls, SAMPLED_CITY.state, SAMPLED_CITY.citySlug);
          process.stdout.write(` -> ${storeUrls.length} ${SAMPLED_CITY.label} branches\n`);
          const stores = await petco.fetchStores(storeUrls);
          const aquatics = stores.filter(petco.hasAquatics).length;
          process.stdout.write(`    read ${stores.length}, ${aquatics} run an aquatics department\n`);

          process.stdout.write(`    storefront: asking www.petco.com`);
          const access = await petco.probeStorefront();
          let fetched: RetailProduct[] = [];
          if (!access.readable) {
            process.stdout.write(` -> HTTP ${access.status}, refused\n`);
            console.warn(`    ${access.reason}`);
          } else {
            process.stdout.write(` -> allowed\n`);
            const productUrls = await petco.fetchProductUrls();
            process.stdout.write(`    products: ${productUrls.length} live URLs`);
            fetched = await petco.fetchProducts(productUrls, {
              onProgress: (done, total) => {
                if (done % 25 === 0 || done === total) process.stdout.write(` ${done}/${total}`);
              },
            });
            process.stdout.write(`\n`);
            // Allowed in but nothing parsed is a real finding, not a quiet
            // zero: it means the storefront stopped publishing Product JSON-LD.
            if (productUrls.length > 0 && fetched.length === 0) {
              console.warn(
                '    storefront was readable but no product carried schema.org Product JSON-LD - ' +
                'the extraction contract has changed, see etl/sources/schema-org.ts',
              );
            }
          }

          snap = { retrievedAt, stores, products: fetched, access };
          writeFileSync(rawPath, JSON.stringify({ store: store.id, ...snap }, null, 2));
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          process.stdout.write(`  -> FAILED\n`);
          console.error(`      ${reason}`);
          failures.push({ storeId: store.id, reason });
          continue;
        }
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
      continue;
    }

    // ---- Shopify -------------------------------------------------------
    if (offline) {
      if (!existsSync(rawPath)) {
        console.error(`  ${store.name}: no cached snapshot at ${rawPath} -> SKIPPED`);
        failures.push({ storeId: store.id, reason: `no cached snapshot at ${rawPath}` });
        continue;
      }
      const cached = JSON.parse(readFileSync(rawPath, 'utf8')) as { retrievedAt: string; products: ShopifyProduct[] };
      products = cached.products;
      console.log(`  ${store.name}: ${products.length} products from cache (${cached.retrievedAt})`);
    } else {
      process.stdout.write(`  ${store.name}: fetching`);
      try {
        products = await fetchAllProducts(store.host, {
          onPage: (page, count) => process.stdout.write(` p${page}:${count}`),
        });
      } catch (e) {
        // One small business's server being down must not discard the nine
        // stores that answered. Recorded, never swallowed - the run still
        // refuses to publish below.
        const reason = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  -> FAILED\n`);
        console.error(`      ${reason}`);
        failures.push({ storeId: store.id, reason });
        continue;
      }
      process.stdout.write(`  -> ${products.length} products\n`);
      writeFileSync(rawPath, JSON.stringify({ store: store.id, retrievedAt, products }, null, 2));
    }

    shopify.push({ store, products, retrievedAt });
  }

  /**
   * SECOND PASS, because one pass can only read the vendors who write Latin.
   *
   * The curated catalog is 47 species; everything else the app knows was
   * minted from binomials vendors put in their own titles. So a shop listing
   * "Black Ruby Barb - L" rather than "Puntius nigrofasciatus" can only ever
   * match those 47 and silently contributes nothing. Nu Aqua - the one
   * independent shop Ryan can walk into - resolved 39 of 1,222 listings, 3.2%.
   *
   * Pass 1 resolves what the vendors name outright and mints species from it.
   * Pass 2 re-reads every store against curated + discovered.
   *
   * ONLY UNAMBIGUOUS DISCOVERED NAMES ARE TRUSTED, and that restriction is
   * load-bearing rather than cautious. deriveCommonName shortens titles to a
   * shared tail, which for "Regal Angelfish EXPERT ONLY" and friends produces
   * the common name "Expert Only" - a two-word name that phrase-matches inside
   * any longer title and, unfiltered, swallowed 302 listings whose titles
   * state a completely different binomial ("Chili Coral EXPERT ONLY" filed as
   * a marine angelfish). The "Bass" / "Peacock Bass" guard in
   * normalize/species.ts only protects SINGLE-word names, and two words is
   * exactly what deriveCommonName emits. A name claimed by more than one
   * species is evidence it names none of them, so it is dropped. Raw product
   * titles are not used as match aliases at all.
   */
  const pass1 = shopify
    .flatMap((f) => normalizeStore(f.store, f.products, catalog, f.retrievedAt))
    .filter(isLivestock);

  const curatedBinomials = new Set(
    catalog.map((s) => s.scientificName?.toLowerCase()).filter((n): n is string => Boolean(n)),
  );
  const discovered = discoverSpecies(pass1, curatedBinomials);

  const claims = new Map<string, number>();
  for (const d of discovered) {
    const n = d.commonName.toLowerCase();
    claims.set(n, (claims.get(n) ?? 0) + 1);
  }
  let ambiguous = 0;
  const vocabulary: Species[] = [
    ...catalog,
    ...discovered.map((d) => {
      const unique = (claims.get(d.commonName.toLowerCase()) ?? 0) === 1;
      if (!unique) ambiguous += 1;
      return {
        id: d.speciesId,
        commonName: unique ? d.commonName : d.scientificName,
        scientificName: d.scientificName,
        aliases: [],
        createdAt: new Date(0).toISOString(),
      };
    }),
  ];
  console.log(
    `\n  vocabulary: ${catalog.length} curated + ${discovered.length} discovered ` +
    `(${ambiguous} common names dropped as ambiguous)`,
  );

  for (const { store, products, retrievedAt } of shopify) {
    const before = pass1.filter((l) => l.storeId === store.id);
    const normalized = normalizeStore(store, products, vocabulary, retrievedAt).filter(isLivestock);
    const rate = (ls: MarketListing[]) => (ls.length ? ls.filter((l) => l.speciesId).length / ls.length : 0);
    // Outcome, not intent: a pass that resolved nothing extra is what you need
    // to see in the log.
    console.log(
      `  ${store.name}: ${normalized.length} livestock, resolve ` +
      `${(rate(before) * 100).toFixed(1)}% -> ${(rate(normalized) * 100).toFixed(1)}%`,
    );
    allListings.push(...normalized);
    sources.push({ ...store, listingsFetched: normalized.length, retrievedAt });
  }

  // --- Outputs ------------------------------------------------------------
  // The diagnostic dumps are always written: they are how you work out what a
  // partial run actually got, and nothing ships from them.
  writeFileSync(join(OUT_DIR, 'listings.jsonl'), allListings.map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(join(OUT_DIR, 'listings.csv'), toCsv(allListings));

  // Branches and their on-hand counts are separate outputs, because they are
  // separate grains: a count in one building that changes hourly is not a
  // published price. Both are small enough to commit, unlike listings.
  writeFileSync(
    join(OUT_DIR, 'local-stores.jsonl'),
    localStores.map((s) => JSON.stringify(s)).join('\n') + (localStores.length ? '\n' : ''),
  );
  writeFileSync(
    join(OUT_DIR, 'store-inventory.jsonl'),
    storeInventory.map((s) => JSON.stringify(s)).join('\n') + (storeInventory.length ? '\n' : ''),
  );

  const index = buildMarketIndex(allListings, {
    sources,
    ...(failures.length ? { partial: failures } : {}),
  });

  report(allListings, index, failures, localStores, storeInventory);

  /**
   * A partial refresh must not quietly degrade what the app ships.
   *
   * Every median, and the market-scarcity denominator behind it, is computed
   * over whatever stores answered. Overwriting market-index.json after a
   * nine-of-ten run silently reprices the catalog against a smaller market,
   * and nothing in the app would say so. This is also how the shipped index
   * came to list 8 vendors while STORES declared 10: an offline run skipped
   * the two with no snapshot and published anyway.
   *
   * So the default is to refuse, and --allow-partial is the explicit,
   * recorded way to say you meant it.
   */
  if (failures.length && !allowPartial) {
    console.error(`\n  ✗ ${failures.length} of ${STORES.length} stores failed - ${APP_INDEX} NOT overwritten.`);
    console.error('    Re-run when they are up, or pass --allow-partial to publish without them.');
    process.exitCode = 1;
    return;
  }

  writeFileSync(APP_INDEX, JSON.stringify(index, null, 2));
  console.log(`\n  wrote ${OUT_DIR}/listings.jsonl, ${OUT_DIR}/listings.csv, ` +
    `${OUT_DIR}/local-stores.jsonl, ${OUT_DIR}/store-inventory.jsonl, ${APP_INDEX}`);
  if (failures.length) {
    console.warn(`  ⚠ published WITHOUT ${failures.map((f) => f.storeId).join(', ')} (--allow-partial).`);
    console.warn('    Prices and market scarcity are computed over the stores that answered.');
  }
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
  failures: Array<{ storeId: string; reason: string }>,
  localStores: LocalStore[],
  storeInventory: StoreInventory[],
) {
  const matched = listings.filter((l) => l.speciesId).length;
  const sized = listings.filter((l) => l.size).length;
  const soldOut = listings.filter((l) => !l.available).length;

  console.log('\n─── ETL summary ───');
  console.log(`  stores answered    ${index.sources.length} of ${STORES.length}`);
  console.log(`  listings           ${listings.length}`);
  console.log(`  sold out           ${soldOut}  (${pct(soldOut, listings.length)})  <- the back catalogue`);
  console.log(`  with a real size   ${sized}  (${pct(sized, listings.length)})`);
  console.log(`  matched to catalog ${matched}  (${pct(matched, listings.length)})`);
  console.log(`  species indexed    ${Object.keys(index.species).length}  (>= ${index.minimumSampleCount} sized listings)`);
  console.log(`  unmatched binomials ${index.unmatchedScientificNames.length}`);
  for (const f of failures) console.log(`  ✗ ${f.storeId}: ${f.reason}`);

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
        (rows.length
          ? `, ${rows.length} store/sku rows (${carried} carried, ${inStock} with stock on hand)`
          : ', no per-store stock published'));
    }
  }

  // A vendor that answered "no" is not a vendor that failed, and the two must
  // not read the same. This is the difference between a scope and an outage.
  const refused = index.sources.filter((s) => s.accessNote);
  if (refused.length) {
    console.log('\n─── vendors that refused this run ───');
    for (const s of refused) console.log(`  ${s.name}: ${s.accessNote}`);
  }
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%');

main().catch((e) => { console.error(e); process.exitCode = 1; });

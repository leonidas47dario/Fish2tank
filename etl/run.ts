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
import { discoverSpecies } from './normalize/derive-species';
import { buildMarketIndex } from './index-builder';
import { STORES, type MarketListing } from './types';
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

  const fetched: Array<{ store: (typeof STORES)[number]; products: ShopifyProduct[]; retrievedAt: string }> = [];
  const failures: Array<{ storeId: string; reason: string }> = [];

  for (const store of STORES) {
    const rawPath = join(RAW_DIR, `${store.id}.json`);
    const retrievedAt = new Date().toISOString();
    let products: ShopifyProduct[];

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

    fetched.push({ store, products, retrievedAt });
  }

  /**
   * TWO PASSES, because one pass can only read the vendors who write Latin.
   *
   * The curated catalog is 47 species. Everything else the app knows was
   * MINTED from binomials vendors put in their own titles, which means a store
   * that writes "Black Ruby Barb - L" instead of "Puntius nigrofasciatus" can
   * only ever match those 47 - and silently contributes nothing.
   *
   * That is not a rounding error, it decides what the app can say. Measured on
   * Nu Aqua, the one shop the owner can physically walk into: 1,222 livestock
   * listings, 39 matched against the curated 47, a 3.2% resolve rate. Against
   * the vocabulary the binomial-writing stores establish in pass 1, the same
   * snapshot resolves 294 listings across 168 species - 24.1%. Nothing about
   * the store changed; we simply learned the names first.
   *
   * So: pass 1 resolves what the vendors name outright and mints species from
   * it. Pass 2 re-reads every store against curated + discovered. Order does
   * not matter within a pass, and the result is deterministic, because
   * discoverSpecies derives its ids from the binomial alone.
   */
  const pass1 = fetched
    .flatMap((f) => normalizeStore(f.store, f.products, catalog, f.retrievedAt))
    .filter(isLivestock);

  const curatedBinomials = new Set(
    catalog.map((s) => s.scientificName?.toLowerCase()).filter((n): n is string => Boolean(n)),
  );
  const discovered = discoverSpecies(pass1, curatedBinomials);
  const vocabulary: Species[] = [
    ...catalog,
    ...discovered.map((d) => ({
      id: d.speciesId,
      commonName: d.commonName,
      scientificName: d.scientificName,
      aliases: d.aliases,
      createdAt: new Date(0).toISOString(),
    })),
  ];
  console.log(
    `\n  vocabulary: ${catalog.length} curated + ${discovered.length} discovered = ${vocabulary.length}`,
  );

  const allListings: MarketListing[] = [];
  const sources: Array<(typeof STORES)[number] & { listingsFetched: number; retrievedAt: string }> = [];
  for (const { store, products, retrievedAt } of fetched) {
    const normalized = normalizeStore(store, products, vocabulary, retrievedAt).filter(isLivestock);
    const before = pass1.filter((l) => l.storeId === store.id);
    const rate = (ls: MarketListing[]) => (ls.length ? ls.filter((l) => l.speciesId).length / ls.length : 0);
    // Log the outcome, not just the intent: a pass that quietly resolved
    // nothing extra is the thing worth seeing.
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

  const index = buildMarketIndex(allListings, {
    sources,
    ...(failures.length ? { partial: failures } : {}),
  });

  report(allListings, index, failures);

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
  console.log(`\n  wrote ${OUT_DIR}/listings.jsonl, ${OUT_DIR}/listings.csv, ${APP_INDEX}`);
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
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%');

main().catch((e) => { console.error(e); process.exitCode = 1; });

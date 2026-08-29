/**
 * Rebuild the market index from the warehouse, with no network.
 *
 *   npm run reindex
 *
 * WHY THIS EXISTS. Until now the only way to regenerate market-index.json was
 * to re-scrape every vendor, because normalization ran on raw Shopify JSON and
 * `etl/raw/` is not committed. That made a normalization fix un-shippable
 * without a full scrape - species-overrides.ts says so in as many words about
 * the duplicate-Discus pooling: "market-index.json is built by a separate
 * stage that needs a full vendor re-scrape". A vendor being down therefore
 * blocked a fix that had nothing to do with that vendor.
 *
 * It does not need to. `fact_listing` already stores the title, product_type,
 * size_label and price of every listing, which is every input normalization
 * reads. So the index can be rebuilt from the warehouse using the SAME
 * functions the scrape path uses - parseSize, buildMatcher, resolveSpecies,
 * buildMarketIndex - and get the same answer for the same rows.
 *
 * This is the pattern build-marts.ts already uses for the catalog: re-derive
 * from the warehouse rather than trust what an older run wrote. Idempotent,
 * not a patch. A full `npm run refresh` reproduces it.
 *
 * WHAT IT CANNOT DO, and does not pretend to:
 *   - It cannot add a vendor. The warehouse holds the stores that were
 *     scraped, so the index it writes covers exactly those.
 *   - It cannot discover a species. dim_species is fixed here, so a listing
 *     whose binomial the catalog does not carry is counted and reported, then
 *     dropped rather than published as an entry no screen can render.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildMarketIndex } from './index-builder';
import { buildMatcher } from './normalize/species';
import { resolveSpecies } from './normalize/listing';
import { parseSize } from './normalize/size';
import { STORES, type MarketListing } from './types';
import { SPECIES_CATALOG } from '@/data/seed/species-catalog';

const WAREHOUSE = 'warehouse';
const APP_INDEX = 'src/data/seed/marts/market-index.json';
const CATALOG_MART = 'src/data/seed/marts/catalog.json';

async function main() {
  const fact = `${WAREHOUSE}/fact/fact_listing.parquet`;
  if (!existsSync(fact)) throw new Error(`${fact} not found - run "npm run warehouse" first.`);

  const catalog = JSON.parse(readFileSync(CATALOG_MART, 'utf8')) as { species: Array<{ speciesId: string }> };
  const known = new Set(catalog.species.map((s) => s.speciesId));

  const instance = await DuckDBInstance.create(':memory:');
  const c = await instance.connect();
  const rows = (await c.runAndReadAll(`
    SELECT s.store_id, s.name AS store_name, s.host, f.product_id, f.variant_id,
           f.title, f.url, f.product_type, f.price, f.compare_at_price, f.currency,
           f.size_label, f.available, d.date AS published_at
    FROM read_parquet('${fact}') f
    JOIN read_parquet('${WAREHOUSE}/dim/dim_store.parquet') s USING (store_key)
    LEFT JOIN read_parquet('${WAREHOUSE}/dim/dim_date.parquet') d
           ON d.date_key = f.published_date_key
  `)).getRowObjects();

  const match = buildMatcher(SPECIES_CATALOG.map((e) => e.species));
  const retrievedAt = new Date().toISOString();

  let unknownSpecies = 0;
  const perStore = new Map<string, number>();
  const listings: MarketListing[] = [];

  for (const r of rows) {
    const title = String(r.title ?? '');
    const productType = r.product_type == null ? undefined : String(r.product_type);
    const { speciesId, matchMethod } = resolveSpecies(match(title, productType));

    // dim_species is fixed here, so a species this run would newly discover has
    // no catalog card to render on. Counted and reported, never published as an
    // entry the app cannot show - that is the orphan bug, not a fix for it.
    if (speciesId && !known.has(speciesId)) {
      unknownSpecies += 1;
      continue;
    }

    const storeId = String(r.store_id);
    perStore.set(storeId, (perStore.get(storeId) ?? 0) + 1);
    const parsed = parseSize(r.size_label == null ? undefined : String(r.size_label));

    listings.push({
      storeId,
      productId: Number(r.product_id),
      variantId: Number(r.variant_id),
      handle: String(r.url ?? '').split('/products/')[1] ?? '',
      url: String(r.url ?? ''),
      title,
      productType,
      tags: [],
      speciesId,
      matchMethod,
      price: Number(r.price ?? 0),
      compareAtPrice: r.compare_at_price == null ? undefined : Number(r.compare_at_price),
      currency: String(r.currency ?? 'USD'),
      size: parsed.size,
      sizeLabel: parsed.label || undefined,
      available: Boolean(r.available),
      publishedAt: r.published_at == null ? undefined : String(r.published_at),
      retrievedAt,
    });
  }

  const sources = [...perStore].map(([storeId, listingsFetched]) => {
    const cfg = STORES.find((s) => s.id === storeId);
    if (!cfg) throw new Error(`warehouse has store "${storeId}" which STORES does not declare`);
    return { ...cfg, listingsFetched, retrievedAt };
  });

  /**
   * A vendor STORES declares but the warehouse has never held is a real gap in
   * this index, not a rounding error: every median and the market-scarcity
   * denominator are computed over the stores present. Stamped into the
   * artifact so the gap travels with the data.
   */
  const missing = STORES.filter((s) => !perStore.has(s.id))
    .map((s) => ({ storeId: s.id, reason: 'not in the warehouse - never scraped' }));

  const index = buildMarketIndex(listings, {
    sources,
    ...(missing.length ? { partial: missing } : {}),
  });

  const priced = Object.values(index.species).filter((s) => s.price).length;
  const total = Object.keys(index.species).length;
  console.log('─── reindex (from the warehouse, no network) ───');
  console.log(`  listings              ${listings.length}`);
  console.log(`  stores                ${sources.length} of ${STORES.length} declared`);
  console.log(`  matched to a species  ${listings.filter((l) => l.speciesId).length}`);
  console.log(`  with a real size      ${listings.filter((l) => l.size).length}`);
  console.log(`  species published     ${total}`);
  console.log(`    with a price        ${priced}`);
  console.log(`    references only     ${total - priced}  (listings shown, no estimate)`);
  console.log(`  dropped, not in the catalog  ${unknownSpecies}  (needs a full refresh to discover)`);

  // Verify the side effect rather than assume it: an index whose species do
  // not exist in the catalog renders nowhere, which is the exact bug the
  // synonym fold was written to kill.
  const orphans = Object.keys(index.species).filter((id) => !known.has(id));
  if (orphans.length > 0) {
    console.error(`\n  ✗ ${orphans.length} species are not in the catalog: ${orphans.slice(0, 5).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  writeFileSync(APP_INDEX, JSON.stringify(index, null, 2));
  console.log(`\n  ✓ no orphaned species`);
  console.log(`  wrote ${APP_INDEX}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

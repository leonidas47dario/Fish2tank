/**
 * Fetch a licensed portrait for every catalog species.
 *
 *   npm run images
 *
 * Writes data/market/images.jsonl, which build-warehouse.ts loads into
 * dim_image. Images without a stateable licence are dropped, not shipped.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  fetchSpeciesPortrait, searchCommonsPortrait, isPublishable, type SpeciesImage,
} from './sources/wikimedia';
import { fetchVendorPortrait } from './sources/vendor';
import { IMAGES_PATH, mergeRows, readRows, toRow, writeRows } from './images-jsonl';

const CATALOG = 'src/data/seed/marts/catalog.json';
const MARKET = 'src/data/seed/marts/market-index.json';

/**
 * How many species to attempt without a row, per run. Every one of them, by
 * default.
 */
const LIMIT = Number(process.env.PORTRAIT_LIMIT ?? Number.POSITIVE_INFINITY);

interface CatalogRow { speciesId: string; commonName: string; scientificName?: string }

/**
 * Species that still need a picture, most-listed first.
 *
 * Gap-fill, not rebuild. This used to re-fetch all 700 rows it already had on
 * every run, which made a re-run cost ten minutes of Wikimedia calls to change
 * nothing, and destroyed the committed file if it was interrupted. Now it
 * attempts only species with no row, so the step is idempotent and safe to run
 * after every catalog change.
 */
function targets(have: Set<string>): CatalogRow[] {
  if (!existsSync(CATALOG)) {
    throw new Error(`${CATALOG} not found - run "npm run marts" first.`);
  }
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as { species: CatalogRow[] };
  const market = existsSync(MARKET)
    ? (JSON.parse(readFileSync(MARKET, 'utf8')) as { species: Record<string, { totalListings: number }> })
    : { species: {} };

  return catalog.species
    .filter((s) => s.scientificName)
    .filter((s) => !have.has(s.speciesId))
    .sort((a, b) =>
      (market.species[b.speciesId]?.totalListings ?? 0) - (market.species[a.speciesId]?.totalListings ?? 0) ||
      a.commonName.localeCompare(b.commonName))
    .slice(0, LIMIT);
}

/** Product URLs on record for a species, in-stock listings first. */
function productUrls(speciesId: string): string[] {
  if (!existsSync(MARKET)) return [];
  const market = JSON.parse(readFileSync(MARKET, 'utf8')) as {
    species: Record<string, { stores?: { productUrl?: string; productInStock?: boolean }[] }>;
  };
  return (market.species[speciesId]?.stores ?? [])
    .filter((s) => s.productUrl)
    .sort((a, b) => Number(b.productInStock ?? false) - Number(a.productInStock ?? false))
    .map((s) => s.productUrl!);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Routes in preference order.
 *
 * Wikipedia first, then Commons search, then the shop. A stated free licence
 * beats borrowed art whenever both exist, so the order is the policy.
 */
async function resolve(species: CatalogRow): Promise<{ image: SpeciesImage; via: string } | undefined> {
  const article = await fetchSpeciesPortrait(species.speciesId, species.scientificName!);
  if (isPublishable(article)) return { image: article, via: 'article' };

  await sleep(200);
  const commons = await searchCommonsPortrait(species.speciesId, species.scientificName!);
  if (isPublishable(commons)) return { image: commons, via: 'commons' };

  for (const url of productUrls(species.speciesId)) {
    await sleep(200);
    const vendor = await fetchVendorPortrait(species.speciesId, url);
    if (isPublishable(vendor)) return { image: vendor, via: 'vendor' };
  }
  return undefined;
}

async function main() {
  const existing = readRows();
  const have = new Set(existing.map((r) => r.species_id));
  const wanted = targets(have);

  console.log(`  ${have.size} species already have an image row`);
  console.log(`  attempting ${wanted.length} without one\n`);

  const found: SpeciesImage[] = [];
  const byRoute: Record<string, number> = { article: 0, commons: 0, vendor: 0 };
  const missing: string[] = [];

  for (const species of wanted) {
    process.stdout.write(`  ${species.commonName.slice(0, 26).padEnd(26)}`);
    try {
      const hit = await resolve(species);
      if (hit) {
        found.push(hit.image);
        byRoute[hit.via] = (byRoute[hit.via] ?? 0) + 1;
        console.log(`ok  via ${hit.via}  ${hit.image.license ?? hit.image.provenance}`);
      } else {
        missing.push(species.commonName);
        console.log('no image on any route');
      }
    } catch (e) {
      missing.push(species.commonName);
      console.log(`failed (${e instanceof Error ? e.message : 'error'})`);
    }
    await sleep(300);
  }

  const merged = mergeRows(existing, found.map(toRow));
  writeRows(merged);

  console.log('\n─── images ───');
  console.log(`  attempted           ${wanted.length}`);
  console.log(`  resolved            ${found.length}  ${JSON.stringify(byRoute)}`);
  console.log(`  still uncovered     ${missing.length}`);
  console.log(`  rows in ${IMAGES_PATH}  ${merged.length}`);
  if (found.length === 0 && wanted.length > 0) {
    console.log('  WARNING: attempted species but resolved none - check network and API shapes.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

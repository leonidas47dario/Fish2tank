/**
 * Fetch a licensed portrait for every catalog species.
 *
 *   npm run images
 *
 * Writes data/market/images.jsonl, which build-warehouse.ts loads into
 * dim_image.
 *
 * Images we cannot ACCOUNT FOR are dropped, not shipped. That used to mean
 * "no stateable licence"; spec 002 changed it to "no URL a human can open to
 * see where this came from", because vendor listing photos have no licence and
 * are shipped deliberately with visible credit. See `isPublishable`.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  fetchSpeciesPortrait, searchCommonsPortrait, isPublishable, type SpeciesImage,
} from './sources/wikimedia';
import { fetchInaturalistPortrait } from './sources/inaturalist';
import { fetchVendorPortrait } from './sources/vendor';
import { IMAGES_PATH, isBundleable, isBundleableUrl, mergeRows, readRows, toRow, writeRows } from './images-jsonl';

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
 * attempts only species with no BUNDLEABLE row, so the step is idempotent and
 * safe to run after every catalog change. "Bundleable" rather than "any"
 * because a row the downscaler cannot decode is a gap wearing a hat.
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
 * Wikipedia, then Commons search, then iNaturalist, then the shop. A stated
 * free licence beats borrowed art whenever both exist, so the order is the
 * policy - and iNaturalist sits above the vendor route for exactly that reason
 * (spec 058: only cc0/cc-by/cc-by-sa are accepted from it), while sitting below
 * Commons because a Commons file is curated for the species and an observation
 * is a snapshot of one animal on one dive.
 */
async function resolve(species: CatalogRow): Promise<{ image: SpeciesImage; via: string } | undefined> {
  // Two conditions, and they are different questions. isPublishable asks
  // whether we can say where the picture came from; isBundleableUrl asks
  // whether the downscaler can actually decode it. A Commons .tif passes the
  // first and fails the second, and accepting it there is what turned the
  // retry of the five .tif species into a no-op loop.
  const usable = (i: SpeciesImage | undefined): i is SpeciesImage =>
    isPublishable(i) && isBundleableUrl(i.url);

  const article = await fetchSpeciesPortrait(species.speciesId, species.scientificName!);
  if (usable(article)) return { image: article, via: 'article' };

  await sleep(200);
  const commons = await searchCommonsPortrait(species.speciesId, species.scientificName!);
  if (usable(commons)) return { image: commons, via: 'commons' };

  await sleep(200);
  const inat = await fetchInaturalistPortrait(species.speciesId, species.scientificName!);
  if (usable(inat)) return { image: inat, via: 'inaturalist' };

  for (const url of productUrls(species.speciesId)) {
    await sleep(200);
    const vendor = await fetchVendorPortrait(species.speciesId, url);
    if (usable(vendor)) return { image: vendor, via: 'vendor' };
  }
  return undefined;
}

async function main() {
  const existing = readRows();
  // A row whose image the bundler cannot decode does NOT count as covered.
  // Otherwise the five .tif rows in the committed data hold their species
  // hostage forever: counted as done here, dropped at bundle time, never
  // retried by any other route. Treating them as gaps lets Commons search,
  // the vendor route, or the subagent stage replace them.
  const unbundleable = existing.filter((r) => !isBundleable(r));
  const have = new Set(existing.filter(isBundleable).map((r) => r.species_id));
  const wanted = targets(have);

  console.log(`  ${have.size} species already have a bundleable image row`);
  if (unbundleable.length > 0) {
    console.log(`  ${unbundleable.length} rows the bundler cannot decode, retrying those species:`);
    for (const r of unbundleable) console.log(`    ${r.species_id}  ${r.url.split('/').pop()}`);
  }
  console.log(`  attempting ${wanted.length} without one\n`);

  const found: SpeciesImage[] = [];
  const byRoute: Record<string, number> = { article: 0, commons: 0, inaturalist: 0, vendor: 0 };
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

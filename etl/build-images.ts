/**
 * Fetch a licensed portrait for every catalog species.
 *
 *   npm run images
 *
 * Writes data/market/images.jsonl, which build-warehouse.ts loads into
 * dim_image. Images without a stateable licence are dropped, not shipped.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fetchSpeciesPortrait, isPublishable, type SpeciesImage } from './sources/wikimedia';
import { surrogateKey } from './surrogate-key';

const OUT = 'data/market/images.jsonl';
const CATALOG = 'src/data/seed/marts/catalog.json';
const MARKET = 'src/data/seed/marts/market-index.json';

/**
 * How many species to fetch portraits for. Every one of them, by default.
 *
 * This was capped at 320 on an estimate of ~27MB for full coverage. That
 * estimate was wrong: measured, 695 bundled portraits come to 9.6MB - about
 * 14KB each after downscaling - against a 1GB GitHub Pages limit. The cap was
 * costing two thirds of the library its picture to save nothing.
 *
 * Species are still fetched most-listed first, so a run stopped early (or
 * capped via PORTRAIT_LIMIT for a quick pass) covers the fish you are most
 * likely to actually meet. Species with no usable image keep their silhouette.
 */
const LIMIT = Number(process.env.PORTRAIT_LIMIT ?? Number.POSITIVE_INFINITY);

interface CatalogRow { speciesId: string; commonName: string; scientificName?: string }

/** Species worth a picture, most-listed first. */
function targets(): CatalogRow[] {
  if (!existsSync(CATALOG)) {
    throw new Error(`${CATALOG} not found - run "npm run marts" first.`);
  }
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as { species: CatalogRow[] };
  const market = existsSync(MARKET)
    ? (JSON.parse(readFileSync(MARKET, 'utf8')) as { species: Record<string, { totalListings: number }> })
    : { species: {} };

  return catalog.species
    .filter((s) => s.scientificName)
    .sort((a, b) =>
      (market.species[b.speciesId]?.totalListings ?? 0) - (market.species[a.speciesId]?.totalListings ?? 0) ||
      a.commonName.localeCompare(b.commonName))
    .slice(0, LIMIT);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync('data/market', { recursive: true });

  const found: SpeciesImage[] = [];
  const missing: string[] = [];
  const unlicensed: string[] = [];

  const wanted = targets();
  console.log(`  fetching portraits for the ${wanted.length} most-listed species\n`);

  for (const species of wanted) {
    process.stdout.write(`  ${species.commonName.slice(0, 26).padEnd(26)}`);
    try {
      const image = await fetchSpeciesPortrait(species.speciesId, species.scientificName!);
      if (isPublishable(image)) {
        found.push(image);
        console.log(`ok  ${image.license}`);
      } else if (image) {
        unlicensed.push(species.commonName);
        console.log('dropped (no licence metadata)');
      } else {
        missing.push(species.commonName);
        console.log('no image');
      }
    } catch (e) {
      missing.push(species.commonName);
      console.log(`failed (${e instanceof Error ? e.message : 'error'})`);
    }
    // Wikimedia asks for politeness rather than enforcing a rate limit.
    await sleep(300);
  }

  const rows = found.map((i) => ({
    image_key: surrogateKey(i.url).toString(),
    species_id: i.speciesId,
    role: i.role,
    source: i.source,
    url: i.url,
    license: i.license ?? null,
    artist: i.artist ?? null,
    attribution_url: i.attributionUrl ?? null,
    width: i.width ?? null,
    height: i.height ?? null,
    retrieved_at: i.retrievedAt,
  }));
  writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  console.log('\n─── images ───');
  console.log(`  licensed portraits  ${found.length} / ${wanted.length} attempted`);
  console.log(`  no image found      ${missing.length}`);
  console.log(`  dropped, unlicensed ${unlicensed.length}`);
  const byLicense = found.reduce<Record<string, number>>((a, i) => {
    const k = i.license ?? '?';
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});
  console.log(`  licences            ${JSON.stringify(byLicense)}`);
  console.log(`\n  wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

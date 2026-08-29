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
import { surrogateKey } from './build-warehouse';

const OUT = 'data/market/images.jsonl';
const CATALOG = 'src/data/seed/marts/catalog.json';
const MARKET = 'src/data/seed/marts/market-index.json';

/**
 * How many species to fetch portraits for.
 *
 * The catalog holds ~1,080 species. Bundling a portrait for every one would be
 * roughly 27MB, which no phone should download to browse a fish library. So
 * the budget is spent on the species you would actually meet: ranked by how
 * many listings the vendors carry, which is a good proxy for how likely you
 * are to see one. The tail keeps its silhouette until it earns a picture.
 */
const LIMIT = Number(process.env.PORTRAIT_LIMIT ?? 320);

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

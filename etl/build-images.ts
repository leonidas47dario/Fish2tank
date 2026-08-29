/**
 * Fetch a licensed portrait for every catalog species.
 *
 *   npm run images
 *
 * Writes data/market/images.jsonl, which build-warehouse.ts loads into
 * dim_image. Images without a stateable licence are dropped, not shipped.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchSpeciesPortrait, isPublishable, type SpeciesImage } from './sources/wikimedia';
import { surrogateKey } from './build-warehouse';
import { SPECIES_CATALOG } from '@/data/seed/species-catalog';

const OUT = 'data/market/images.jsonl';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync('data/market', { recursive: true });

  const found: SpeciesImage[] = [];
  const missing: string[] = [];
  const unlicensed: string[] = [];

  for (const { species } of SPECIES_CATALOG) {
    if (!species.scientificName) {
      // Hybrids have no species article. Not a failure - there is genuinely
      // no taxonomic page for a flowerhorn.
      missing.push(`${species.commonName} (no scientific name)`);
      continue;
    }
    process.stdout.write(`  ${species.commonName.padEnd(26)}`);
    try {
      const image = await fetchSpeciesPortrait(species.id, species.scientificName);
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
  console.log(`  licensed portraits  ${found.length} / ${SPECIES_CATALOG.length}`);
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

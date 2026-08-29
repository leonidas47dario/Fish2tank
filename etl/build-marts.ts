/**
 * Warehouse → serving marts.
 *
 * This is the layer the app actually reads. It exists because the app must not
 * load Parquet: DuckDB-WASM is tens of megabytes and this is an offline-first
 * PWA on a phone. So the warehouse is queried once here, at build time, and
 * the result is a small JSON file the app can ship.
 *
 * It also makes the warehouse load-bearing rather than a side artifact. If
 * dim_species or dim_image is wrong, the catalog is wrong, and someone
 * notices.
 *
 * Convention: everything under src/data/seed/marts/ is GENERATED and should
 * never be hand-edited. Everything else under seed/ is source.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const WAREHOUSE = 'warehouse';
const OUT_DIR = 'src/data/seed/marts';

/** A species as the catalog screen needs it: profile plus its portrait. */
export interface CatalogEntry {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  aliases: string[];
  adultSizeIn?: number;
  minVolumeGal?: number;
  aggression?: string;
  tempMinC?: number;
  tempMaxC?: number;
  predationTags: string[];
  sourceLabel?: string;
  sourceUrl?: string;
  /**
   * Licensed portrait. Absent for the six species with no usable Commons
   * image, and for hybrids that have no species article at all - the card
   * renders a placeholder rather than pretending.
   */
  portrait?: {
    url: string;
    license: string;
    artist?: string;
    attributionUrl?: string;
    width?: number;
    height?: number;
  };
}

export interface CatalogMart {
  schemaVersion: 1;
  builtAt: string;
  species: CatalogEntry[];
}

const nn = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);
const num = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);
const split = (v: unknown): string[] =>
  !v ? [] : String(v).split('|').filter(Boolean);

async function main() {
  const factPath = `${WAREHOUSE}/dim/dim_species.parquet`;
  if (!existsSync(factPath)) {
    throw new Error(`${factPath} not found - run "npm run warehouse" first.`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const instance = await DuckDBInstance.create(':memory:');
  const c = await instance.connect();

  // One portrait per species. Where a species somehow has several, the widest
  // wins - a catalog card is a large image and upscaling looks worse than
  // anything else on the screen.
  const rows = await c.runAndReadAll(`
    WITH best_image AS (
      SELECT species_id, url, license, artist, attribution_url, width, height,
             row_number() OVER (PARTITION BY species_id ORDER BY width DESC NULLS LAST) AS rn
      FROM read_parquet('${WAREHOUSE}/dim/dim_image.parquet')
      WHERE role = 'portrait' AND license IS NOT NULL
    )
    SELECT s.species_id, s.common_name, s.scientific_name, s.aliases,
           s.adult_size_in, s.min_volume_gal, s.aggression,
           s.temp_min_c, s.temp_max_c, s.predation_tags,
           s.source_label, s.source_url,
           i.url AS img_url, i.license AS img_license, i.artist AS img_artist,
           i.attribution_url AS img_attribution, i.width AS img_width, i.height AS img_height
    FROM read_parquet('${WAREHOUSE}/dim/dim_species.parquet') s
    LEFT JOIN best_image i ON i.species_id = s.species_id AND i.rn = 1
    WHERE s.is_current
    ORDER BY s.common_name
  `);

  const species: CatalogEntry[] = rows.getRowObjects().map((r) => {
    const url = nn(r.img_url);
    const license = nn(r.img_license);
    return {
      speciesId: String(r.species_id),
      commonName: String(r.common_name),
      scientificName: nn(r.scientific_name),
      aliases: split(r.aliases),
      adultSizeIn: num(r.adult_size_in),
      minVolumeGal: num(r.min_volume_gal),
      aggression: nn(r.aggression),
      tempMinC: num(r.temp_min_c),
      tempMaxC: num(r.temp_max_c),
      predationTags: split(r.predation_tags),
      sourceLabel: nn(r.source_label),
      sourceUrl: nn(r.source_url),
      // Only ship an image we can attribute; the licence check is in the SQL
      // above, and this is the belt to its braces.
      ...(url && license
        ? {
            portrait: {
              url,
              license,
              artist: nn(r.img_artist),
              attributionUrl: nn(r.img_attribution),
              width: num(r.img_width),
              height: num(r.img_height),
            },
          }
        : {}),
    };
  });

  const mart: CatalogMart = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    species,
  };
  writeFileSync(`${OUT_DIR}/catalog.json`, JSON.stringify(mart, null, 2));

  const withArt = species.filter((s) => s.portrait).length;
  console.log('─── marts ───');
  console.log(`  species          ${species.length}`);
  console.log(`  with a portrait  ${withArt}  (${Math.round((withArt / species.length) * 100)}%)`);
  console.log(`  without          ${species.length - withArt}`);
  console.log(`\n  wrote ${OUT_DIR}/catalog.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

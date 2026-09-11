/**
 * Warehouse pieces that other steps need to run on their own.
 *
 * A SEPARATE MODULE FOR A SPECIFIC REASON. `build-warehouse.ts` calls `main()`
 * at import time, so importing anything from it starts a full warehouse build -
 * `images-jsonl.ts` already carries the warning ("that module calls main() at
 * import time, which is the bug an earlier task fixed. Do not reintroduce it")
 * and rebuilding dim_image alone reintroduced it for about ten minutes.
 *
 * So the shared SQL lives here, where importing it does nothing but define it.
 */
import { DuckDBConnection } from '@duckdb/node-api';
import { existsSync, readFileSync } from 'node:fs';

const WAREHOUSE = 'warehouse';
const IMAGES = 'data/market/images.jsonl';

export async function writeTable(c: DuckDBConnection, name: string, folder: 'dim' | 'fact') {
  const path = `${WAREHOUSE}/${folder}/${name}.parquet`;
  // ZSTD: better ratio than snappy, and universally readable.
  await c.run(`COPY ${name} TO '${path}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  return path;
}

/**
 * `dim_image`, from `images.jsonl`.
 *
 * EXTRACTED SO IT CAN BE REBUILT ALONE - `rebuild-dim-image.ts`. The full
 * warehouse build needs `data/market/listings.jsonl`, which is gitignored
 * because it is 10 MB and rebuilds from the warehouse itself; so after a
 * portrait run, refreshing this one dimension used to mean re-running a whole
 * vendor scrape. That is why 1,015 portraits sat on disk with no mart row and
 * drew nothing (spec 065).
 *
 * Shared rather than copied: two definitions of one table is how the copy ends
 * up subtly different from the original and nobody notices until a column is
 * missing from a mart.
 */
export async function buildDimImage(c: DuckDBConnection): Promise<void> {
  // Created even when empty: the schema must be complete so queries against
  // dim_image do not fail before the image ETL has ever run.
  await c.run(`CREATE TABLE dim_image (
    image_key BIGINT, species_id VARCHAR, role VARCHAR, source VARCHAR,
    provenance VARCHAR, url VARCHAR,
    license VARCHAR, artist VARCHAR, attribution_url VARCHAR,
    width INTEGER, height INTEGER, retrieved_at TIMESTAMP)`);

  if (existsSync(IMAGES) && readFileSync(IMAGES, 'utf8').trim()) {
    await c.run(`INSERT INTO dim_image SELECT
      CAST(image_key AS BIGINT), species_id, role, source,
      coalesce(provenance, 'wikimedia'), url, license, artist,
      attribution_url, CAST(width AS INTEGER), CAST(height AS INTEGER),
      CAST(retrieved_at AS TIMESTAMP)
      FROM read_json_auto('${IMAGES}', format='newline_delimited')`);
  }
}


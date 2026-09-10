/**
 * Refresh `dim_image` alone, then leave the rest of the warehouse untouched.
 *
 *   npm run reimage
 *
 * WHY THIS EXISTS, and it is a real gap rather than a convenience. A portrait
 * run changes `data/market/images.jsonl` and nothing else, but the app reads
 * portraits from the MART, which is built from the warehouse - and a full
 * warehouse build refuses to start without `data/market/listings.jsonl`, which
 * is gitignored because it is 10 MB and rebuilds from the warehouse itself.
 *
 * So the only documented route from "new portraits on disk" to "portraits the
 * app draws" ran through a vendor scrape that has nothing to do with portraits.
 * It did not get run, and 1,015 downloaded portraits sat in the build drawing
 * nothing, because `chooseArt` needs a mart row as well as a file. Spec 065.
 *
 * The SQL is `buildDimImage`, imported rather than copied: two definitions of
 * one table is how a rebuilt dimension quietly ends up a column short. It lives
 * in `warehouse-dims.ts` rather than in build-warehouse.ts, because that module
 * runs `main()` at import time - importing from it here started a full
 * warehouse build as a side effect of asking for one function.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync } from 'node:fs';
import { buildDimImage, writeTable } from './warehouse-dims';

const WAREHOUSE = 'warehouse';

async function main() {
  if (!existsSync(`${WAREHOUSE}/dim`)) {
    throw new Error(`${WAREHOUSE}/dim not found - run "npm run warehouse" first.`);
  }

  const instance = await DuckDBInstance.create(':memory:');
  const c = await instance.connect();

  await buildDimImage(c);
  const path = await writeTable(c, 'dim_image', 'dim');

  const result = await c.run('SELECT count(*) AS n FROM dim_image');
  const n = (await result.getRows())[0]?.[0] ?? 0;
  console.log(`  dim_image  ${n} rows -> ${path}`);
  console.log('\n  Now run "npm run marts" so the app can see them.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

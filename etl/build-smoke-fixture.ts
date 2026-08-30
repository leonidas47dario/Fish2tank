/**
 * Builds the archive the smoke test restores before it runs.
 *
 *   npm run fixture:smoke
 *
 * WHY THIS EXISTS. The app used to seed Ryan's six tanks, his 61-row inventory,
 * his local fish store and his Oscar into every database on first run. That was
 * a demo convenience that became three separate problems: it is redundant now
 * that exports exist, it is what made a restore land *beside* a re-seed instead
 * of on top of it (spec 006), and the moment a second keeper opens the app it
 * hands them somebody else's collection.
 *
 * So the app seeds only the species catalog, which is reference data, and the
 * sample collection lives here instead. The smoke test imports it through the
 * real import code, which means every CI run also proves backup and restore
 * still work.
 *
 * Records only, deliberately. The smoke test creates its own Panther through
 * the catch flow, so a seeded specimen would collide with it, and the media
 * round trip is already covered byte-for-byte by the unit tests.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { STARTER_PLACE, STARTER_TANKS } from '../src/data/seed/starter-collection';
import { importInventory, parseInventoryCsv } from '../src/data/seed/inventory-import';
import {
  ARCHIVE_VERSION,
  EXPORTED_TABLES,
  MANIFEST_PATH,
  RECORDS_PATH,
  type ArchiveManifest,
  type RecordBundle,
} from '../src/data/portability/manifest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(root, 'src/data/seed/fixtures/smoke-collection.zip');

const csv = readFileSync(join(root, 'src/data/seed/fish_inventory.csv'), 'utf8');
const imported = importInventory(parseInventoryCsv(csv), []);

/*
 * The same merge applyInventoryImport does: a CSV tank label matching a starter
 * tank by name joins that tank rather than creating a second one. The starter
 * 75G carries real measurements the sheet does not have, and losing them would
 * make compatibility screening return "Not enough data" for the one tank the
 * smoke test actually screens against.
 */
const byName = new Map(STARTER_TANKS.map((t) => [t.name.trim().toLowerCase(), t]));
const aquariums = [...STARTER_TANKS];

for (const aquarium of imported.aquariums) {
  const match = byName.get(aquarium.name.trim().toLowerCase());
  if (match) {
    for (const r of imported.residencies) {
      if (r.aquariumId === aquarium.id) r.aquariumId = match.id;
    }
  } else {
    aquariums.push(aquarium);
  }
}

const records: RecordBundle = Object.fromEntries(EXPORTED_TABLES.map((t) => [t, []]));
records.places = [STARTER_PLACE];
records.aquariums = aquariums;
records.holdings = imported.holdings;
records.residencies = imported.residencies;

const manifest: ArchiveManifest = {
  version: ARCHIVE_VERSION,
  exportedAt: new Date().toISOString(),
  appBuild: 'smoke-fixture',
  tables: Object.fromEntries(Object.entries(records).map(([t, rows]) => [t, rows.length])),
  media: { count: 0, bytes: 0 },
};

const zip = zipSync({
  [MANIFEST_PATH]: strToU8(JSON.stringify(manifest, null, 2)),
  [RECORDS_PATH]: strToU8(JSON.stringify(records)),
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, zip);

console.info(
  `[fixture] wrote ${OUT} (${zip.byteLength}B): ` +
    `${aquariums.length} tanks, ${imported.holdings.length} holdings, ` +
    `${imported.residencies.length} residencies`,
);

// A fixture that silently came out empty would make the smoke test pass
// against nothing, which is the failure mode this whole change exists to
// avoid. Fail loudly instead.
if (imported.holdings.length === 0 || aquariums.length === 0) {
  throw new Error('[fixture] refusing to write an empty sample collection');
}

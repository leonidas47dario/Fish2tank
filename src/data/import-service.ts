/**
 * Applying an inventory import to the store.
 *
 * Shared by first-run seeding and the Settings import screen so both merge
 * enclosures the same way: an imported label that matches an existing tank by
 * name adds holdings to that tank rather than creating a duplicate, which
 * matters because the seeded 75G carries real measurements the source sheet
 * does not have.
 */
import { db, type Fish2TankDB } from './db';
import { importInventory, parseInventoryCsv, type ImportResult, type InventoryRow } from './seed/inventory-import';
import { parseInventoryXlsx } from './seed/xlsx';

export async function applyInventoryImport(
  rows: InventoryRow[],
  database: Fish2TankDB = db,
): Promise<ImportResult> {
  const catalog = await database.species.toArray();
  const imported = importInventory(rows, catalog);

  await database.transaction('rw', [database.aquariums, database.holdings, database.residencies], async () => {
    const existing = await database.aquariums.toArray();
    const byName = new Map(existing.map((a) => [a.name.trim().toLowerCase(), a]));

    for (const aquarium of imported.aquariums) {
      const match = byName.get(aquarium.name.trim().toLowerCase());
      if (match) {
        // Re-point this import's residencies at the tank that already exists,
        // keeping its measurements and stocking state intact.
        for (const r of imported.residencies) {
          if (r.aquariumId === aquarium.id) r.aquariumId = match.id;
        }
      } else {
        await database.aquariums.add(aquarium);
      }
    }

    await database.holdings.bulkAdd(imported.holdings);
    await database.residencies.bulkAdd(imported.residencies);
  });

  return imported;
}

/** Accepts either format the user actually has: the .xlsx, or a CSV export. */
export async function importInventoryFile(file: File, database: Fish2TankDB = db): Promise<ImportResult> {
  const isXlsx = /\.xlsx$/i.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const rows = isXlsx
    ? await parseInventoryXlsx(await file.arrayBuffer())
    : parseInventoryCsv(await file.text());
  if (rows.length === 0) throw new Error('No inventory rows found in that file.');
  return applyInventoryImport(rows, database);
}

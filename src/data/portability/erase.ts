/**
 * Erasing the whole profile, so a keeper can start again from a backup.
 *
 * THIS DELETES ROWS. It does not delete the database. The distinction is the
 * whole feature: spec 005 FR-A01 keeps `holdings`, `residencies`, `specimens`
 * and the rest in sync, so dropping the IndexedDB database would empty this
 * device and then re-download every record from the cloud on the next login,
 * looking exactly like a wipe that silently did nothing. Deleting rows while
 * signed in produces real deletions that propagate, which is what "clean my
 * entire profile" has to mean once an account exists.
 *
 * THE CATALOG IS NOT PERSONAL DATA and stays. It is reference data every
 * keeper needs, it regenerates from `npm run marts`, and re-seeding 2,176
 * species after every erase would be slow and pointless. The exception is a
 * species the keeper typed in themselves (`origin: 'user-submitted'`), which
 * is their data and goes with the rest, profile included - leaving it behind
 * would keep a private label in a shared-looking table.
 *
 * It reports per-table counts and verifies emptiness afterwards rather than
 * trusting the deletes, because an erase that reports success while leaving
 * records behind is the DW_SYNC failure in a costlier place: the keeper has
 * already been told it is safe to restore over the top.
 */
import { db, type Fish2TankDB } from '../db';
import type { Species } from '@/domain/types';

/**
 * Every table cleared outright.
 *
 * This is the export's table list minus `species`/`speciesProfiles`, which are
 * filtered rather than cleared, plus the three local-only tables an export
 * deliberately omits: `blobs` holds the photo bytes, `draftKeys` is per-device
 * retry bookkeeping, and `deletedRecords` is tombstones that mean nothing once
 * there is nothing left to resurrect.
 */
export const ERASED_TABLES = [
  'users',
  'places',
  'specimens',
  'encounters',
  'media',
  'identifications',
  'priceObservations',
  'raritySnapshots',
  'dreamList',
  'aquariums',
  'holdings',
  'residencies',
  'lifeEvents',
  'assessments',
  'memorials',
  'keeperPrinciples',
  'holdingMeasurements',   // spec 037
  'keeperNotes',           // spec 046
  'cardPrefs',
  'blobs',
  'draftKeys',
  'deletedRecords',
  // BUG-11, spec 028. Added ONLY because the erase flow now revokes first:
  // clearing this table while a page is live destroys the token that is the
  // only way to take it down. `eraseEverything` must never be called with
  // published tanks outstanding - see `revokeEveryShare`.
  'shares',
] as const;

export interface EraseResult {
  /** Rows removed, per table. Only non-empty tables appear. */
  cleared: Record<string, number>;
  /** Keeper-submitted species rows removed from the catalog table. */
  userSpeciesRemoved: number;
  total: number;
}

export async function eraseEverything(database: Fish2TankDB = db): Promise<EraseResult> {
  const cleared: Record<string, number> = {};
  let total = 0;

  console.info('[erase] starting', { tables: ERASED_TABLES.length });

  for (const name of ERASED_TABLES) {
    const table = database.tables.find((t) => t.name === name);
    if (!table) {
      // A table named here but missing from the schema is a wiring mistake,
      // not a benign no-op: it means something personal is being left behind.
      console.error('[erase] table named for erasure is not in the schema', { table: name });
      throw new Error(`Cannot erase unknown table "${name}"`);
    }
    const before = await table.count();
    if (before === 0) continue;

    await table.clear();
    const after = await table.count();
    if (after !== 0) {
      console.error('[erase] table did not empty', { table: name, before, after });
      throw new Error(`Erase failed: ${name} still holds ${after} rows`);
    }
    cleared[name] = before;
    total += before;
    console.info('[erase] cleared', { table: name, rows: before });
  }

  // The keeper's own species, and any profile hanging off one.
  const species = (await database.species.toArray()) as Species[];
  const mine = species.filter((s) => s.origin === 'user-submitted').map((s) => s.id);
  let userSpeciesRemoved = 0;
  if (mine.length > 0) {
    const mineSet = new Set(mine);
    const profiles = await database.speciesProfiles.toArray();
    const doomedProfiles = profiles.filter((p) => mineSet.has(p.speciesId)).map((p) => p.id);

    await database.speciesProfiles.bulkDelete(doomedProfiles);
    await database.species.bulkDelete(mine);

    const left = await database.species.where('id').anyOf(mine).count();
    if (left !== 0) {
      console.error('[erase] keeper-submitted species survived', { left });
      throw new Error(`Erase failed: ${left} keeper-submitted species remain`);
    }
    userSpeciesRemoved = mine.length;
    total += mine.length;
    console.info('[erase] cleared keeper-submitted species', {
      species: mine.length, profiles: doomedProfiles.length,
    });
  }

  console.info('[erase] done, verified empty', { total, cleared, userSpeciesRemoved });
  return { cleared, userSpeciesRemoved, total };
}

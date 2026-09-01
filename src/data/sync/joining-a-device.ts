/**
 * What happens when a device joins an account that already has records.
 *
 * Spec 020, BUG-08. Dexie Cloud's first sync after a login is unconditionally
 * local-wins: `listSyncifiedChanges()` sends every row of every not-yet-synced
 * table as one whole-object `upsert`, and the server's own version of those
 * keys is then filtered out of what comes back. For a device carrying the only
 * copy that is exactly right. For a second device carrying a stale copy it is
 * a silent overwrite of the newer records, and because six tanks, the seeded
 * store and the profile all use hardcoded primary keys, the collision is not
 * hypothetical - every device that ever ran the old `bootstrap()` holds the
 * same `tank_75g`.
 *
 * This module is what the gate needs to offer a choice instead: a count of
 * what would be pushed, and a way to drop it that the cloud never hears about.
 *
 * NOTHING HERE DELETES A CLOUD RECORD, and that distinction is the whole file.
 * `portability/erase.ts` deletes rows *while signed in* so the deletions
 * propagate, which is what "erase my profile" has to mean. This does the
 * opposite: it removes local rows with change tracking switched off, so the
 * account is untouched and the next pull puts the real records back.
 */
import type { Transaction } from 'dexie';
import { db, type Fish2TankDB } from '../db';

/** The shape of `db.cloud.schema`, narrowed to the one field that matters. */
export type SyncSchema = Record<string, { markedForSync?: boolean }>;

export interface PendingClaim {
  /** Rows per table. Only non-empty tables appear. */
  byTable: Record<string, number>;
  total: number;
  /** The tables counted, empty or not. */
  tables: string[];
}

export interface DiscardResult {
  cleared: Record<string, number>;
  total: number;
  /** Proof the clear was invisible to sync, read back rather than assumed. */
  changeTrackingSilenced: boolean;
}

/**
 * The tables this device would push up on its next sync.
 *
 * A mirror of the addon's own `getTablesToSyncify()`: everything the cloud
 * schema marks for sync, minus whatever the persisted sync state already lists
 * as synced. Written against the addon's public API (`db.cloud.schema`,
 * `db.cloud.persistedSyncState`) rather than a hardcoded list, so it cannot
 * drift from `unsyncedTables` in `db.ts`.
 *
 * Empty when there is no schema, which is every non-browser build. A test run
 * or an SSR build must not be told it has records to reconcile.
 */
export function tablesThatWouldSyncUp(
  schema: SyncSchema | null | undefined,
  syncedTables: readonly string[] | undefined,
): string[] {
  const already = new Set(syncedTables ?? []);
  return Object.entries(schema ?? {})
    .filter(([name, table]) => table?.markedForSync && !already.has(name))
    .map(([name]) => name);
}

/** The same question, asked of the live database. Browser only. */
export function tablesThisDeviceWouldPush(database: Fish2TankDB = db): string[] {
  const cloud = (database as Fish2TankDB & { cloud?: {
    schema?: SyncSchema | null;
    persistedSyncState?: { value?: { syncedTables?: string[] } };
  } }).cloud;
  if (!cloud) return [];
  return tablesThatWouldSyncUp(cloud.schema, cloud.persistedSyncState?.value?.syncedTables);
}

/** How many local rows are sitting in those tables, waiting to be claimed. */
export async function countPendingClaim(
  database: Fish2TankDB,
  tables: string[],
): Promise<PendingClaim> {
  const byTable: Record<string, number> = {};
  let total = 0;
  for (const name of tables) {
    const rows = await tableOrThrow(database, name).count();
    if (rows === 0) continue;
    byTable[name] = rows;
    total += rows;
  }
  return { byTable, total, tables };
}

/**
 * Drop this device's copy so the first sync is a pure pull.
 *
 * Three things this has to get right, each of which has a worse failure than
 * the bug it is fixing:
 *
 *  1. **Only the tables it was handed.** They come from the cloud schema, so
 *     `blobs` is never among them. Photo originals live there and nowhere else
 *     until media sync has run (NFR-03).
 *  2. **Change tracking off.** A plain `clear()` records a delete mutation per
 *     row, and `listClientChanges()` replays every recorded mutation at the
 *     next sync without caring which user recorded it. Clearing loudly would
 *     not avoid the overwrite, it would upgrade it to deleting the account.
 *  3. **Verified empty, or thrown.** A partial clear leaves a subset of stale
 *     rows to be claimed - the same bug, smaller, with a success message on it.
 */
export async function discardLocalRecords(
  database: Fish2TankDB,
  tables: string[],
): Promise<DiscardResult> {
  // Named before the transaction opens: Dexie's own error for an unknown table
  // arrives from inside the transaction and does not say why we asked for it.
  const targets = tables.map((name) => tableOrThrow(database, name));

  const before = await countPendingClaim(database, tables);
  console.info('[join] discarding this device\'s copy', {
    tables: tables.length, rows: before.total, byTable: before.byTable,
  });

  let silenced = false;
  await database.transaction('rw', targets, async (tx) => {
    silenced = silenceChangeTracking(tx);
    for (const table of targets) await table.clear();
  });

  // Green must mean verified. Count again rather than trusting the clears.
  const after = await countPendingClaim(database, tables);
  if (after.total !== 0) {
    console.error('[join] discard left rows behind', { survived: after.byTable });
    throw new Error(
      `Discard incomplete: ${Object.entries(after.byTable)
        .map(([t, n]) => `${t}=${n}`).join(', ')}`,
    );
  }

  console.info('[join] discarded, verified empty', {
    rows: before.total, changeTrackingSilenced: silenced,
  });
  return { cleared: before.byTable, total: before.total, changeTrackingSilenced: silenced };
}

/**
 * Tell the addon's middleware to skip this transaction.
 *
 * The same flag `dexie-cloud-addon` sets in its own `_logout()`. It lives on
 * the IndexedDB transaction rather than the Dexie one because that is the
 * object both the id-policy and the mutation-recording middlewares see.
 *
 * Written and then read back. If this silently failed, the clear below would
 * queue a delete for every record in the account.
 */
function silenceChangeTracking(tx: Transaction): boolean {
  const idbtrans = (tx as unknown as { idbtrans?: Record<string, unknown> }).idbtrans;
  if (!idbtrans) {
    throw new Error('Cannot silence change tracking: the transaction has no idbtrans');
  }
  idbtrans.disableChangeTracking = true;
  if (idbtrans.disableChangeTracking !== true) {
    throw new Error('Change tracking would not switch off; refusing to clear');
  }
  return true;
}

function tableOrThrow(database: Fish2TankDB, name: string) {
  const table = database.tables.find((t) => t.name === name);
  if (!table) {
    // Not a skippable no-op: a table the cloud schema marks for sync but this
    // schema does not have is a wiring mistake, and quietly ignoring it leaves
    // rows behind to be claimed.
    throw new Error(`Cannot discard unknown table "${name}"`);
  }
  return table;
}

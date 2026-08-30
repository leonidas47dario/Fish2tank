/**
 * Spec 005 / plan 005b task 1: the first-login row census.
 *
 * The spec calls this "the single largest risk": whether Dexie Cloud claims
 * rows created while logged out into the user's private realm on first login,
 * or duplicates them, or loses them. Plan 005b refuses to write the rest of
 * the sync tasks until it is answered with numbers rather than documentation.
 *
 * So this page answers it with numbers. It loads a copy of Ryan's real
 * database (138 rows, the 61-row inventory and the Panther) into a throwaway
 * IndexedDB, counts every table, logs in, waits for sync to settle, and counts
 * again. Nothing here is app code and nothing here ships.
 *
 * Runs against the SCRATCH cloud database only. See memory note
 * cloud-sync-infrastructure for which is which.
 */
import dexieCloud from 'dexie-cloud-addon';
import { Fish2TankDB } from '@/data/db';

/** Scratch. Never uat, never production. */
const DATABASE_URL = 'https://z84eopr5r.dexie.cloud';

/**
 * FR-A01's data boundary. `species`/`speciesProfiles` ship in the bundle and
 * regenerate from marts; `blobs` is the megabytes and belongs in R2;
 * `draftKeys` deduplicates retries on one device and would resurface another
 * device's abandoned draft. `deletedRecords` is local tombstone bookkeeping.
 */
const UNSYNCED_TABLES = [
  'blobs',
  'draftKeys',
  'species',
  'speciesProfiles',
  'deletedRecords',
];

/** The tables the census counts, in the order the export manifest lists them. */
const CENSUS_TABLES = [
  'users', 'places', 'species', 'speciesProfiles', 'specimens', 'encounters',
  'media', 'identifications', 'priceObservations', 'raritySnapshots',
  'dreamList', 'aquariums', 'holdings', 'residencies', 'lifeEvents',
  'assessments', 'memorials', 'keeperPrinciples', 'cardPrefs',
];

const logEl = document.getElementById('log')!;

function say(msg: string, cls = ''): void {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.append(line);
  console.log(msg);
}

/** Count every census table. Missing table counts as absent, not as zero. */
async function census(db: Fish2TankDB): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of CENSUS_TABLES) {
    const table = db.tables.find((t) => t.name === name);
    if (!table) continue;
    out[name] = await table.count();
  }
  return out;
}

function total(c: Record<string, number>): number {
  return Object.values(c).reduce((a, b) => a + b, 0);
}

/**
 * Print before/after side by side. A table only appears if it is non-zero on
 * one side or the other, so the interesting rows are not buried in eighteen
 * zeroes.
 */
function diff(before: Record<string, number>, after: Record<string, number>): void {
  say('');
  say('table                      before   after   delta');
  say('-------------------------------------------------');
  let broken = false;
  for (const name of CENSUS_TABLES) {
    const b = before[name] ?? 0;
    const a = after[name] ?? 0;
    if (b === 0 && a === 0) continue;
    const d = a - b;
    const mark = d === 0 ? '' : d > 0 ? `  +${d}` : `  ${d}`;
    if (d !== 0) broken = true;
    say(
      `${name.padEnd(24)} ${String(b).padStart(6)}  ${String(a).padStart(6)}${mark}`,
      d === 0 ? '' : 'bad',
    );
  }
  say('-------------------------------------------------');
  say(`${'TOTAL'.padEnd(24)} ${String(total(before)).padStart(6)}  ${String(total(after)).padStart(6)}`);
  say('');
  say(
    broken
      ? 'VERDICT: row counts changed across login. Read the deltas above.'
      : 'VERDICT: every row survived login at the same count. No duplication, no loss.',
    broken ? 'bad' : 'ok',
  );
}

/** Load the exported records. Blobs are excluded from sync, so records only. */
async function loadFixture(db: Fish2TankDB): Promise<void> {
  const records: Record<string, unknown[]> = await (
    await fetch('./records.json')
  ).json();

  let loaded = 0;
  for (const [name, rows] of Object.entries(records)) {
    if (!rows?.length) continue;
    const table = db.tables.find((t) => t.name === name);
    if (!table) {
      say(`  ! no such table, skipped: ${name} (${rows.length} rows)`, 'bad');
      continue;
    }
    await table.bulkPut(rows as never[]);
    loaded += rows.length;
  }
  say(`loaded ${loaded} rows from the export`, 'ok');
}

/** Wait for sync to go quiet, or give up loudly rather than silently. */
async function settle(db: Fish2TankDB, ms = 25000): Promise<void> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < ms) {
    const state = db.cloud.syncState?.value;
    const phase = state?.phase ?? 'unknown';
    if (phase !== last) {
      say(`  sync phase: ${phase}${state?.error ? ` (${state.error})` : ''}`, 'dim');
      last = phase;
    }
    if (phase === 'in-sync' && Date.now() - started > 3000) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  say(`  sync did not reach in-sync within ${ms}ms; counting anyway`, 'bad');
}

async function main(): Promise<void> {
  // A fresh IndexedDB per run, so a previous attempt cannot flatter this one.
  const localName = `probe-${Date.now()}`;
  say(`local IndexedDB : ${localName}`);
  say(`cloud database  : ${DATABASE_URL}  (scratch)`);
  say(`unsynced tables : ${UNSYNCED_TABLES.join(', ')}`);
  say('');

  const db = new Fish2TankDB(localName, [dexieCloud]);
  db.cloud.configure({
    databaseUrl: DATABASE_URL,
    requireAuth: false,
    unsyncedTables: UNSYNCED_TABLES,
    nameSuffix: false, // the name is already unique per run
  });
  await db.open();
  say('database open, logged out', 'ok');

  await loadFixture(db);

  const before = await census(db);
  say('');
  say(`BEFORE LOGIN: ${total(before)} rows across ${Object.keys(before).length} tables`, 'ok');
  for (const [k, v] of Object.entries(before)) if (v) say(`  ${k.padEnd(22)} ${v}`);

  // Expose for the login buttons and for driving from the console.
  Object.assign(window as never, {
    db,
    before,
    async after() {
      const user = db.cloud.currentUser?.value;
      say('');
      say(`userId    : ${user?.userId ?? '(none)'}`);
      say(`email     : ${user?.email ?? '(none)'}`);
      say(`isLoggedIn: ${user?.isLoggedIn}`);
      say(`license   : ${user?.license?.type ?? '(none)'} / ${user?.license?.status ?? '-'}`);
      say(
        `userId shape: ${
          user?.userId?.includes('@') ? 'EMAIL ADDRESS (not opaque)' : 'opaque or absent'
        }`,
        user?.userId?.includes('@') ? 'bad' : 'ok',
      );
      await settle(db);
      diff(before, await census(db));
    },
  });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    say('');
    say(`--- ${label} ---`);
    try {
      await fn();
      say('login resolved', 'ok');
    } catch (cause) {
      // Never swallow it. A failed login here is the finding, not an aside.
      say(`login FAILED: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`, 'bad');
      console.error(cause);
      return;
    }
    await (window as never as { after(): Promise<void> }).after();
  };

  document.getElementById('demo')!.addEventListener('click', () =>
    run('demo user', () => db.cloud.login({ grant_type: 'demo' })),
  );
  document.getElementById('otp')!.addEventListener('click', () =>
    run('email OTP', () => db.cloud.login({ grant_type: 'otp' })),
  );
  document.getElementById('google')!.addEventListener('click', () =>
    run('Google', () => db.cloud.login({ provider: 'google' })),
  );
  document.getElementById('census')!.addEventListener('click', () =>
    (window as never as { after(): Promise<void> }).after(),
  );
}

main().catch((cause) => {
  say(`FATAL: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`, 'bad');
  console.error(cause);
});

/**
 * One-off repair: delete the holdings three pre-`ea7accc` seed runs duplicated.
 *
 * WHY THIS IS A CLI AND NOT A BUTTON. The damage is already in the cloud
 * database, and it predates the fix that stopped it (`ea7accc`, 2026-08-29:
 * importInventory minted a fresh UUID per row on every run). Nothing in the
 * app can create it again, so shipping a permanent "deduplicate" control would
 * be a button for a bug that no longer happens. It runs against the Dexie
 * Cloud REST API rather than a browser, so it needs no login and no device.
 *
 * IT SHARES THE PLANNER WITH THE APP. `planDedupe` lives in
 * `src/domain/dedupe.ts` and is unit tested there. This file only fetches,
 * checks, deletes and verifies; it decides nothing about which row survives.
 *
 * SAFETY. Dry run is the default. `--apply` writes a full pre-image of every
 * record it is about to delete before deleting anything, refuses outright if
 * a deletion candidate carries a catch link or life events, and re-reads the
 * database afterwards to prove the row counts actually changed. A run that
 * cannot verify itself exits non-zero.
 *
 *   npm run repair:holdings -- --db https://zecprrllc.dexie.cloud
 *   npm run repair:holdings -- --db https://zecprrllc.dexie.cloud --apply
 *
 * Idempotent: a second run finds nothing to do and says so.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planDedupe } from '../src/domain/dedupe';
import type { Holding, LifeEvent, Residency } from '../src/domain/types';

const DEFAULT_KEY_FILE = resolve(import.meta.dirname, '..', 'dexie-cloud.key');

interface Credentials { clientId: string; clientSecret: string }

/**
 * `dexie-cloud.key` is gitignored, so it sits in whichever checkout ran
 * `npx dexie-cloud connect` - not necessarily this one. `--key` points at it.
 */
function credentialsFor(databaseUrl: string, keyFile: string): Credentials {
  let file: Record<string, Credentials>;
  try {
    file = JSON.parse(readFileSync(keyFile, 'utf8'));
  } catch (err) {
    throw new Error(
      `Cannot read ${keyFile}. Run \`npx dexie-cloud connect ${databaseUrl}\`, `
      + `or pass --key <path>. (${err})`,
    );
  }
  const found = file[databaseUrl];
  if (!found) {
    throw new Error(
      `No credentials for ${databaseUrl}. Have: ${Object.keys(file).join(', ')}`,
    );
  }
  return found;
}

async function accessToken(databaseUrl: string, creds: Credentials): Promise<string> {
  const res = await fetch(`${databaseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      scopes: ['ACCESS_DB', 'GLOBAL_READ', 'GLOBAL_WRITE'],
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json() as { accessToken?: string };
  if (!body.accessToken) throw new Error('Token response carried no accessToken');
  return body.accessToken;
}

async function readTable<T>(databaseUrl: string, token: string, table: string): Promise<T[]> {
  const res = await fetch(`${databaseUrl}/all/${encodeURIComponent(table)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /all/${table} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body?.data ?? body?.rows ?? []);
  if (!Array.isArray(list)) {
    throw new Error(`GET /all/${table} returned ${typeof body}, not a list`);
  }
  return list as T[];
}

/** Returns true when the row is gone afterwards, whatever the server said. */
async function deleteRow(
  databaseUrl: string, token: string, table: string, key: string,
): Promise<boolean> {
  const url = `${databaseUrl}/all/${encodeURIComponent(table)}/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.ok) return true;
  console.error(`  [delete] ${table}/${key} -> ${res.status} ${await res.text()}`);
  return false;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const databaseUrl = arg('db');
  const apply = process.argv.includes('--apply');
  if (!databaseUrl) {
    console.error('Usage: npm run repair:holdings -- --db <database-url> [--apply]');
    process.exit(2);
  }

  const creds = credentialsFor(databaseUrl, arg('key') ?? DEFAULT_KEY_FILE);
  // NFR-13: say which database this is, out loud, before touching it.
  console.info('[repair] session identity', {
    database: databaseUrl,
    clientId: creds.clientId,
    mode: apply ? 'APPLY (destructive)' : 'dry run',
    node: process.version,
  });

  const token = await accessToken(databaseUrl, creds);
  const [holdings, residencies, events] = await Promise.all([
    readTable<Holding>(databaseUrl, token, 'holdings'),
    readTable<Residency>(databaseUrl, token, 'residencies'),
    readTable<LifeEvent>(databaseUrl, token, 'lifeEvents'),
  ]);
  console.info('[repair] read', {
    holdings: holdings.length, residencies: residencies.length, lifeEvents: events.length,
  });

  const plan = planDedupe(holdings, residencies, events);
  console.info('[repair] plan', {
    before: plan.before,
    after: plan.after,
    removing: plan.remove.length,
    notesAtRisk: plan.notesAtRisk.length,
    skippedWithoutTank: plan.skippedWithoutTank.length,
  });

  if (plan.remove.length === 0) {
    console.info('[repair] nothing to do; this database holds no duplicated holdings');
    return;
  }

  // Refuse rather than reason about it. If a row we mean to delete carries a
  // catch link, life events, or a note the survivor lacks, the planner has hit
  // a case this repair was never verified against.
  const eventHoldings = new Set(events.map((e) => e.holdingId));
  const blockers = [
    ['carries a catch link', plan.remove.filter((h) => h.specimenId)],
    ['carries life events', plan.remove.filter((h) => eventHoldings.has(h.id))],
    ['carries a unique note', plan.notesAtRisk],
  ] as const;
  let blocked = false;
  for (const [why, rows] of blockers) {
    if (rows.length > 0) {
      blocked = true;
      console.error(`[repair] REFUSING: ${rows.length} row(s) to delete ${why}`);
      for (const r of rows) console.error(`    ${r.id}  ${r.rawLabel ?? r.speciesId}`);
    }
  }
  if (blocked) process.exit(1);

  const doomedHoldings = plan.remove.map((h) => h.id);
  const doomedSet = new Set(doomedHoldings);
  const doomedResidencies = residencies.filter((r) => doomedSet.has(r.holdingId));

  if (!apply) {
    console.info('[repair] DRY RUN. Would delete:', {
      holdings: doomedHoldings.length, residencies: doomedResidencies.length,
    });
    console.info('[repair] re-run with --apply to write. Nothing was changed.');
    return;
  }

  // Pre-image first. Deleting without a restorable copy of exactly what went
  // is the difference between a repair and an incident.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = arg('backup') ?? `repair-preimage-${stamp}.json`;
  writeFileSync(backup, JSON.stringify({
    database: databaseUrl,
    takenAt: new Date().toISOString(),
    holdings: plan.remove,
    residencies: doomedResidencies,
  }, null, 2));
  console.info(`[repair] pre-image of every doomed record written to ${backup}`);

  let okHoldings = 0;
  let okResidencies = 0;
  // Residencies first: a residency pointing at a deleted holding is a dangling
  // reference, and the tank screen resolves residency -> holding.
  for (const r of doomedResidencies) {
    if (await deleteRow(databaseUrl, token, 'residencies', r.id)) okResidencies += 1;
  }
  for (const id of doomedHoldings) {
    if (await deleteRow(databaseUrl, token, 'holdings', id)) okHoldings += 1;
  }
  console.info('[repair] delete calls accepted', {
    residencies: `${okResidencies}/${doomedResidencies.length}`,
    holdings: `${okHoldings}/${doomedHoldings.length}`,
  });

  // Green must mean verified. Re-read and count, do not trust the 200s.
  const [afterH, afterR] = await Promise.all([
    readTable<Holding>(databaseUrl, token, 'holdings'),
    readTable<Residency>(databaseUrl, token, 'residencies'),
  ]);
  const survivors = new Set(afterH.map((h) => h.id));
  const stragglers = doomedHoldings.filter((id) => survivors.has(id));
  const dangling = afterR.filter((r) => !survivors.has(r.holdingId));

  console.info('[repair] verified', {
    holdings: `${holdings.length} -> ${afterH.length} (expected ${plan.after})`,
    residencies: `${residencies.length} -> ${afterR.length}`,
    stragglers: stragglers.length,
    danglingResidencies: dangling.length,
  });

  if (afterH.length !== plan.after || stragglers.length > 0 || dangling.length > 0) {
    console.error('[repair] FAILED: the database does not match the plan.');
    console.error(`    restore from ${backup} with the /all POST endpoint`);
    process.exit(1);
  }
  console.info('[repair] done. Duplicates removed and verified.');
}

main().catch((err) => {
  console.error('[repair] aborted:', err instanceof Error ? err.message : err);
  process.exit(1);
});

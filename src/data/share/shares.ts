/**
 * Which tanks are published, from this device's point of view (spec 015).
 *
 * Four functions over one table. They exist rather than callers touching
 * `db.shares` directly because "one token per tank" is a rule, and a rule
 * enforced in four call sites is a rule that will be broken in the fifth.
 *
 * NOTE ON TRUTH. This table says what this account BELIEVES is published. R2
 * is the authority. They can disagree - a revoke that failed halfway, a device
 * that was offline when another one shared - so anything acting on a record
 * here should be able to cope with the object being absent, and `publishTank`
 * verifies rather than assumes (NFR-13).
 */
import { db as defaultDb, type Fish2TankDB, type ShareRecord } from '../db';
import type { Id } from '@/domain/types';

type DB = Pick<Fish2TankDB, 'shares'>;

/** Everything about a share except which tank it is. */
export type ShareDetails = Omit<ShareRecord, 'aquariumId'>;

/**
 * Publish-time bookkeeping for one tank.
 *
 * A `put` rather than an `add`: re-sharing a tank replaces its record, which
 * is what keeps the one-token-per-tank rule true. Spreading `details` over a
 * fresh object also means `lastError` is dropped unless the caller passes one,
 * so a successful publish clears the previous failure without anybody
 * remembering to.
 */
export async function recordShare(
  aquariumId: Id,
  details: ShareDetails,
  database: DB = defaultDb,
): Promise<void> {
  await database.shares.put({ aquariumId, ...details });
}

export async function shareFor(
  aquariumId: Id,
  database: DB = defaultDb,
): Promise<ShareRecord | undefined> {
  return database.shares.get(aquariumId);
}

/** Idempotent: revoking a tank that was never shared is a no-op, not a fault. */
export async function forgetShare(aquariumId: Id, database: DB = defaultDb): Promise<void> {
  await database.shares.delete(aquariumId);
}

/** Every published tank. What the automatic republisher iterates (FR-S03). */
export async function sharedTanks(database: DB = defaultDb): Promise<ShareRecord[]> {
  return database.shares.toArray();
}

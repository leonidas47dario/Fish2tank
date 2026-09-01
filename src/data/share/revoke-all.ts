/**
 * Take down every published tank, before anything destroys the rows that name
 * them (BUG-11, spec 028).
 *
 * THE RULE THIS EXISTS TO ENFORCE: a `shares` row must not be destroyed while
 * the page it names is still live. The row holds the token, the token is the
 * only way to revoke, and a published page outlives the device that made it.
 * Delete the row first and the page serves forever with nothing left that can
 * turn it off.
 *
 * Two places destroy those rows. `eraseEverything` clears them along with the
 * collection, and spec 022's join gate discards them with the rest of a
 * device's unsynced records. Both need the same answer, so it lives here
 * rather than at either call site.
 *
 * WHY IT REPORTS FAILURES RATHER THAN THROWING ON THE FIRST ONE. A keeper with
 * three shared tanks whose second revoke fails is better served by two dead
 * links and a precise list than by one dead link and an exception - and the
 * caller has to decide what to do about the survivors, which is a policy
 * question this function should not answer.
 */
import type { Fish2TankDB } from '../db';
import { db as defaultDb } from '../db';
import { revokeTank } from './client';
import { sharedTanks } from './shares';

export interface RevokeAllResult {
  /** Aquarium ids whose page is confirmed gone. */
  revoked: string[];
  /**
   * The ones still published, and why. A caller that destroys rows anyway is
   * choosing to strand these, and should say so out loud.
   */
  failed: Array<{ aquariumId: string; name: string; reason: string }>;
}

export async function revokeEveryShare(
  database: Fish2TankDB = defaultDb,
  deps: Parameters<typeof revokeTank>[1] = {},
): Promise<RevokeAllResult> {
  const shares = await sharedTanks(database);
  if (shares.length === 0) return { revoked: [], failed: [] };

  console.info('[share] revoking every published tank', { count: shares.length });

  const revoked: string[] = [];
  const failed: RevokeAllResult['failed'] = [];

  // Serial on purpose, unlike the publish-time HEADs. Each of these is a
  // DELETE against a different token and a partial failure has to be
  // attributable to a tank by name; a Promise.all that rejects tells the
  // keeper that something is still public without telling them what.
  for (const share of shares) {
    try {
      await revokeTank(share.aquariumId, { ...deps, db: database });
      revoked.push(share.aquariumId);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      // Named, not just identified. The caller has to tell a keeper WHICH
      // tank is still public, and an aquarium id is not something anyone
      // holding a phone can act on.
      const name = (await database.aquariums.get(share.aquariumId))?.name ?? share.aquariumId;
      console.error('[share] revoke failed, tank is still public', {
        aquariumId: share.aquariumId, name, reason,
      });
      failed.push({ aquariumId: share.aquariumId, name, reason });
    }
  }

  console.info('[share] revoke sweep done', { revoked: revoked.length, failed: failed.length });
  return { revoked, failed };
}

/**
 * Whether signing out would take photographs with it - BUG-10, spec 045.
 *
 * WHAT `_logout()` DOES. `dexie-cloud-addon` clears every Dexie table except
 * `$jobs`. That includes `blobs`, which is in `UNSYNCED_TABLES` - so an
 * original the media queue has not yet pushed to R2 exists in NO OTHER PLACE,
 * and signing out destroys it. NFR-03 says the original is the one thing that
 * must never be lost.
 *
 * It also includes `shares`. That table is deliberately synced, so a published
 * page survives a sign-out once its row has reached the account - and does not
 * before. The row holds the only token that can revoke the page, so losing it
 * leaves a page on the internet that nothing can take down. A photo lost is a
 * photo; a token lost is a page nobody can take down.
 *
 * PURE, and separate from the panel, so the rule can be tested without a
 * browser and cannot drift from what the button does.
 */

export type SignOutBlocker = 'photos-not-uploaded' | 'records-not-synced';

export interface SignOutVerdict {
  safe: boolean;
  blockers: SignOutBlocker[];
  /** Photographs that exist only on this device. Zero when none do. */
  photosAtRisk: number;
}

export interface SignOutInputs {
  /** `photoSyncWork().pending` - rows this device still owes bytes for. */
  pendingPhotos: number;
  /** `db.cloud.syncState.phase`. Undefined before the addon reports. */
  syncPhase: string | undefined;
  /**
   * True once the keeper has taken an archive in this session.
   *
   * The way THROUGH the gate rather than around it: spec 016's precedent is
   * that a backup makes an otherwise unsafe operation safe, because the bytes
   * then exist somewhere `_logout` cannot reach. A gate with no way out is a
   * trap - a keeper offline in a fish shop could never sign out at all.
   */
  backedUp?: boolean;
}

/**
 * `missing` is deliberately NOT an input. It counts photographs this device has
 * not yet DOWNLOADED, which by definition exist elsewhere; losing a copy you
 * never held is not losing anything.
 */
export function canSignOut(input: SignOutInputs): SignOutVerdict {
  if (input.backedUp) {
    return { safe: true, blockers: [], photosAtRisk: input.pendingPhotos };
  }

  const blockers: SignOutBlocker[] = [];
  if (input.pendingPhotos > 0) blockers.push('photos-not-uploaded');
  // Anything other than a settled sync may still be holding a `shares` row -
  // or any other record - that has not reached the account. `undefined` counts
  // as unsettled: the addon has not reported yet, so nothing is known.
  if (input.syncPhase !== 'in-sync') blockers.push('records-not-synced');

  return { safe: blockers.length === 0, blockers, photosAtRisk: input.pendingPhotos };
}

/** What to tell the keeper, in the words the panel shows. */
export function signOutMessage(verdict: SignOutVerdict): string | undefined {
  if (verdict.safe) return undefined;

  const photos = verdict.blockers.includes('photos-not-uploaded');
  const records = verdict.blockers.includes('records-not-synced');

  if (photos && records) {
    return `${verdict.photosAtRisk} ${verdict.photosAtRisk === 1 ? 'photograph is' : 'photographs are'} `
      + 'still only on this device, and your records have not finished syncing. '
      + 'Signing out now would delete both. Wait for the sync to finish, or back up first.';
  }
  if (photos) {
    return `${verdict.photosAtRisk} ${verdict.photosAtRisk === 1 ? 'photograph exists' : 'photographs exist'} `
      + 'only on this device. Signing out clears them, and there is nothing to '
      + 'restore from. Wait for photo sync to finish, or back up first.';
  }
  return 'Your records have not finished syncing. Signing out now could lose an '
    + 'edit — and a shared page whose record is lost stays online with nothing '
    + 'able to take it down. Wait for the sync to finish, or back up first.';
}

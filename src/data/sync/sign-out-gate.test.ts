import { describe, expect, it } from 'vitest';
import { canSignOut, signOutMessage } from './sign-out-gate';

/**
 * BUG-10, spec 045. The rule worth guarding is not "warn about unsynced
 * photos" - it is that the app REFUSES rather than proceeding, because the
 * photographs at risk are exactly the ones that exist in no other place.
 */

const settled = { pendingPhotos: 0, syncPhase: 'in-sync' };

describe('canSignOut', () => {
  it('lets a settled device sign out with no extra step', () => {
    expect(canSignOut(settled)).toEqual({ safe: true, blockers: [], photosAtRisk: 0 });
  });

  it('REFUSES while a photograph exists only on this device', () => {
    // `_logout()` clears `blobs`, which is unsynced, so these have no copy
    // anywhere. NFR-03: the original is the one thing that must never be lost.
    const v = canSignOut({ pendingPhotos: 3, syncPhase: 'in-sync' });

    expect(v.safe).toBe(false);
    expect(v.blockers).toEqual(['photos-not-uploaded']);
    expect(v.photosAtRisk).toBe(3);
  });

  it('REFUSES while records have not settled, even with every photo uploaded', () => {
    // `shares` is synced, and its row holds the only token that can revoke a
    // published page. Losing it leaves a page online that nothing can take
    // down - BUG-12's reachable variant.
    const v = canSignOut({ pendingPhotos: 0, syncPhase: 'pushing' });

    expect(v.safe).toBe(false);
    expect(v.blockers).toEqual(['records-not-synced']);
  });

  it('treats an unknown sync phase as unsettled rather than safe', () => {
    // The addon has not reported yet, so nothing is known. Defaulting to safe
    // would make the gate useless in exactly the first seconds after load.
    expect(canSignOut({ pendingPhotos: 0, syncPhase: undefined }).safe).toBe(false);
  });

  it('reports both blockers when both apply', () => {
    const v = canSignOut({ pendingPhotos: 2, syncPhase: 'error' });

    expect(v.blockers).toEqual(['photos-not-uploaded', 'records-not-synced']);
  });

  it('A BACKUP IS THE WAY THROUGH, not a way around', () => {
    // Spec 016's precedent: once the archive is on the keeper's disk the bytes
    // exist somewhere `_logout` cannot reach, so the objection is answered.
    // Without this a keeper offline in a fish shop could never sign out at all.
    const v = canSignOut({ pendingPhotos: 5, syncPhase: 'error', backedUp: true });

    expect(v.safe).toBe(true);
    expect(v.blockers).toEqual([]);
    // Still reported, because the count is true and the panel may want to say so.
    expect(v.photosAtRisk).toBe(5);
  });
});

describe('signOutMessage', () => {
  it('says nothing when there is nothing to say', () => {
    expect(signOutMessage(canSignOut(settled))).toBeUndefined();
  });

  it('counts the photographs, and never says a number it does not have', () => {
    const msg = signOutMessage(canSignOut({ pendingPhotos: 1, syncPhase: 'in-sync' }))!;

    expect(msg).toContain('1 photograph exists');
    expect(msg).toContain('back up first');
  });

  it('pluralises rather than writing "1 photographs"', () => {
    const msg = signOutMessage(canSignOut({ pendingPhotos: 4, syncPhase: 'in-sync' }))!;

    expect(msg).toContain('4 photographs exist');
  });

  it('names the shared-page consequence when records are the blocker', () => {
    const msg = signOutMessage(canSignOut({ pendingPhotos: 0, syncPhase: 'pushing' }))!;

    expect(msg).toMatch(/shared page/);
  });
});

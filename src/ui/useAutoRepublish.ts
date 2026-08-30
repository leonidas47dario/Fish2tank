/**
 * Connecting the republish scheduler to Dexie and the browser - spec 019.
 *
 * The scheduler itself (`data/share/auto-republish.ts`) knows nothing about
 * either, which is what lets it be tested on fake timers. This is the wiring,
 * and it is deliberately the only part that is hard to test: everything with a
 * decision in it lives on the other side of that boundary.
 *
 * Mounted once, inside the gate. Only an owner republishes, and a guest
 * reading a shared page has no shares of their own to keep current.
 */
import { useEffect } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/data/db';
import { currentShareState, publishTank, shareBlocker } from '@/data/share/client';
import {
  createAutoRepublish, tanksToRepublish, type CurrentState,
} from '@/data/share/auto-republish';

export function useAutoRepublish(): void {
  useEffect(() => {
    const auto = createAutoRepublish({
      /**
       * Everything shared, everything behind.
       *
       * Reads `shares` here rather than in the subscription below on purpose:
       * publishing WRITES to `shares`, and a subscription that watched it
       * would re-fire on its own success. The tables watched below are only
       * the ones a person edits.
       */
      due: async (failed) => {
        const shares = await db.shares.toArray();
        if (shares.length === 0) return [];

        const current = new Map<string, CurrentState>();
        for (const share of shares) {
          const state = await currentShareState(share.aquariumId);
          if (state) current.set(share.aquariumId, state);
        }
        return tanksToRepublish({ shares, current, failed });
      },

      publish: (aquariumId) => publishTank(aquariumId),

      blocked: () => shareBlocker(),
    });

    /*
     * Watch what a person edits, not what publishing writes.
     *
     * These five tables are every source of a change a guest would see: fish
     * in and out (holdings, residencies, lifeEvents), the tank itself
     * (aquariums), and its photo (media). `shares` is deliberately absent -
     * see the note on `due` above.
     *
     * NOT COUNTS. Counting was the first attempt and it repeats spec 014's
     * bug exactly: renaming a tank, correcting a quantity, or replacing a
     * photo all leave every count where it was, so a real change a guest
     * would see would never request a run. The digest reads the fields that
     * matter, so an UPDATE moves it too.
     *
     * Being over-eager here is safe and being under-eager is not: a spurious
     * request costs one `due` pass that finds nothing and writes nothing,
     * while a missed one is a stale public page.
     */
    const subscription = liveQuery(async () => {
      const [holdings, residencies, events, aquariums, media] = await Promise.all([
        db.holdings.toArray(), db.residencies.toArray(), db.lifeEvents.count(),
        db.aquariums.toArray(), db.media.count(),
      ]);
      return JSON.stringify([
        aquariums.map((a) => [a.id, a.name, a.volume?.value, a.volume?.unit, a.photoMediaId]),
        holdings.map((h) => [h.id, h.speciesId, h.rawLabel, h.openingQuantity]),
        residencies.map((r) => [r.id, r.holdingId, r.aquariumId, r.endDate]),
        events,
        media,
      ]);
    }).subscribe({
      next: () => auto.request('the tank changed'),
      error: (cause) => console.error('[share] republish subscription failed', { cause: String(cause) }),
    });

    // Coming back online is the single most likely moment for a republish that
    // could not happen to become one that can.
    const onOnline = () => auto.request('back online');
    // A phone in a pocket ran no timers and saw no events. This is how it
    // catches up on being opened.
    const onVisible = () => {
      if (document.visibilityState === 'visible') auto.request('the app was reopened');
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      auto.stop();
    };
  }, []);
}

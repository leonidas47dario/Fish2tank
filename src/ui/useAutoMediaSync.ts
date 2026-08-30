/**
 * Wiring the automatic photo sync to the app - spec 014.
 *
 * The scheduler in `data/sync/auto-sync.ts` knows nothing about Dexie or the
 * DOM. This is the half that does, kept apart from it so the awkward logic
 * stays testable with fake timers and no browser.
 *
 * WHY IT WATCHES THE TABLE RATHER THAN THE CALLERS. The obvious approach is a
 * hook in every photo-modifying action, and there are at least six of those
 * today. Every one would have to be kept in step by hand, and the seventh
 * added next month would silently not sync - the exact drift BUG-06 was made
 * of, where four delete sites each remembered the original and all four forgot
 * previews and thumbnails. A liveQuery over `media` catches all of them, plus
 * one an instrumented call site could not see at all: a row arriving from
 * ANOTHER device, which is precisely when this one should be downloading.
 */
import { useEffect, useState } from 'react';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { LOCAL_PROFILE_ID } from '@/data/profile';
import {
  createAutoSync,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  type AutoSync,
  type AutoSyncState,
} from '@/data/sync/auto-sync';
import { mediaSyncBlocker, runMediaSync } from '@/data/sync/media-sync';

/**
 * One scheduler for the app, not one per mount.
 *
 * React StrictMode mounts effects twice in development and the panel and the
 * driver both want to reach it, so a second instance would mean a second
 * timer and two runs racing each other over the same queue.
 */
let instance: AutoSync | undefined;

export function autoSync(): AutoSync {
  instance ??= createAutoSync({ run: runMediaSync, blocked: mediaSyncBlocker });
  return instance;
}

/** Read-only view, for anything that wants to report the state. */
export function useAutoSyncState(): AutoSyncState {
  const [state, setState] = useState(() => autoSync().state());
  useEffect(() => autoSync().subscribe(setState), []);
  return state;
}

/**
 * Drives the scheduler. Mounted exactly once, by `<AutoMediaSync />`.
 */
export function useAutoMediaSync(): void {
  const user = useObservable(db.cloud.currentUser);
  const profile = useLiveQuery(() => db.users.get(LOCAL_PROFILE_ID));
  const minutes = profile?.settings.photoSyncMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES;

  // Both numbers matter. `pending` rises when this device makes a photo;
  // `total` rises when one arrives from somewhere else with its bytes still
  // in the store - and that is a download nobody would otherwise ask for.
  const counts = useLiveQuery(async () => ({
    total: await db.media.count(),
    pending: await db.media.where('syncState').notEqual('synced').count(),
  }));

  useEffect(() => {
    autoSync().setIntervalMinutes(minutes);
  }, [minutes]);

  useEffect(() => {
    if (!counts) return;
    autoSync().request('photos changed');
  }, [counts?.total, counts?.pending]);

  // Signing in is the moment a device stops being blocked. Without this the
  // first run after a sign-in waits for the timer, which is up to an hour of
  // photos sitting still on a device that could be sending them.
  const signedIn = Boolean(user?.isLoggedIn);
  useEffect(() => {
    if (signedIn) autoSync().request('signed in');
  }, [signedIn]);

  useEffect(() => {
    const online = () => autoSync().request('back online');
    const visible = () => {
      // A phone in a pocket for an hour ran no timers. Opening it is how it
      // catches up.
      if (document.visibilityState === 'visible') autoSync().request('app opened');
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
}

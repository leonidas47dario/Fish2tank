/**
 * Photo sync that happens without being asked - spec 014 FR-A03.
 *
 * Records synced on their own and photos did not, so a photo sat on the
 * device that took it until somebody opened Settings and pressed a button.
 * The gap between the two guarantees is invisible right up until the phone is
 * lost, which is the failure this whole subsystem exists to prevent.
 *
 * THE SCHEDULER KNOWS NOTHING ABOUT DEXIE, THE DOM OR THE CLOCK IT RUNS ON.
 * It is handed a `run` and a `blocked` and does the awkward parts: debouncing
 * a burst into one run, refusing to start a second run on top of a first,
 * remembering that a request arrived mid-run, and - the part that matters -
 * knowing when to stop trying. The wiring to liveQuery and to browser events
 * lives in ui/useAutoMediaSync.ts, so this file is testable with fake timers
 * and no browser at all.
 *
 * WHY IT CAN STOP. On 2026-08-30 production reported "28 failed" and promised
 * a retry against a media Worker that had never been deployed; every retry
 * failed identically, forever, while the screen said otherwise (spec 011). An
 * unattended loop makes that strictly worse - it fails silently, on a
 * schedule, on battery. So a `configurationFault` stops the automatic half and
 * says so. The manual button is untouched, because pressing it is how somebody
 * finds out the deployment finally landed.
 */
import type { MediaSyncBlocker, MediaSyncResult } from './media-sync';

/**
 * How long a burst is allowed to keep arriving before the run starts.
 *
 * Importing a catch writes an original, a preview and a thumbnail in quick
 * succession, and a multi-photo capture writes several of each. Five seconds
 * turns that into one run without making a single photo feel ignored.
 */
export const DEBOUNCE_MS = 5_000;

/** The picker's choices, in minutes. 0 is "off" and means the timer only. */
export const SYNC_INTERVAL_CHOICES = [0, 5, 15, 30, 60, 180] as const;

/** What the ask specified. */
export const DEFAULT_SYNC_INTERVAL_MINUTES = 30;

export interface AutoSyncState {
  /** True while a run is actually in flight. */
  running: boolean;
  /** When the last automatic run finished. Absent until one has. */
  lastRunAt?: number;
  /** What asked for it, for the log and the panel. */
  lastReason?: string;
  lastResult?: MediaSyncResult;
  /**
   * Set when the unattended loop has given up because retrying cannot help.
   * Carries the reason so the UI can say it rather than going quiet.
   */
  paused?: { reason: string };
}

export interface AutoSync {
  /** Ask for a run. Debounced and coalesced; safe to call constantly. */
  request(reason: string): void;
  /** 0 turns the timer off. Everything else stays. */
  setIntervalMinutes(minutes: number): void;
  /** Clear a pause - what the manual button does after a deployment lands. */
  resume(): void;
  subscribe(listener: (state: AutoSyncState) => void): () => void;
  state(): AutoSyncState;
  /** Cancels the timer and any pending debounce. */
  stop(): void;
}

export interface AutoSyncOptions {
  run: () => Promise<MediaSyncResult>;
  /** Why a run cannot happen right now, or undefined if it can. */
  blocked: () => MediaSyncBlocker | undefined;
  debounceMs?: number;
}

/** True when neither queue can succeed until a person changes a deployment. */
function isConfigurationFault(result: MediaSyncResult): boolean {
  return Boolean(result.upload?.configurationFault || result.download?.configurationFault);
}

export function createAutoSync(options: AutoSyncOptions): AutoSync {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const listeners = new Set<(state: AutoSyncState) => void>();

  let state: AutoSyncState = { running: false };
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let intervalMinutes = 0;
  // A request that arrived while a run was in flight. Exactly one follow-up
  // run is owed however many arrive, because they all want the same thing.
  let owed: string | undefined;

  function publish(next: Partial<AutoSyncState>): void {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  }

  async function runNow(reason: string): Promise<void> {
    publish({ running: true, lastReason: reason });
    let result: MediaSyncResult | undefined;
    try {
      result = await options.run();
    } catch (cause) {
      // Never swallowed. An automatic run that fails silently is the same
      // defect as a manual one that lies about retrying (NFR-13).
      console.warn('[sync] automatic photo sync failed', { reason, cause });
    }

    const paused = result && isConfigurationFault(result)
      ? { reason: result.upload?.firstError ?? result.download?.firstError ?? 'photo storage is unreachable' }
      : state.paused;

    if (paused && !state.paused) {
      console.warn('[sync] automatic photo sync paused - retrying cannot help', paused);
      clearTimer();
    }

    publish({ running: false, lastRunAt: Date.now(), lastResult: result, paused });

    const followUp = owed;
    owed = undefined;
    if (followUp && !state.paused) request(followUp);
  }

  function request(reason: string): void {
    if (state.paused) return;
    if (state.running) {
      owed = reason;
      return;
    }
    const blocker = options.blocked();
    if (blocker) {
      // Not a fault and not a pause: signed out, offline and not-configured
      // all change on their own, and the next request will find them changed.
      return;
    }
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void runNow(reason);
    }, debounceMs);
  }

  function clearTimer(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function setIntervalMinutes(minutes: number): void {
    intervalMinutes = minutes;
    clearTimer();
    if (minutes <= 0 || state.paused) return;
    timer = setInterval(() => request('every ' + minutes + ' minutes'), minutes * 60_000);
  }

  return {
    request,
    setIntervalMinutes,
    resume() {
      if (!state.paused) return;
      publish({ paused: undefined });
      setIntervalMinutes(intervalMinutes);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    state: () => state,
    stop() {
      clearTimer();
      if (debounce) clearTimeout(debounce);
      debounce = undefined;
      listeners.clear();
    },
  };
}

/**
 * A shared tank keeps itself current - spec 023 FR-S03.
 *
 * WATCH THE DATA, NOT THE CALLERS. Spec 014 established this and the reason
 * holds here exactly: at least eight functions change what a tank contains
 * (`stockTank`, `removeHolding`, `adjustHoldingQuantity`, `moveHolding`,
 * `recordDeath`, `setTankPhoto`, `clearTankPhoto`, `deleteTank`), every one of
 * them would have to be kept in step by hand, and the ninth added next month
 * would silently stop republishing. A `liveQuery` over the tables catches all
 * of them, including the case an instrumented call site would miss entirely:
 * an edit arriving from another device.
 *
 * WHY A FAILED PUBLISH IS NOT RETRIED ON A LOOP. Two reasons, and the first is
 * mundane: recording the failure writes to `shares`, the subscription would
 * see the write, and the loop would spin at whatever rate the network allows.
 * The second is spec 011's lesson - an automatic retry against something that
 * cannot succeed fails silently, on a schedule, on battery. So a failure is
 * remembered against the fingerprint that produced it, and that tank is left
 * alone until it changes again or somebody presses the button.
 */
import type { ShareRecord } from '../db';
import { needsRepublish } from './snapshot';

/**
 * How long a burst may keep arriving before the write starts.
 *
 * Adding six fish to a tank is six writes in a few seconds, and each one is a
 * change a guest would see. Three seconds turns that into one publish while
 * still feeling immediate to somebody watching the sheet.
 */
export const DEBOUNCE_MS = 3_000;

/** What a tank looks like right now, in the terms the decision needs. */
export interface CurrentState {
  fingerprint: string;
  hasPhoto: boolean;
}

/**
 * Which shared tanks are behind and worth writing.
 *
 * Pure, so the decision can be tested without a database, a clock or a
 * network - which matters because every wrong answer here is either a stale
 * page nobody notices or a write loop nobody asked for.
 */
export function tanksToRepublish(input: {
  shares: ShareRecord[];
  current: Map<string, CurrentState>;
  /** aquariumId -> the fingerprint whose publish failed. */
  failed: Map<string, string>;
}): string[] {
  return input.shares
    .filter((share) => {
      const current = input.current.get(share.aquariumId);
      // A share whose tank has gone is not republished. Deleting a tank is not
      // the same act as revoking its link, and guessing between them here
      // would either strand a page or take one down without being asked.
      if (!current) return false;
      if (!needsRepublish(share, current)) return false;
      // Already tried this exact content and it failed. Wait for a change.
      return input.failed.get(share.aquariumId) !== current.fingerprint;
    })
    .map((share) => share.aquariumId);
}

export interface AutoRepublishState {
  running: boolean;
  lastRunAt?: number;
  /** aquariumId -> the message from its last failure. */
  failures: Map<string, string>;
}

export interface AutoRepublish {
  /** Ask for a pass. Debounced and coalesced; safe to call on every change. */
  request(reason: string): void;
  subscribe(listener: (state: AutoRepublishState) => void): () => void;
  state(): AutoRepublishState;
  /** Forget the failures, so the next request tries them again. */
  resume(): void;
  stop(): void;
}

export interface AutoRepublishOptions {
  /** Every shared tank that is behind, and worth a write right now. */
  due: (failed: Map<string, string>) => Promise<string[]>;
  /** Publish one tank. Rejecting is expected and is not a crash. */
  publish: (aquariumId: string) => Promise<unknown>;
  /** Why a pass cannot happen at all, or undefined if it can. */
  blocked: () => string | undefined;
  debounceMs?: number;
  now?: () => number;
}

export function createAutoRepublish(options: AutoRepublishOptions): AutoRepublish {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<(state: AutoRepublishState) => void>();

  let state: AutoRepublishState = { running: false, failures: new Map() };
  let debounce: ReturnType<typeof setTimeout> | undefined;
  // A request that arrived mid-pass. Exactly one follow-up is owed however
  // many arrive, because they all want the same thing.
  let owed: string | undefined;

  function publishState(next: Partial<AutoRepublishState>): void {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  }

  async function runNow(reason: string): Promise<void> {
    publishState({ running: true });
    const failures = new Map(state.failures);

    try {
      const due = await options.due(failures);
      if (due.length === 0) {
        // Logged at debug volume rather than info: a settled app asks this
        // question on every change and the answer is usually nothing.
        console.debug('[share] republish pass - nothing to do', { reason });
      }

      for (const aquariumId of due) {
        console.info('[share] republishing', { aquariumId, reason });
        try {
          await options.publish(aquariumId);
          failures.delete(aquariumId);
        } catch (cause) {
          // Never swallowed, and never retried on a timer. The sheet reads
          // this and offers the button; see the note at the top of the file.
          const message = cause instanceof Error ? cause.message : String(cause);
          console.error('[share] republish failed', { aquariumId, reason, error: message });
          failures.set(aquariumId, message);
        }
      }
    } catch (cause) {
      console.error('[share] republish pass failed', { reason, cause: String(cause) });
    }

    publishState({ running: false, lastRunAt: now(), failures });

    const followUp = owed;
    owed = undefined;
    if (followUp) request(followUp);
  }

  function request(reason: string): void {
    if (state.running) {
      owed = reason;
      return;
    }
    const blocker = options.blocked();
    if (blocker) {
      // Signed out, offline, nothing shared, not configured. None is a fault
      // and all of them change on their own, so the next request will find
      // them changed. Nothing is paused and nothing is logged loudly.
      return;
    }
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void runNow(reason);
    }, debounceMs);
  }

  return {
    request,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    state: () => state,
    resume() {
      publishState({ failures: new Map() });
    },
    stop() {
      if (debounce) clearTimeout(debounce);
      debounce = undefined;
      listeners.clear();
    },
  };
}

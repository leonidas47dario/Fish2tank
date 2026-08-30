/**
 * Logging for anything that moves bytes off this device.
 *
 * The rule this enforces: **log the intent AND the outcome, never just the
 * intent.** "uploading X" on its own tells you nothing after the fact;
 * "uploading X -> ok 412ms" versus "-> 403 signature expired" is the entire
 * diagnosis. Origin: a staging-table swap that silently no-op'd in production
 * for a week while every run logged success.
 *
 * Nothing here is clever. It exists so the call sites cannot forget the
 * outcome half, because the only API for starting a log line returns the
 * function that finishes it.
 */
import type { SyncEnvironment } from './backend';

export type Outcome = 'ok' | 'failed' | 'skipped';

export interface SyncLogger {
  /** Emitted once per run, so a log fragment identifies its own tier. */
  runStarted(purpose: string): void;
  runFinished(purpose: string, summary: Record<string, number>): void;
  /**
   * Logs the intent and returns the function that logs the outcome.
   * There is no way to log a start without being handed the end.
   */
  step(intent: string): (outcome: Outcome, detail?: string) => void;
  /** For a caught error that is genuinely benign; says why, in the line. */
  benign(intent: string, reason: string, err: unknown): void;
}

export function createSyncLogger(
  env: SyncEnvironment,
  sink: Pick<Console, 'info' | 'warn' | 'error'> = console,
): SyncLogger {
  const identity =
    `account=${env.account} db=${env.databaseUrl} bucket=${env.bucket} env=${env.environment}`;

  return {
    runStarted(purpose) {
      sink.info(`[sync] ${purpose} start ${identity}`);
    },
    runFinished(purpose, summary) {
      const pairs = Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' ');
      sink.info(`[sync] ${purpose} done ${pairs} ${identity}`);
    },
    step(intent) {
      const startedAt = Date.now();
      return (outcome, detail) => {
        const line = `[sync] ${intent} -> ${outcome} ${Date.now() - startedAt}ms` +
          (detail ? ` ${detail}` : '');
        if (outcome === 'failed') sink.error(line);
        else sink.info(line);
      };
    },
    benign(intent, reason, err) {
      // Never a bare catch: an ignored error is an invisible branch, so the
      // reason it is safe to ignore has to be in the log next to it.
      sink.warn(`[sync] ${intent} -> ignored (${reason})`, err);
    },
  };
}

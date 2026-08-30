/**
 * Moving media bytes to and from the object store.
 *
 * Spec 005 FR-A03 and NFR-13. Records are somebody else's problem (Dexie
 * Cloud); this module owns the expensive half, and the reason it owns it is
 * that "did the bytes actually arrive" is a question a sync engine has to
 * answer honestly.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: a 200 from an upload is not evidence
 * the object exists. `syncState` only advances to `synced` after the store is
 * asked what it holds and the size matches what was sent. A step that reports
 * success without checking its own result is the worst failure mode there is,
 * because it is silently wrong indefinitely.
 *
 * NFR-03 also constrains this: a local original is never deleted after a
 * successful upload. The original is the record; a copy elsewhere is a copy.
 */
import { blobFor, type Fish2TankDB } from '../db';
import type { Media } from '@/domain/types';
import { objectKeyFor, type MediaBackend, type SyncEnvironment } from './backend';
import { createSyncLogger, type SyncLogger } from './sync-log';
import { WorkerCallError } from './worker-backend';

export interface MediaSyncDeps {
  db: Fish2TankDB;
  backend: MediaBackend;
  env: SyncEnvironment;
  logger?: SyncLogger;
  /** Injectable so tests never touch the network. */
  fetchImpl?: typeof fetch;
}

export interface TransferSummary {
  uploaded: number;
  downloaded: number;
  skipped: number;
  failed: number;
  /**
   * Why the first failure failed, when there was one.
   *
   * Counts alone let the UI say "28 failed" and then guess at the rest. On
   * 2026-08-30 that guess was "they will be retried", while the real answer
   * was that production's media Worker had never been deployed - so every
   * retry was going to fail in exactly the same way, forever, and the screen
   * said the opposite.
   */
  firstError?: string;
  /** True when retrying cannot help until somebody changes a deployment. */
  configurationFault?: boolean;
}

/**
 * The blob keys a media row owns, cheapest first.
 *
 * Thumbnail, then preview, then original: a device that has just signed in
 * should be able to show the collection in seconds rather than after
 * gigabytes. Ordering is a product decision, not an implementation detail,
 * which is why it is one named function instead of an inline sort.
 */
/**
 * The browser's fetch, bound to the global.
 *
 * `fetch` captured into a variable and then called as a METHOD - which is what
 * `deps.fetchImpl(...)` is - arrives with `this` set to the deps object, and
 * the browser refuses: "Failed to execute 'fetch' on 'Window': Illegal
 * invocation". It cost 28 consecutive upload failures on UAT, and no test saw
 * it because every test injects a fake and never touches this default.
 */
const boundFetch: typeof fetch = (...args) => globalThis.fetch(...args);

export function transferOrder(media: Media): string[] {
  return [media.thumbnailBlobKey, media.previewBlobKey, media.originalBlobKey]
    .filter((k): k is string => Boolean(k));
}

/** Media rows with bytes still owed to the store. */
export function needsUpload(media: Media): boolean {
  return media.syncState !== 'synced';
}

async function uploadOne(
  blobKey: string,
  deps: Required<Pick<MediaSyncDeps, 'db' | 'backend' | 'env' | 'fetchImpl'>>,
  log: SyncLogger,
): Promise<boolean> {
  const stored = await deps.db.blobs.get(blobKey);
  const body = blobFor(stored);
  if (!stored || !body) {
    // Not a failure: a preview can legitimately be missing, and a media row
    // whose original is gone is a different (louder) problem than a sync one.
    log.benign(`upload ${blobKey}`, 'no local bytes for this key', undefined);
    return false;
  }

  const key = objectKeyFor(deps.env.account, blobKey);
  const done = log.step(`upload ${key} ${stored.bytes}B`);

  let signed;
  try {
    signed = await deps.backend.presignPut(key, stored.mimeType);
  } catch (err) {
    done('failed', `could not presign: ${String(err)}`);
    throw err;
  }

  try {
    const res = await deps.fetchImpl(signed.url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': stored.mimeType },
    });
    if (!res.ok) {
      done('failed', `PUT ${res.status}`);
      throw new Error(`upload rejected: ${res.status}`);
    }
  } catch (err) {
    done('failed', String(err));
    throw err;
  }

  // The verification. Without this the rest of the module is theatre.
  const head = await deps.backend.head(key);
  if (!head) {
    done('failed', 'verify: object absent after a successful PUT');
    throw new Error(`verification failed: ${key} absent after upload`);
  }
  if (head.bytes !== stored.bytes) {
    done('failed', `verify: store holds ${head.bytes}B, sent ${stored.bytes}B`);
    throw new Error(`verification failed: ${key} size mismatch`);
  }

  done('ok', `verified ${head.bytes}B`);
  return true;
}

/**
 * Pushes every media row that still owes bytes.
 *
 * A row is only marked `synced` when all of its present blobs verified. A
 * partial failure leaves it `retry-required`, which is the resumable state:
 * the next run re-uploads the same keys, and an object already present simply
 * verifies again. Nothing is double-counted and nothing is lost.
 */
/**
 * Keep the FIRST failure's reason, not the last.
 *
 * Twenty-eight failures with one cause are one problem, and the first one is
 * the one that has not yet been coloured by whatever the failure did to the
 * next attempt. Later failures still count; they just do not overwrite the
 * diagnosis.
 */
function noteFailure(summary: TransferSummary, cause: unknown): void {
  const isConfig = cause instanceof WorkerCallError && cause.isConfiguration;
  if (isConfig) summary.configurationFault = true;
  if (summary.firstError) return;
  summary.firstError = cause instanceof Error ? cause.message : String(cause);
}

export async function runUploadQueue(deps: MediaSyncDeps): Promise<TransferSummary> {
  const fetchImpl = deps.fetchImpl ?? boundFetch;
  const log = deps.logger ?? createSyncLogger(deps.env);
  const resolved = { db: deps.db, backend: deps.backend, env: deps.env, fetchImpl };

  log.runStarted('media upload');
  const summary: TransferSummary = { uploaded: 0, downloaded: 0, skipped: 0, failed: 0 };

  const pending = (await deps.db.media.toArray()).filter(needsUpload);

  for (const media of pending) {
    let allOk = true;
    for (const blobKey of transferOrder(media)) {
      try {
        const sent = await uploadOne(blobKey, resolved, log);
        if (sent) summary.uploaded += 1;
        else summary.skipped += 1;
      } catch (cause) {
        // Already logged with its reason inside uploadOne. Recorded here as a
        // failed transfer so the row stays retryable rather than being marked
        // clean, which is the entire point of NFR-13.
        summary.failed += 1;
        noteFailure(summary, cause);
        allOk = false;
      }
    }
    await deps.db.media.update(media.id, {
      syncState: allOk ? 'synced' : 'retry-required',
    });
  }

  // The logger's contract is counts. The reason is carried on the summary for
  // the UI and has already been logged with its own line by uploadOne.
  const { uploaded, downloaded, skipped, failed } = summary;
  log.runFinished('media upload', { uploaded, downloaded, skipped, failed });
  return summary;
}

/**
 * Pulls any blob this device is missing.
 *
 * The counterpart to upload, and what makes a freshly signed-in device
 * usable. Bytes are verified against what the store says it holds before they
 * are written locally, so a truncated download cannot masquerade as a photo.
 */
export async function runDownloadQueue(deps: MediaSyncDeps): Promise<TransferSummary> {
  const fetchImpl = deps.fetchImpl ?? boundFetch;
  const log = deps.logger ?? createSyncLogger(deps.env);

  log.runStarted('media download');
  const summary: TransferSummary = { uploaded: 0, downloaded: 0, skipped: 0, failed: 0 };

  for (const media of await deps.db.media.toArray()) {
    for (const blobKey of transferOrder(media)) {
      if (await deps.db.blobs.get(blobKey)) {
        summary.skipped += 1;
        continue;
      }

      const key = objectKeyFor(deps.env.account, blobKey);
      const done = log.step(`download ${key}`);
      try {
        const head = await deps.backend.head(key);
        if (!head) {
          done('skipped', 'not in the store yet');
          summary.skipped += 1;
          continue;
        }

        const signed = await deps.backend.presignGet(key);
        const res = await fetchImpl(signed.url);
        if (!res.ok) {
          done('failed', `GET ${res.status}`);
          summary.failed += 1;
          continue;
        }

        const data = await res.arrayBuffer();
        if (data.byteLength !== head.bytes) {
          // Refuse a short read rather than storing a truncated photo, which
          // would look like a corrupt original forever after.
          done('failed', `got ${data.byteLength}B, store says ${head.bytes}B`);
          summary.failed += 1;
          continue;
        }

        await deps.db.blobs.put({
          key: blobKey,
          data,
          bytes: data.byteLength,
          mimeType: media.mimeType,
          storedAt: new Date().toISOString(),
        });
        done('ok', `${data.byteLength}B`);
        summary.downloaded += 1;
      } catch (err) {
        done('failed', String(err));
        summary.failed += 1;
        noteFailure(summary, err);
      }
    }
  }

  const { uploaded, downloaded, skipped, failed } = summary;
  log.runFinished('media download', { uploaded, downloaded, skipped, failed });
  return summary;
}

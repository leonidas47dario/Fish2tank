/**
 * Starting the media queues - spec 005 FR-A03.
 *
 * The queues themselves (upload, download, retry, resume, and the refusal to
 * mark anything synced without a post-upload HEAD) live in media-queue.ts and
 * know nothing about Dexie Cloud, Cloudflare, or this app's configuration.
 * This module is the thin piece that decides whether a run is possible and
 * assembles the pieces, so the seam stays clean.
 */
import { db } from '@/data/db';
import { CLOUD_DATABASE_URL, DEPLOYMENT, MEDIA_WORKER_URL } from '@/build-info';
import { sweepOrphanedBlobsQuietly, type BlobSweep } from '../blob-sweep';
import { runDownloadQueue, runUploadQueue, type TransferSummary } from './media-queue';
import { createWorkerBackend } from './worker-backend';
import type { SyncEnvironment } from './backend';

/** Why a run could not start. `undefined` means it can. */
export type MediaSyncBlocker = 'not-configured' | 'signed-out' | 'offline';

export interface MediaSyncResult {
  blocked?: MediaSyncBlocker;
  upload?: TransferSummary;
  download?: TransferSummary;
  /** BUG-06: bytes collected because nothing references them any more. */
  sweep?: BlobSweep;
}

/**
 * Whether media sync can run right now, and if not, why.
 *
 * Separate from running it so the UI can explain the state instead of showing
 * a button that silently does nothing. "Not configured" is a real, expected
 * answer on a dev build, not a fault.
 */
export function mediaSyncBlocker(): MediaSyncBlocker | undefined {
  if (!MEDIA_WORKER_URL) return 'not-configured';
  if (!db.cloud.currentUser?.value?.isLoggedIn) return 'signed-out';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return undefined;
}

/**
 * Push local originals up, then pull down anything this device is missing.
 *
 * Upload first, deliberately. A device holding the only copy of a photo should
 * get it somewhere safe before spending bandwidth fetching copies of things
 * that are already safe elsewhere.
 */
export async function runMediaSync(): Promise<MediaSyncResult> {
  const blocked = mediaSyncBlocker();
  if (blocked) {
    console.info('[sync] media run skipped', { reason: blocked });
    return { blocked };
  }

  const user = db.cloud.currentUser.value;
  const account = user?.userId ?? user?.email;
  if (!account) return { blocked: 'signed-out' };

  // NFR-13: the identity block every log line carries. A run that does not say
  // which account, bucket and tier it touched cannot be diagnosed afterwards.
  const env: SyncEnvironment = {
    account,
    databaseUrl: CLOUD_DATABASE_URL,
    bucket: MEDIA_WORKER_URL,
    environment: DEPLOYMENT,
  };

  const backend = createWorkerBackend({
    workerUrl: MEDIA_WORKER_URL,
    account,
    // Read fresh each call: a long backfill outlives one access token.
    getAccessToken: () => db.cloud.currentUser?.value?.accessToken,
  });

  const deps = { db, backend, env };
  const upload = await runUploadQueue(deps);
  const download = await runDownloadQueue(deps);

  // BUG-06, spec 012. At the end of the run, when records and bytes have just
  // been reconciled - which is the moment a delete that arrived from another
  // device has left a blob here with nothing pointing at it.
  const sweep = await sweepOrphanedBlobsQuietly(db);

  console.info('[sync] media run complete', { ...env, upload, download, sweep });
  return { upload, download, sweep };
}

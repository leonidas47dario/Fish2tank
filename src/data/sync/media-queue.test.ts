import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fish2TankDB } from '../db';
import type { Media } from '@/domain/types';
import { objectKeyFor, type MediaBackend, type ObjectHead, type SyncEnvironment } from './backend';
import { createSyncLogger } from './sync-log';
import { runDownloadQueue, runUploadQueue, transferOrder } from './media-queue';
import { WorkerCallError } from './worker-backend';

const ENV: SyncEnvironment = {
  account: 'acct_1',
  databaseUrl: 'https://example.dexie.cloud',
  bucket: 'fish2tank-media',
  environment: 'test',
};

/** Silent unless a test asks; keeps the suite output readable. */
const quietLogger = () =>
  createSyncLogger(ENV, { info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/**
 * An in-memory stand-in for R2, with the knobs the failure tests need:
 * corrupt the stored size, reject a PUT, or make an object vanish.
 */
function fakeBackend() {
  const objects = new Map<string, { bytes: number }>();
  let putStatus = 200;
  /** Bytes to record instead of what was actually sent. */
  let corruptTo: number | undefined;
  let swallow = false;
  /** Serve fewer bytes than `head` advertises, i.e. a truncated response. */
  let truncateTo: number | undefined;

  const backend: MediaBackend = {
    presignPut: async (key) => ({ url: `https://fake/put/${key}`, expiresAt: 'later' }),
    presignGet: async (key) => ({ url: `https://fake/get/${key}`, expiresAt: 'later' }),
    head: async (key): Promise<ObjectHead | undefined> => objects.get(key),
  };

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (init?.method === 'PUT') {
      if (putStatus !== 200) return { ok: false, status: putStatus } as Response;
      const key = href.replace('https://fake/put/', '');
      const body = init.body as Blob;
      if (!swallow) objects.set(key, { bytes: corruptTo ?? body.size });
      return { ok: true, status: 200 } as Response;
    }
    const key = href.replace('https://fake/get/', '');
    const found = objects.get(key);
    if (!found) return { ok: false, status: 404 } as Response;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(truncateTo ?? found.bytes),
    } as Response;
  }) as unknown as typeof fetch;

  return {
    backend,
    fetchImpl,
    objects,
    rejectPuts: (status: number) => { putStatus = status; },
    corruptStoredSizeTo: (n: number) => { corruptTo = n; },
    swallowPuts: () => { swallow = true; },
    truncateDownloadsTo: (n: number) => { truncateTo = n; },
  };
}

let db: Fish2TankDB;

async function seedMedia(over: Partial<Media> = {}): Promise<Media> {
  const media: Media = {
    id: 'med_1',
    kind: 'photo',
    specimenIds: ['spec_1'],
    originalBlobKey: 'blob_orig',
    originalBytes: 900,
    mimeType: 'image/jpeg',
    previewBlobKey: 'blob_prev',
    thumbnailBlobKey: 'blob_thumb',
    capturedAt: '2026-08-29T00:00:00.000Z',
    syncState: 'local-draft',
    ...over,
  };
  await db.media.put(media);
  const at = '2026-08-29T00:00:00.000Z';
  await db.blobs.bulkPut([
    { key: 'blob_orig', data: new ArrayBuffer(900), bytes: 900, mimeType: 'image/jpeg', storedAt: at },
    { key: 'blob_prev', data: new ArrayBuffer(300), bytes: 300, mimeType: 'image/jpeg', storedAt: at },
    { key: 'blob_thumb', data: new ArrayBuffer(90), bytes: 90, mimeType: 'image/jpeg', storedAt: at },
  ]);
  return media;
}

beforeEach(async () => {
  db = new Fish2TankDB(`media-sync-${crypto.randomUUID()}`);
  await db.open();
});

describe('transferOrder', () => {
  it('sends the cheapest bytes first so a new device is usable fast', () => {
    const media = { thumbnailBlobKey: 't', previewBlobKey: 'p', originalBlobKey: 'o' } as Media;
    expect(transferOrder(media)).toEqual(['t', 'p', 'o']);
  });

  it('omits derivatives that were never generated', () => {
    const media = { originalBlobKey: 'o' } as Media;
    expect(transferOrder(media)).toEqual(['o']);
  });
});

describe('runUploadQueue', () => {
  it('uploads every blob and marks the row synced once all verify', async () => {
    await seedMedia();
    const fake = fakeBackend();
    const summary = await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    expect(summary.uploaded).toBe(3);
    expect(summary.failed).toBe(0);
    expect((await db.media.get('med_1'))!.syncState).toBe('synced');
    expect([...fake.objects.keys()]).toContain(objectKeyFor('acct_1', 'blob_orig'));
  });

  it('NEVER marks synced when the store holds a different size than was sent', async () => {
    await seedMedia();
    const fake = fakeBackend();
    fake.corruptStoredSizeTo(12); // a truncated write that still returned 200

    const summary = await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    expect(summary.failed).toBeGreaterThan(0);
    expect((await db.media.get('med_1'))!.syncState).toBe('retry-required');
  });

  it('NEVER marks synced when a 200 was returned but nothing was stored', async () => {
    await seedMedia();
    const fake = fakeBackend();
    fake.swallowPuts(); // the exact DW_SYNC shape: success reported, no effect

    const summary = await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    expect(summary.uploaded).toBe(0);
    expect(summary.failed).toBe(3);
    expect((await db.media.get('med_1'))!.syncState).toBe('retry-required');
  });

  it('leaves the row retryable when the signature is rejected', async () => {
    await seedMedia();
    const fake = fakeBackend();
    fake.rejectPuts(403);

    await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });
    expect((await db.media.get('med_1'))!.syncState).toBe('retry-required');
  });

  it('resumes: a second run after a failure completes the transfer', async () => {
    await seedMedia();
    const fake = fakeBackend();
    fake.rejectPuts(403);
    await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });
    expect((await db.media.get('med_1'))!.syncState).toBe('retry-required');

    fake.rejectPuts(200);
    const second = await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    expect(second.uploaded).toBe(3);
    expect((await db.media.get('med_1'))!.syncState).toBe('synced');
  });

  it('skips a missing derivative without failing the row', async () => {
    await seedMedia();
    await db.blobs.delete('blob_prev');
    const fake = fakeBackend();

    const summary = await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
    expect((await db.media.get('med_1'))!.syncState).toBe('synced');
  });

  it('never deletes the local original on success (NFR-03)', async () => {
    await seedMedia();
    const fake = fakeBackend();
    await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });
    expect(await db.blobs.get('blob_orig')).toBeDefined();
  });

  it('leaves already-synced rows alone', async () => {
    await seedMedia({ syncState: 'synced' });
    const fake = fakeBackend();
    const summary = await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });
    expect(summary.uploaded).toBe(0);
  });
});

describe('runDownloadQueue', () => {
  it('pulls blobs this device is missing', async () => {
    await seedMedia();
    const fake = fakeBackend();
    await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    // A second device: same records, no bytes.
    await db.blobs.clear();

    const summary = await runDownloadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    expect(summary.downloaded).toBe(3);
    expect((await db.blobs.get('blob_orig'))!.bytes).toBe(900);
  });

  it('skips blobs already held locally', async () => {
    await seedMedia();
    const fake = fakeBackend();
    await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    const summary = await runDownloadQueue({ db, ...fake, env: ENV, logger: quietLogger() });
    expect(summary.downloaded).toBe(0);
    expect(summary.skipped).toBe(3);
  });

  it('refuses a short read rather than storing a truncated photo', async () => {
    await seedMedia();
    const fake = fakeBackend();
    await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });
    await db.blobs.clear();

    // The connection drops part-way: head still advertises the full object,
    // but the body arrives short. This is the case that would otherwise store
    // a truncated file and look like a corrupt original forever after.
    fake.truncateDownloadsTo(10);
    const summary = await runDownloadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    expect(summary.failed).toBe(3);
    expect(await db.blobs.get('blob_orig')).toBeUndefined();
  });

  it('is patient about media not uploaded yet', async () => {
    await seedMedia();
    const fake = fakeBackend();
    await db.blobs.clear();

    const summary = await runDownloadQueue({ db, ...fake, env: ENV, logger: quietLogger() });
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(3);
  });
});

describe('sync logging', () => {
  it('states the session identity so a wrong-tier run is visible', async () => {
    const info = vi.fn();
    await seedMedia();
    const fake = fakeBackend();
    await runUploadQueue({
      db, ...fake, env: ENV,
      logger: createSyncLogger(ENV, { info, warn: vi.fn(), error: vi.fn() }),
    });

    const lines = info.mock.calls.map((c) => String(c[0]));
    expect(lines[0]).toContain('account=acct_1');
    expect(lines[0]).toContain('bucket=fish2tank-media');
    expect(lines[0]).toContain('env=test');
  });

  it('logs an outcome for every intent, not just the attempt', async () => {
    const info = vi.fn();
    const error = vi.fn();
    await seedMedia();
    const fake = fakeBackend();
    fake.corruptStoredSizeTo(1);

    await runUploadQueue({
      db, ...fake, env: ENV,
      logger: createSyncLogger(ENV, { info, warn: vi.fn(), error }),
    });

    const failures = error.mock.calls.map((c) => String(c[0]));
    expect(failures.length).toBe(3);
    expect(failures[0]).toContain('-> failed');
    expect(failures[0]).toContain('store holds 1B');
  });
});

/**
 * The one line no other test touches.
 *
 * Every test above injects `fetchImpl`, so the default was never exercised -
 * and the default was wrong. `fetch` captured into a variable and then called
 * as `deps.fetchImpl(...)` arrives with `this` set to the deps object, which
 * the browser refuses. It failed 28 uploads out of 28 on UAT while every test
 * here stayed green.
 */
describe('the default fetch', () => {
  it('is bound to the global, because a method call is an Illegal invocation', async () => {
    await seedMedia();
    const fake = fakeBackend();

    // Node does not enforce the browser's rule, so reproduce it.
    vi.stubGlobal('fetch', function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return fake.fetchImpl(...args);
    });

    try {
      // Deliberately no fetchImpl.
      const summary = await runUploadQueue({
        db, backend: fake.backend, env: ENV, logger: quietLogger(),
      });
      expect(summary.failed).toBe(0);
      expect(summary.uploaded).toBe(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * The failure that cost an hour on 2026-08-30.
 *
 * Production's media Worker had never been deployed. Its workers.dev URL
 * answered Cloudflare's own "no Worker here" - a plain-text `error code: 1042`
 * with a 404, not a response from this app - so every photo failed, and the
 * account panel said they "will be retried". Every retry failed identically
 * while the screen kept promising the next one would not.
 *
 * The counts were right and the conclusion drawn from them was wrong, so these
 * pin the reason travelling with the counts.
 */
describe('a failure that retrying cannot fix', () => {
  /** A backend whose presign calls 404, the way an undeployed Worker does. */
  function undeployedBackend(message = '/presign/put failed: 404 Not Found'): MediaBackend {
    const fail = () => { throw new WorkerCallError(404, '/presign/put', message); };
    return { presignPut: fail, presignGet: fail, head: fail };
  }

  it('marks a 404 from the Worker as a configuration fault', async () => {
    await seedMedia();
    const summary = await runUploadQueue({
      db, backend: undeployedBackend(), fetchImpl: fakeBackend().fetchImpl,
      env: ENV, logger: quietLogger(),
    });

    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.configurationFault).toBe(true);
    // And the verbatim reason, for whoever has to fix it.
    expect(summary.firstError).toMatch(/404/);
  });

  it('leaves the photo retryable, because the bytes are still the only copy', async () => {
    await seedMedia();
    await runUploadQueue({
      db, backend: undeployedBackend(), fetchImpl: fakeBackend().fetchImpl,
      env: ENV, logger: quietLogger(),
    });

    expect((await db.media.get('med_1'))!.syncState).toBe('retry-required');
    expect(await db.blobs.get('blob_orig')).toBeDefined();
  });

  /**
   * A rejected PUT is a different animal: the Worker answered, signed a URL,
   * and the upload itself failed. That genuinely may work next time, and must
   * not be reported as somebody's deployment mistake.
   */
  it('does not call an ordinary upload failure a configuration fault', async () => {
    await seedMedia();
    const fake = fakeBackend();
    fake.rejectPuts(500);
    const summary = await runUploadQueue({ db, ...fake, env: ENV, logger: quietLogger() });

    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.configurationFault).toBeFalsy();
  });

  it('keeps the first reason, not the last', async () => {
    await seedMedia();
    let n = 0;
    const backend: MediaBackend = {
      presignPut: () => { throw new WorkerCallError(404, '/presign/put', `failure ${++n}`); },
      presignGet: async (key) => ({ url: `https://fake/get/${key}`, expiresAt: 'later' }),
      head: async () => undefined,
    };
    const summary = await runUploadQueue({
      db, backend, fetchImpl: fakeBackend().fetchImpl, env: ENV, logger: quietLogger(),
    });

    // Twenty-eight failures with one cause are one problem; the first is the
    // one not yet coloured by what the failure did to the next attempt.
    expect(summary.firstError).toBe('failure 1');
    expect(summary.failed).toBe(3);   // one per blob on the row
  });
});

describe('WorkerCallError', () => {
  it.each([[404], [401], [403]])('treats %i as something only a person can fix', (status) => {
    expect(new WorkerCallError(status, '/presign/put', 'x').isConfiguration).toBe(true);
  });

  it.each([[500], [502], [429]])('treats %i as worth retrying', (status) => {
    expect(new WorkerCallError(status, '/presign/put', 'x').isConfiguration).toBe(false);
  });
});

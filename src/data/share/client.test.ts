/**
 * Publishing and revoking, and the verification that makes either believable.
 *
 * The tests that matter here are the ones about NOT reporting success. Every
 * defect this project has shipped in the sync area was a green status over
 * nothing: a run recorded as success with the data stranded, a screen offering
 * to retry against a Worker that had never been deployed. So the write and the
 * delete are both asserted to fail loudly when the thing they claim to have
 * done did not happen.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fish2TankDB } from '../db';
import { needsUpload } from '../sync/media-queue';
import { linkFor, publishTank, revokeTank } from './client';
import { recordShare, shareFor } from './shares';
import type { Aquarium, Holding, Media, Residency } from '@/domain/types';

const WORKER = 'https://worker.example';

let db: Fish2TankDB;

beforeEach(async () => {
  db = new Fish2TankDB(`share-client-${crypto.randomUUID()}`);
  await db.open();

  await db.aquariums.add({
    id: 'aq_1', name: 'Deep Sea Collector', kind: 'display', status: 'active',
    volume: { value: 75, unit: 'gal' }, createdAt: '2026-01-01T00:00:00.000Z',
  } as Aquarium);
  await db.holdings.add({
    id: 'h_1', speciesId: 'sp_betta', rawLabel: 'Betta', kind: 'fish',
    openingQuantity: 2, acquiredOn: '2026-01-02',
  } as unknown as Holding);
  await db.residencies.add({
    id: 'res_1', holdingId: 'h_1', aquariumId: 'aq_1', startDate: '2026-01-02',
  } as Residency);
});

/**
 * A Worker that behaves. Each route can be overridden per test, which is how
 * the failure cases are built without a second fake.
 */
function fakeWorker(over: {
  publish?: () => Response;
  read?: () => Response;
  del?: () => Response;
  head?: () => Response;
  /** The unfurlable preview, `/p/:token` - spec 054. */
  preview?: () => Response;
} = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const published: Record<string, unknown> = {};

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? String(init.body) : undefined });

    if (/\/p\/[^/]+$/.test(url)) {
      // Default: the route is live and returns HTML, which is what a deployed
      // Worker does. The tests that matter override it.
      return over.preview?.() ?? new Response('<html></html>', {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (url.endsWith('/head')) {
      return over.head?.() ?? Response.json({ present: true, bytes: 10 });
    }
    if (url.endsWith('/shared') && method === 'POST') {
      const snapshot = JSON.parse(String(init?.body)) as { token: string };
      published[snapshot.token] = snapshot;
      return over.publish?.() ?? Response.json({ ok: true, token: snapshot.token });
    }
    if (method === 'DELETE') {
      const token = url.split('/').pop()!;
      const response = over.del?.() ?? Response.json({ ok: true });
      if (response.ok) delete published[token];
      return response;
    }
    // GET /shared/{token} - the public read, as a stranger performs it.
    if (over.read) return over.read();
    const token = url.split('/').pop()!;
    const snapshot = published[token];
    return snapshot === undefined
      ? new Response(null, { status: 404 })
      : Response.json(snapshot);
  });

  return { impl: impl as unknown as typeof fetch, calls };
}

const deps = (fetchImpl: typeof fetch) => ({
  db, workerUrl: WORKER, fetchImpl,
  getAccessToken: () => 'a-token',
  account: 'ryan@example.com',
});

describe('publishTank', () => {
  it('publishes the tank and remembers the link', async () => {
    const worker = fakeWorker();
    const result = await publishTank('aq_1', deps(worker.impl));

    expect(result.token).toMatch(/^[0-9a-f-]{36}$/);
    // Spec 054: the Worker's preview route, so the link unfurls as the tank.
    // The fragment form is still what a person lands on, and is still what
    // this returns when the Worker does not serve the preview - see "the link
    // a keeper is handed" below.
    expect(result.url).toContain(`/p/${result.token}`);
    expect(result.warnings).toEqual([]);

    const record = await shareFor('aq_1', db);
    expect(record?.token).toBe(result.token);
    expect(record?.fingerprint).toBeTruthy();
  });

  it('sends the residents a guest should see, and no private record', async () => {
    const worker = fakeWorker();
    await publishTank('aq_1', deps(worker.impl));

    const sent = worker.calls.find((c) => c.method === 'POST' && c.url.endsWith('/shared'))!;
    const snapshot = JSON.parse(sent.body!) as { residents: unknown[]; stats: { fish: number } };
    expect(snapshot.residents).toHaveLength(1);
    expect(snapshot.stats.fish).toBe(2);
    expect(sent.body).not.toContain('h_1');
  });

  /**
   * The link is already in somebody's messages by the time this runs a second
   * time. A fresh token per publish would break every copy of it, silently.
   */
  it('reuses the token when republishing, so a link already sent keeps working', async () => {
    const worker = fakeWorker();
    const first = await publishTank('aq_1', deps(worker.impl));
    const second = await publishTank('aq_1', deps(worker.impl));

    expect(second.token).toBe(first.token);
    expect(await db.shares.count()).toBe(1);
  });

  it('refuses to report success when the page cannot be read back', async () => {
    const worker = fakeWorker({ read: () => new Response(null, { status: 404 }) });

    await expect(publishTank('aq_1', deps(worker.impl))).rejects.toThrow(/could not be read back/i);
    // And nothing is recorded, so the UI never claims a link that does not work.
    expect(await shareFor('aq_1', db)).toBeUndefined();
  });

  it('refuses to report success when the page served is a different tank', async () => {
    const worker = fakeWorker({
      read: () => Response.json({ tank: { name: 'Somebody Else\'s 40 Breeder' }, residents: [] }),
    });

    await expect(publishTank('aq_1', deps(worker.impl))).rejects.toThrow(/does not match/i);
    expect(await shareFor('aq_1', db)).toBeUndefined();
  });

  it('carries the Worker\'s own reason when it rejects the write', async () => {
    const worker = fakeWorker({
      publish: () => Response.json({ error: 'origin not allowed' }, { status: 403 }),
    });

    await expect(publishTank('aq_1', deps(worker.impl)))
      .rejects.toThrow(/403 origin not allowed/);
  });
});

describe('publishTank and the tank photo', () => {
  beforeEach(async () => {
    /*
     * A preview, deliberately - spec 064. A 3.6 MB original is over
     * PREVIEW_EDGE so it HAS one, and that is the photo this suite is about:
     * these tests are checking the HEAD-before-publish rule, not the strip.
     * Without the preview key they would exercise the strip path instead and
     * fail for a reason that has nothing to do with what they assert.
     */
    await db.media.add({
      id: 'media_1', kind: 'photo', specimenIds: [], originalBlobKey: 'blob_tank',
      previewBlobKey: 'blob_tank_preview',
      originalBytes: 3_600_000, mimeType: 'image/jpeg',
      capturedAt: '2026-01-03T00:00:00.000Z', syncState: 'synced',
    } as Media);
    await db.aquariums.update('aq_1', { photoMediaId: 'media_1' });
  });

  it('publishes the photo key once R2 confirms it holds the bytes', async () => {
    const worker = fakeWorker();
    const result = await publishTank('aq_1', deps(worker.impl));

    expect(result.warnings).toEqual([]);
    const sent = worker.calls.find((c) => c.method === 'POST' && c.url.endsWith('/shared'))!;
    const snapshot = JSON.parse(sent.body!) as { allowedBlobKeys: string[] };
    expect(snapshot.allowedBlobKeys).toEqual(['blob_tank_preview']);
    expect((await shareFor('aq_1', db))?.photoIncluded).toBe(true);
  });

  /**
   * The alternative is a torn image on a stranger's screen and no way for the
   * keeper to find out. Publishing without the photo and saying so is the only
   * honest option, and it is what makes the sheet able to explain itself.
   */
  it('publishes without the photo, and says why, when the bytes have not synced', async () => {
    const worker = fakeWorker({ head: () => Response.json({ present: false }) });
    const result = await publishTank('aq_1', deps(worker.impl));

    expect(result.warnings.join(' ')).toMatch(/not finished syncing/i);
    const sent = worker.calls.find((c) => c.method === 'POST' && c.url.endsWith('/shared'))!;
    const snapshot = JSON.parse(sent.body!) as { allowedBlobKeys: string[]; tank: { photoBlobKey?: string } };
    expect(snapshot.allowedBlobKeys).toEqual([]);
    expect(snapshot.tank.photoBlobKey).toBeUndefined();
    expect((await shareFor('aq_1', db))?.photoIncluded).toBe(false);
  });

  /**
   * Spec 067, and the case that most needs it: a device that stripped a copy
   * BEFORE the fix shipped.
   *
   * Its row already carries a `previewBlobKey` pointing at a blob only that
   * device holds, so `publishableKeyFor` takes its cheap path - returns the
   * key, writes nothing, reopens nothing. Fixing only the strip path would
   * have left every already-bitten keeper dropping the photograph forever,
   * which is the population the report came from. `headBlob` is the only thing
   * that knows the difference, so the recovery hangs off its answer.
   */
  it('reopens the row when R2 does not hold a preview it already had, with nothing stripped', async () => {
    const worker = fakeWorker({ head: () => Response.json({ present: false }) });

    // previewBlobKey is already set by the fixture, and syncState is 'synced'.
    const result = await publishTank('aq_1', deps(worker.impl));

    expect(result.warnings.join(' ')).toMatch(/not finished syncing/i);
    const row = (await db.media.get('media_1'))!;
    expect(row.previewBlobKey).toBe('blob_tank_preview');   // nothing stripped
    expect(needsUpload(row)).toBe(true);                    // and yet queued
  });

  /**
   * Spec 067. The photo that HAS no preview - the one spec 064 strips on the
   * spot - and the recovery that was not possible before it.
   *
   * The first publish still goes out without the photograph: the stripped copy
   * exists only on this device, and spec 026's rule is that a key is published
   * only once R2 confirms it. What changed is that the row is now REOPENED, so
   * the upload queue carries the new bytes and the keeper's next publish has a
   * photo. Before this, the row stayed `synced`, the queue never looked at it
   * again, and the warning's advice - sync, then update the shared page - was
   * something the app could not act on however many times it was followed.
   */
  it('reopens the row for upload when it had to strip a copy, so a re-share carries it', async () => {
    await db.media.update('media_1', { previewBlobKey: undefined });
    await db.blobs.add({
      key: 'blob_tank', data: new Uint8Array([0xFF, 0xD8, 0x42, 0x42]).buffer,
      bytes: 4, mimeType: 'image/jpeg', storedAt: '2026-01-03T00:00:00.000Z',
    } as never);

    const stripped = { key: 'blob_stripped', bytes: 3 };
    const canvas = {
      decode: async () => ({ width: 800, height: 600 }),
      encode: async () => new Uint8Array([0xFF, 0xD8, 0x00]).buffer,
      newKey: () => stripped.key,
    };

    const worker = fakeWorker({ head: () => Response.json({ present: false }) });
    const first = await publishTank('aq_1', { ...deps(worker.impl), derive: canvas });
    expect(first.warnings.join(' ')).toMatch(/not finished syncing/i);

    const row = (await db.media.get('media_1'))!;
    expect(row.previewBlobKey).toBe(stripped.key);
    // The assertion that matters: the queue will pick this row up again.
    expect(needsUpload(row)).toBe(true);

    // And once it has, the photograph is in the share.
    const settled = fakeWorker();
    const second = await publishTank('aq_1', { ...deps(settled.impl), derive: canvas });
    expect(second.warnings).toEqual([]);
    const sent = settled.calls.find((c) => c.method === 'POST' && c.url.endsWith('/shared'))!;
    const snapshot = JSON.parse(sent.body!) as { tank: { photoBlobKey?: string } };
    expect(snapshot.tank.photoBlobKey).toBe(stripped.key);
  });
});

describe('revokeTank', () => {
  it('takes the page down and forgets the link', async () => {
    const worker = fakeWorker();
    await publishTank('aq_1', deps(worker.impl));

    await revokeTank('aq_1', deps(worker.impl));

    expect(await shareFor('aq_1', db)).toBeUndefined();
    expect(worker.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  /**
   * The local record is the only route back to the button that turns a link
   * off. Forgetting it while the page is still live would strand a public
   * tank with nothing in the app admitting it exists.
   */
  it('keeps the local record when the page is still answering', async () => {
    const worker = fakeWorker({ del: () => Response.json({ ok: true }) });
    await recordShare('aq_1', {
      token: 'still-live-token', publishedAt: 'then', fingerprint: 'fp', photoIncluded: false,
    }, db);

    // The delete "succeeds" but the read still serves the page.
    const stubborn = fakeWorker({
      del: () => Response.json({ ok: true }),
      read: () => Response.json({ tank: { name: 'Deep Sea Collector' } }),
    });

    await expect(revokeTank('aq_1', deps(stubborn.impl))).rejects.toThrow(/still live/i);
    expect(await shareFor('aq_1', db)).toBeDefined();
    expect(worker.calls).toBeDefined();
  });

  it('is a no-op for a tank that was never shared', async () => {
    const worker = fakeWorker();
    await expect(revokeTank('aq_1', deps(worker.impl))).resolves.toBeUndefined();
    expect(worker.calls).toHaveLength(0);
  });
});

describe('the link a keeper is handed', () => {
  /*
   * Spec 054 routes share links through the Worker, but the site and the
   * Worker deploy separately - so there is a window where the app is new and
   * the Worker is old. On 2026-09-10 that window was real in uat: the Worker
   * deploy failed on an expired Cloudflare token and every new share link
   * would have been a JSON 404.
   */
  it('stores the verified link on the record, so the UI cannot re-derive a dead one', async () => {
    /*
     * The hole in the first version of this fix. publishTank checked the link
     * and returned a good one - and ShareSheet went on calling shareUrlFor
     * directly in three places, re-deriving the /p/ URL from the stored token
     * and handing out a 404 anyway. The check is worth nothing unless what it
     * checked is what gets stored.
     */
    const worker = fakeWorker({
      preview: () => Response.json({ error: 'no such route' }, { status: 404 }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await publishTank('aq_1', deps(worker.impl));
    const record = await shareFor('aq_1', db);
    expect(record?.url).toBe(result.url);
    expect(linkFor(record!)).toMatch(/#\/share\//);
    warn.mockRestore();
  });

  it('falls back to the app link for a record written before the URL was stored', async () => {
    // Rows predating spec 054 carry a token and no url.
    expect(linkFor({ token: 'tok-1' })).toMatch(/#\/share\/tok-1$/);
  });

  it('hands out the preview URL when the Worker actually serves it', async () => {
    const worker = fakeWorker({
      preview: () => new Response('<html></html>', {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    });
    const result = await publishTank('aq_1', deps(worker.impl));
    expect(result.url).toMatch(/\/p\//);
  });

  it('FALLS BACK to the app link when the preview route is not deployed yet', async () => {
    const worker = fakeWorker({
      preview: () => Response.json({ error: 'no such route' }, { status: 404 }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await publishTank('aq_1', deps(worker.impl));
    expect(result.url).toMatch(/#\/share\//);
    expect(result.url).not.toMatch(/\/p\//);
    warn.mockRestore();
  });

  it('falls back rather than throwing when the preview route cannot be reached', async () => {
    const worker = fakeWorker({ preview: () => { throw new Error('offline'); } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await publishTank('aq_1', deps(worker.impl));
    expect(result.url).toMatch(/#\/share\//);
    warn.mockRestore();
  });
});

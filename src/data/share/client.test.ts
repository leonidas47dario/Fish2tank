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
import { publishTank, revokeTank } from './client';
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
} = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const published: Record<string, unknown> = {};

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? String(init.body) : undefined });

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
    expect(result.url).toContain(`#/share/${result.token}`);
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
    await db.media.add({
      id: 'media_1', kind: 'photo', specimenIds: [], originalBlobKey: 'blob_tank',
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
    expect(snapshot.allowedBlobKeys).toEqual(['blob_tank']);
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

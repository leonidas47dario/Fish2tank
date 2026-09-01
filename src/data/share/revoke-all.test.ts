import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fish2TankDB } from '../db';
import { revokeEveryShare } from './revoke-all';
import { ERASED_TABLES } from '../portability/erase';

/**
 * BUG-11 and the rule behind it (spec 028): a `shares` row must not be
 * destroyed while the page it names is live. The row holds the token and the
 * token is the only way to take a page down, so getting this order wrong
 * leaves a stranger's page serving forever with nothing able to stop it.
 */

let db: Fish2TankDB;

beforeEach(async () => {
  db = new Fish2TankDB(`test_${crypto.randomUUID()}`);
  await db.open();
});

async function share(aquariumId: string, name: string) {
  await db.aquariums.add({
    id: aquariumId, name, kind: 'display', status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  await db.shares.put({
    aquariumId,
    token: `tok_${aquariumId}`,
    publishedAt: '2026-09-01T00:00:00.000Z',
    fingerprint: 'f',
    photoIncluded: false,
  } as never);
}

/**
 * A stand-in Worker. `revokeTank` sends a DELETE and then re-reads the page as
 * a stranger would, so a convincing fake has to answer both: 200 to the
 * delete, then 404 to prove the link is actually dead.
 */
const worker = (behaviour: (method: string) => Response) => ({
  workerUrl: 'https://worker.test',
  getAccessToken: () => 'token',
  fetchImpl: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    behaviour(init?.method ?? 'GET')) as never,
});

describe('revokeEveryShare (spec 028)', () => {
  it('is a no-op when nothing is published', async () => {
    expect(await revokeEveryShare(db, worker(() => new Response(null, { status: 500 }))))
      .toEqual({ revoked: [], failed: [] });
  });

  it('takes down every published tank', async () => {
    await share('aq_1', 'Peaceful Garden');
    await share('aq_2', 'The Nursery');

    const result = await revokeEveryShare(db, worker((method) =>
      method === 'DELETE' ? new Response(null, { status: 200 }) : new Response(null, { status: 404 })));

    expect(result.failed).toEqual([]);
    expect(result.revoked.sort()).toEqual(['aq_1', 'aq_2']);
  });

  it('reports the survivors BY NAME rather than throwing on the first', async () => {
    // A keeper with a partial failure needs to know which tank is still
    // public. An aquarium id is not something anyone holding a phone can act
    // on, and an exception on the first failure hides the rest entirely.
    await share('aq_1', 'Peaceful Garden');
    await share('aq_2', 'The Nursery');

    let deletes = 0;
    const result = await revokeEveryShare(db, worker((method) => {
      if (method !== 'DELETE') return new Response(null, { status: 404 });
      deletes += 1;
      // The second tank's DELETE is refused, so its read-back never happens.
      return deletes > 1 ? new Response('nope', { status: 503 }) : new Response(null, { status: 200 });
    }));

    expect(result.revoked.length + result.failed.length).toBe(2);
    expect(result.failed[0]!.name).toBeTruthy();
    expect(result.failed[0]!.name).not.toBe(result.failed[0]!.aquariumId);
  });

  it('reports a failure rather than a revoke when signed out', async () => {
    await share('aq_1', 'Peaceful Garden');

    const result = await revokeEveryShare(db, {
      workerUrl: 'https://worker.test',
      getAccessToken: () => undefined as never,
      fetchImpl: vi.fn() as never,
    });

    expect(result.revoked).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toMatch(/sign in/i);
  });
});

describe('the ordering rule itself (BUG-11)', () => {
  it('erase clears `shares`, which is only safe because revoke runs first', () => {
    // If this ever stops being true the erase flow may skip the revoke sweep
    // without leaving a live page behind - but while it IS true, removing the
    // sweep silently strands every published tank. The assertion exists to
    // make that coupling visible at the place someone would break it.
    expect(ERASED_TABLES).toContain('shares');
  });
});

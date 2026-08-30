/**
 * The local record of which tanks are published (spec 020).
 *
 * Small, but it is what every other part of the feature asks "is this tank
 * shared?", so the one-per-tank rule is worth pinning down: a second token for
 * a tank nobody can see is a snapshot that keeps serving with no UI anywhere
 * offering to turn it off.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from '../db';
import { forgetShare, recordShare, shareFor, sharedTanks } from './shares';

let db: Fish2TankDB;

const record = {
  token: 'tok-1',
  publishedAt: '2026-08-30T12:00:00.000Z',
  fingerprint: 'fp-1',
  photoIncluded: true,
};

beforeEach(async () => {
  db = new Fish2TankDB(`shares-${crypto.randomUUID()}`);
  await db.open();
});

describe('the share record', () => {
  it('remembers a published tank and finds it again', async () => {
    await recordShare('aq_1', record, db);

    expect(await shareFor('aq_1', db)).toMatchObject({
      aquariumId: 'aq_1',
      token: 'tok-1',
      fingerprint: 'fp-1',
      photoIncluded: true,
    });
  });

  it('reports nothing for a tank that was never shared', async () => {
    expect(await shareFor('aq_never', db)).toBeUndefined();
  });

  it('keeps one token per tank, replacing rather than accumulating', async () => {
    await recordShare('aq_1', record, db);
    await recordShare('aq_1', { ...record, token: 'tok-2', fingerprint: 'fp-2' }, db);

    expect(await db.shares.count()).toBe(1);
    expect((await shareFor('aq_1', db))?.token).toBe('tok-2');
  });

  it('forgets a tank on revoke, and forgetting an unshared tank is not an error', async () => {
    await recordShare('aq_1', record, db);
    await forgetShare('aq_1', db);
    expect(await shareFor('aq_1', db)).toBeUndefined();

    await expect(forgetShare('aq_never', db)).resolves.toBeUndefined();
  });

  it('lists every shared tank, which is what the republisher iterates', async () => {
    await recordShare('aq_1', record, db);
    await recordShare('aq_2', { ...record, token: 'tok-2' }, db);

    const all = await sharedTanks(db);
    expect(all.map((s) => s.aquariumId).sort()).toEqual(['aq_1', 'aq_2']);
  });

  it('records the last error, and clears it on the next good publish', async () => {
    await recordShare('aq_1', { ...record, lastError: 'network' }, db);
    expect((await shareFor('aq_1', db))?.lastError).toBe('network');

    await recordShare('aq_1', record, db);
    expect((await shareFor('aq_1', db))?.lastError).toBeUndefined();
  });
});

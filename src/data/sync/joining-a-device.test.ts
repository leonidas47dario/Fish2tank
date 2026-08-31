import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from '../db';
import {
  countPendingClaim,
  discardLocalRecords,
  tablesThatWouldSyncUp,
} from './joining-a-device';

let db: Fish2TankDB;

beforeEach(async () => {
  db = new Fish2TankDB(`joining-test-${crypto.randomUUID()}`);
  await db.open();
});

/** The shape `db.cloud.schema` has once the addon has configured itself. */
const SCHEMA = {
  aquariums: { markedForSync: true },
  holdings: { markedForSync: true },
  users: { markedForSync: true },
  blobs: { markedForSync: false },
  species: { markedForSync: false },
};

describe('tablesThatWouldSyncUp', () => {
  it('names every table the addon marks for sync when nothing has synced yet', () => {
    expect(tablesThatWouldSyncUp(SCHEMA, undefined).sort())
      .toEqual(['aquariums', 'holdings', 'users']);
  });

  it('leaves out tables that have already synced, which is what stops the second push', () => {
    expect(tablesThatWouldSyncUp(SCHEMA, ['aquariums', 'users']))
      .toEqual(['holdings']);
  });

  it('never names an unsynced table, because those hold the only copy of the photos', () => {
    expect(tablesThatWouldSyncUp(SCHEMA, [])).not.toContain('blobs');
    expect(tablesThatWouldSyncUp(SCHEMA, [])).not.toContain('species');
  });

  it('is empty with no schema, so a build without the addon prompts nobody', () => {
    expect(tablesThatWouldSyncUp(null, undefined)).toEqual([]);
    expect(tablesThatWouldSyncUp(undefined, [])).toEqual([]);
  });
});

describe('countPendingClaim', () => {
  it('counts the rows this device would push over the account', async () => {
    await db.aquariums.bulkAdd([
      { id: 'tank_75g', name: '75G', kind: 'display', status: 'active', createdAt: 'then' },
      { id: 'tank_mini', name: 'Mini Tank', kind: 'display', status: 'active', createdAt: 'then' },
    ] as never);
    await db.users.add({ id: 'user_local', displayName: '', settings: {}, createdAt: 'then' } as never);

    const claim = await countPendingClaim(db, ['aquariums', 'holdings', 'users']);

    expect(claim.total).toBe(3);
    expect(claim.byTable).toEqual({ aquariums: 2, users: 1 });
  });

  it('is zero on a clean device, which is what keeps the gate a single button', async () => {
    const claim = await countPendingClaim(db, ['aquariums', 'holdings', 'users']);

    expect(claim.total).toBe(0);
    expect(claim.byTable).toEqual({});
  });
});

describe('discardLocalRecords', () => {
  async function populate(): Promise<void> {
    await db.aquariums.add({ id: 'tank_75g', name: '75G', kind: 'display', status: 'active', createdAt: 'then' } as never);
    await db.holdings.add({ id: 'h1', kind: 'group', openingQuantity: 3, openingBalance: true, createdAt: 'then' } as never);
    await db.users.add({ id: 'user_local', displayName: '', settings: {}, createdAt: 'then' } as never);
    await db.blobs.add({ key: 'b1', bytes: 1, mimeType: 'image/jpeg', storedAt: 'then' } as never);
    await db.species.add({ id: 'sp_guppy', commonName: 'Guppy' } as never);
    await db.deletedRecords.add({ id: 'gone1', kind: 'media', deletedAt: 'then' } as never);
  }

  it('empties the tables that would otherwise be claimed', async () => {
    await populate();

    const result = await discardLocalRecords(db, ['aquariums', 'holdings', 'users']);

    expect(await db.aquariums.count()).toBe(0);
    expect(await db.holdings.count()).toBe(0);
    expect(await db.users.count()).toBe(0);
    expect(result.cleared).toEqual({ aquariums: 1, holdings: 1, users: 1 });
    expect(result.total).toBe(3);
  });

  it('does not touch a table it was not given, because blobs are the only copy', async () => {
    await populate();

    await discardLocalRecords(db, ['aquariums', 'holdings', 'users']);

    expect(await db.blobs.count()).toBe(1);
    expect(await db.species.count()).toBe(1);
    expect(await db.deletedRecords.count()).toBe(1);
  });

  it('silences change tracking, so the clear cannot become a cloud deletion', async () => {
    await populate();

    const result = await discardLocalRecords(db, ['aquariums']);

    // Read back rather than assumed: without this flag the addon records a
    // delete mutation per row and replays it at the next sync, which would
    // erase the account instead of leaving it alone.
    expect(result.changeTrackingSilenced).toBe(true);
  });

  it('refuses a table that is not in the schema rather than skipping it', async () => {
    await expect(discardLocalRecords(db, ['aquariums', 'nonesuch']))
      .rejects.toThrow(/nonesuch/);
  });

  it('does nothing and says so when there is nothing to discard', async () => {
    const result = await discardLocalRecords(db, ['aquariums', 'holdings']);

    expect(result.total).toBe(0);
    expect(result.cleared).toEqual({});
  });
});

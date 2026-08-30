import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from '../db';
import { ERASED_TABLES, eraseEverything } from './erase';

let db: Fish2TankDB;

beforeEach(async () => {
  db = new Fish2TankDB(`erase-test-${crypto.randomUUID()}`);
  await db.open();
});

/** A collection with something in every table the erase is meant to reach. */
async function populate(): Promise<void> {
  await db.users.add({ id: 'u1', displayName: 'Ryan', settings: {} } as never);
  await db.places.add({ id: 'p1', name: 'Local shop' } as never);
  await db.aquariums.add({ id: 'a1', name: '75G', kind: 'tank', status: 'active', createdAt: 'now' } as never);
  await db.holdings.add({ id: 'h1', kind: 'group', openingQuantity: 3, openingBalance: true, createdAt: 'now' } as never);
  await db.residencies.add({ id: 'r1', holdingId: 'h1', aquariumId: 'a1', startDate: '2026-01-01' } as never);
  await db.specimens.add({ id: 's1', identityStatus: 'provisional', status: 'alive' } as never);
  await db.encounters.add({ id: 'e1', specimenId: 's1', observedAt: 'now' } as never);
  await db.media.add({ id: 'm1', encounterId: 'e1', kind: 'photo' } as never);
  await db.blobs.add({ key: 'b1', blob: new Blob(['x']) } as never);
  await db.draftKeys.add({ clientKey: 'd1', specimenId: 's1' } as never);
  await db.deletedRecords.add({ id: 'gone1', kind: 'media', deletedAt: 'now' } as never);
  await db.cardPrefs.add({ speciesId: 'sp_guppy', art: 'photo' } as never);
  await db.lifeEvents.add({ id: 'evt1', holdingId: 'h1', type: 'birth', occurredOn: '2026-01-01', quantityDelta: 1, createdAt: 'now' } as never);
}

describe('eraseEverything', () => {
  it('empties every personal table', async () => {
    await populate();

    const result = await eraseEverything(db);

    for (const table of ERASED_TABLES) {
      expect(await db.table(table).count(), `${table} should be empty`).toBe(0);
    }
    expect(result.total).toBeGreaterThan(0);
  });

  it('reports what it removed, per table', async () => {
    await populate();

    const result = await eraseEverything(db);

    expect(result.cleared.holdings).toBe(1);
    expect(result.cleared.residencies).toBe(1);
    expect(result.cleared.specimens).toBe(1);
    expect(result.cleared.blobs).toBe(1);
  });

  it('leaves the shipped species catalog alone, because it is not personal data', async () => {
    await db.species.bulkAdd([
      { id: 'sp_guppy', commonName: 'Guppy', origin: 'curated' },
      { id: 'sp_other', commonName: 'Tetra', origin: 'curated' },
    ] as never[]);

    await eraseEverything(db);

    expect(await db.species.count()).toBe(2);
  });

  it('removes a species the keeper typed in themselves, and its profile', async () => {
    await db.species.bulkAdd([
      { id: 'sp_guppy', commonName: 'Guppy', origin: 'curated' },
      { id: 'sp_user_1', commonName: 'Neobasher', origin: 'user-submitted' },
    ] as never[]);
    await db.speciesProfiles.bulkAdd([
      { id: 'prof_1', speciesId: 'sp_user_1' },
      { id: 'prof_2', speciesId: 'sp_guppy' },
    ] as never[]);

    const result = await eraseEverything(db);

    expect((await db.species.toArray()).map((s) => s.id)).toEqual(['sp_guppy']);
    expect((await db.speciesProfiles.toArray()).map((p) => p.speciesId)).toEqual(['sp_guppy']);
    expect(result.userSpeciesRemoved).toBe(1);
  });

  it('is safe to run on an already empty profile', async () => {
    const result = await eraseEverything(db);

    expect(result.total).toBe(0);
    expect(result.userSpeciesRemoved).toBe(0);
  });

  it('is idempotent', async () => {
    await populate();

    const first = await eraseEverything(db);
    const second = await eraseEverything(db);

    expect(first.total).toBeGreaterThan(0);
    expect(second.total).toBe(0);
  });
});

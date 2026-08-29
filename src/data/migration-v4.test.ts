/**
 * The v4 species remap - the first migration in this app that rewrites user
 * data, and therefore the one that most needs a test.
 *
 * Two species were minted from text that was never a binomial (see
 * NOT_A_SPECIES in seed/species-overrides.ts). Dropping them from the catalog
 * leaves any record on the device pointing at an id that no longer resolves,
 * so v4 moves those references. The Red Wolf Fish is a real animal that was
 * filed under a photo credit, so its references move to the catalog entry for
 * the same fish; Fish food is not an animal, so its references are cleared
 * rather than pointed at an arbitrary substitute.
 *
 * These tests open the database at v3, write the old ids, then reopen at the
 * current version so the upgrade actually runs. Asserting against a
 * hand-built v4 database would prove nothing about the migration.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from './db';
import { NOT_A_SPECIES } from './seed/species-overrides';

const OLD = 'sp_roofvissen_fotografie';
const CANONICAL = 'sp_erythrinus_erythrinus';
const FOOD = 'sp_fish_food';

let name: string;

beforeEach(() => {
  name = `migrate_${crypto.randomUUID()}`;
});

/** A v3 database holding the rows a real device would have. */
async function seedAtV3(rows: {
  specimenSpecies?: string;
  holdingSpecies?: string;
  snapshotSpecies?: string;
  priceSpecies?: string;
  dreamSpecies?: string;
  cardPrefSpecies?: string;
}) {
  const legacy = new Dexie(name);
  legacy.version(3).stores({
    users: 'id', places: 'id, name, isFavorite',
    species: 'id, commonName, scientificName', speciesProfiles: 'id, speciesId',
    specimens: 'id, speciesId, identityStatus, status, nickname',
    encounters: 'id, specimenId, placeId, observedAt, syncState',
    media: 'id, encounterId, kind, syncState, *specimenIds', blobs: 'key',
    identifications: 'id, specimenId, assertedAt',
    priceObservations: 'id, speciesId, specimenId, encounterId, observedAt',
    raritySnapshots: 'id, specimenId, speciesId, revealedAt',
    dreamList: 'id, speciesId, addedAt', aquariums: 'id, name, status',
    holdings: 'id, specimenId, speciesId, openingBalance',
    residencies: 'id, holdingId, aquariumId, startDate, endDate',
    lifeEvents: 'id, holdingId, type, occurredOn',
    assessments: 'id, specimenId, aquariumId, assessedAt',
    memorials: 'id, holdingId, specimenId, occurredOn',
    keeperPrinciples: 'id, sourceMemorialId', draftKeys: 'clientKey, specimenId',
    cardPrefs: 'speciesId', deletedRecords: 'id, deletedAt',
  });
  await legacy.open();

  if (rows.specimenSpecies) {
    await legacy.table('specimens').add({
      id: 'spec_1', kind: 'individual', speciesId: rows.specimenSpecies,
      identityStatus: 'user-confirmed', status: 'encountered',
      nickname: 'the Panther', rawLabel: 'Red Wolf Fish',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
  }
  if (rows.holdingSpecies) {
    await legacy.table('holdings').add({
      id: 'hold_1', speciesId: rows.holdingSpecies, kind: 'individual',
      openingQuantity: 1, openingBalance: true, createdAt: '2026-08-01T00:00:00.000Z',
    });
  }
  if (rows.snapshotSpecies) {
    await legacy.table('raritySnapshots').add({
      id: 'rar_1', specimenId: 'spec_1', speciesId: rows.snapshotSpecies,
      components: { marketScarcity: 0 }, totalScore: 37, tier: 'uncommon',
      formulaVersion: 'discovery-tier-v0.2.0', golden: false,
      revealedAt: '2026-08-01T00:00:00.000Z',
    });
  }
  if (rows.priceSpecies) {
    await legacy.table('priceObservations').add({
      id: 'price_1', speciesId: rows.priceSpecies, specimenId: 'spec_1',
      askingPrice: 65, currency: 'USD', observedAt: '2026-08-01T00:00:00.000Z',
    });
  }
  if (rows.dreamSpecies) {
    await legacy.table('dreamList').add({
      id: 'dream_1', speciesId: rows.dreamSpecies,
      addedAt: '2026-01-01T00:00:00.000Z', source: 'manual',
    });
  }
  if (rows.cardPrefSpecies) {
    await legacy.table('cardPrefs').add({
      speciesId: rows.cardPrefSpecies, artSource: 'own',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
  }
  legacy.close();
}

/** Reopen at the current version, which runs the upgrade. */
async function openMigrated() {
  const db = new Fish2TankDB(name);
  await db.open();
  return db;
}

describe('v4 retires two species that were never species', () => {
  it('moves a Red Wolf Fish specimen to the real Erythrinus erythrinus', async () => {
    await seedAtV3({ specimenSpecies: OLD });
    const db = await openMigrated();

    const spec = await db.specimens.get('spec_1');
    expect(spec!.speciesId).toBe(CANONICAL);
    db.close();
  });

  it('keeps everything about the record except the species reference', async () => {
    await seedAtV3({ specimenSpecies: OLD });
    const db = await openMigrated();

    const spec = await db.specimens.get('spec_1');
    // The fish, the name you gave it, and the store's wording all survive.
    expect(spec!.nickname).toBe('the Panther');
    expect(spec!.rawLabel).toBe('Red Wolf Fish');
    expect(spec!.identityStatus).toBe('user-confirmed');
    expect(spec!.createdAt).toBe('2026-08-01T00:00:00.000Z');
    db.close();
  });

  it('clears a Fish food reference rather than inventing a substitute', async () => {
    await seedAtV3({ specimenSpecies: FOOD });
    const db = await openMigrated();

    const spec = await db.specimens.get('spec_1');
    expect(spec!.speciesId).toBeUndefined();
    // The record itself is not deleted. Something was photographed.
    expect(spec).toBeDefined();
    db.close();
  });

  it.each([
    ['holdings', 'hold_1', { holdingSpecies: OLD }],
    ['raritySnapshots', 'rar_1', { snapshotSpecies: OLD }],
    ['priceObservations', 'price_1', { priceSpecies: OLD }],
    ['dreamList', 'dream_1', { dreamSpecies: OLD }],
  ] as const)('remaps %s too, so no table is left dangling', async (table, id, rows) => {
    await seedAtV3(rows);
    const db = await openMigrated();

    const row = await db.table(table).get(id);
    expect(row.speciesId).toBe(CANONICAL);
    db.close();
  });

  /**
   * cardPrefs is keyed BY speciesId, so it cannot be updated in place - Dexie
   * will not move a primary key. It is a delete-and-reinsert, and getting that
   * wrong would either lose the preference or leave a duplicate behind.
   */
  it('moves a card preference despite speciesId being its primary key', async () => {
    await seedAtV3({ cardPrefSpecies: OLD });
    const db = await openMigrated();

    expect(await db.cardPrefs.get(OLD)).toBeUndefined();
    expect((await db.cardPrefs.get(CANONICAL))!.artSource).toBe('own');
    db.close();
  });

  it('is a no-op on a database that never held either id', async () => {
    await seedAtV3({ specimenSpecies: 'sp_jaguar_cichlid' });
    const db = await openMigrated();

    expect((await db.specimens.get('spec_1'))!.speciesId).toBe('sp_jaguar_cichlid');
    db.close();
  });

  it('leaves no reference to any retired id anywhere', async () => {
    await seedAtV3({
      specimenSpecies: OLD, holdingSpecies: FOOD, snapshotSpecies: OLD,
      priceSpecies: FOOD, dreamSpecies: OLD, cardPrefSpecies: FOOD,
    });
    const db = await openMigrated();

    const retired = NOT_A_SPECIES.map((s) => s.speciesId);
    for (const table of ['specimens', 'holdings', 'raritySnapshots', 'priceObservations', 'dreamList', 'cardPrefs']) {
      const rows = await db.table(table).toArray();
      const stuck = rows.filter((r: { speciesId?: string }) => retired.includes(r.speciesId ?? ''));
      expect(stuck, `${table} still references a retired species`).toEqual([]);
    }
    db.close();
  });
});

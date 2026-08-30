import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { blobFor, Fish2TankDB, newId } from './db';
import {
  acquireSpecimen,
  adjustHoldingQuantity,
  stockTank,
  addEncounterChapter,
  addPhotos,
  assertIdentity,
  assessmentHistory,
  awardGolden,
  clearTankPhoto,
  createAquarium,
  createCatchDraft,
  deleteCatch,
  deleteTank,
  planDeleteTank,
  setAquariumStatus,
  setTankPhoto,
  planDeleteCatch,
  updateCatch,
  storageError,
  createKeeperPrinciple,
  createOpeningBalanceHolding,
  ensureSpecimenForHolding,
  evaluateSpecimen,
  identityHistory,
  moveHolding,
  recordDeath,
  recordPrice,
  removeHolding,
  recordStoreLabel,
  revealSpecimen,
  searchSpecies,
  submitUserSpecies,
  upsertAquarium,
  userSubmittedSpecies,
  upsertSpecies,
} from './repositories';
import { SPECIES_CATALOG, CATALOG_BY_ID } from './seed/species-catalog';
import { deriveBadge, deriveQuantity } from '@/domain/holdings';
import type { Aquarium } from '@/domain/types';

let db: Fish2TankDB;

const photo = () => ({
  kind: 'photo' as const,
  blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
  mimeType: 'image/jpeg',
});

const AQUARIUM_ADVENTURE = 'place_aquarium_adventure';

/** The real 75-gallon footprint: 48 x 18 x 21 inches. */
function seventyFive(over: Partial<Aquarium> = {}): Aquarium {
  return {
    id: 'tank_75g',
    name: '75G',
    kind: 'display',
    volume: { value: 75, unit: 'gal' },
    dimensions: {
      length: { value: 48, unit: 'in' },
      width: { value: 18, unit: 'in' },
      height: { value: 21, unit: 'in' },
    },
    status: 'active',
    stockingState: 'crowded',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  db = new Fish2TankDB(`test_${crypto.randomUUID()}`);
  await db.open();
  for (const entry of SPECIES_CATALOG) await upsertSpecies(entry.species, entry.profile, db);
  await db.places.add({
    id: AQUARIUM_ADVENTURE,
    name: 'Aquarium Adventure',
    type: 'fish-store',
    coarseLocation: 'Chicago area',
    privacy: 'private-exact',
    isFavorite: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

describe('catch drafts (FR-C02, FR-C07)', () => {
  it('creates a draft with a local id, timestamp and sync state', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1', placeId: AQUARIUM_ADVENTURE }, db);
    expect(draft.specimen.id).toMatch(/^spec_/);
    expect(draft.encounter.syncState).toBe('local-draft');
    expect(draft.encounter.observedAt).toBeTruthy();
    expect(draft.media).toHaveLength(1);
  });

  /**
   * Regression: a capture failed in the field with the message
   * "blobs.bulkAdd()." and nothing else - which names the table and says
   * nothing about what went wrong or what to do about it.
   */
  describe('when the device will not store the capture', () => {
    /** A File whose backing has gone stale, as WebKit can do between the change event and the commit. */
    const unreadable = () => ({
      kind: 'photo' as const,
      mimeType: 'image/jpeg',
      blob: {
        size: 2_400_000,
        type: 'image/jpeg',
        arrayBuffer: () => Promise.reject(Object.assign(new Error('The operation is insecure.'), { name: 'NotReadableError' })),
      } as unknown as Blob,
    });

    it('names the file and the underlying reason when the bytes cannot be read', async () => {
      await expect(createCatchDraft({ files: [unreadable()], clientKey: 'k1' }, db))
        .rejects.toThrow(/capture 1 of 1.*image\/jpeg.*2400000 bytes.*NotReadableError/s);
    });

    it('writes nothing at all when a capture cannot be read', async () => {
      await expect(createCatchDraft({ files: [unreadable()], clientKey: 'k1' }, db)).rejects.toThrow();
      // Detaching happens before the transaction opens, so there is no
      // orphaned specimen for a fish that was never saved.
      expect(await db.specimens.count()).toBe(0);
      expect(await db.blobs.count()).toBe(0);
    });

    it.each([
      ['QuotaExceededError', /out of storage/i],
      ['DataCloneError', /taking the photo again/i],
      ['InvalidStateError', /private browsing/i],
    ])('turns a %s into advice rather than a table name', (name, expected) => {
      // Dexie wraps the real cause in `.inner` and reports only the table in
      // its own message, which is what made the field report unactionable.
      const dexie = Object.assign(new Error('blobs.bulkAdd()'), {
        name: 'BulkError',
        inner: Object.assign(new Error('the store is full'), { name }),
      });
      const mapped = storageError(dexie, 2_400_000, 1);
      expect(mapped.message).toMatch(expected);
      expect(mapped.message).toContain(name);
      expect(mapped.message).toContain('2.3 MB');
      expect(mapped.cause).toBe(dexie);
    });
  });

  it('saves a Mystery Catch with no identity at all (FR-I01, principle P6)', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    expect(draft.specimen.identityStatus).toBe('unknown');
    expect(draft.specimen.speciesId).toBeUndefined();
    expect(await db.specimens.count()).toBe(1);
  });

  it('stores the original bytes untouched (NFR-03)', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    const stored = await db.blobs.get(draft.media[0]!.originalBlobKey);
    expect(stored!.bytes).toBe(4);
    expect(stored!.mimeType).toBe('image/jpeg');
    // Byte-for-byte, not merely the right length.
    expect(new Uint8Array(stored!.data!)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  /**
   * WebKit stores a Blob in IndexedDB by reference to a file it manages, and
   * reclaims that file independently of the record. A photo written today can
   * therefore read back empty tomorrow - which for this app means losing the
   * thing the record exists for.
   */
  it('holds media as bytes, never as a Blob reference', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    const stored = await db.blobs.get(draft.media[0]!.originalBlobKey);
    expect(stored!.data).toBeInstanceOf(ArrayBuffer);
    expect(stored!.blob).toBeUndefined();
  });

  it('round-trips a capture back to a readable Blob', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    const back = blobFor(await db.blobs.get(draft.media[0]!.originalBlobKey));
    expect(back).toBeInstanceOf(Blob);
    expect(back!.type).toBe('image/jpeg');
    expect(new Uint8Array(await back!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('still reads a photo saved by the previous version', async () => {
    // Anyone who caught a fish before this change has Blob-shaped records on
    // their device. Dropping them would delete their photos.
    await db.blobs.add({
      key: 'blob_legacy',
      blob: new Blob([new Uint8Array([9, 9])], { type: 'image/png' }),
      bytes: 2,
      mimeType: 'image/png',
      storedAt: new Date().toISOString(),
    });
    const back = blobFor(await db.blobs.get('blob_legacy'));
    expect(new Uint8Array(await back!.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });

  it('returns nothing, rather than throwing, for a record with neither', () => {
    expect(blobFor(undefined)).toBeUndefined();
    expect(blobFor({ key: 'k', bytes: 0, mimeType: 'image/jpeg', storedAt: 'now' })).toBeUndefined();
  });

  it('creates no duplicate catch when the same capture is retried', async () => {
    const first = await createCatchDraft({ files: [photo()], clientKey: 'retry-me' }, db);
    const second = await createCatchDraft({ files: [photo()], clientKey: 'retry-me' }, db);
    expect(second.specimen.id).toBe(first.specimen.id);
    expect(await db.specimens.count()).toBe(1);
    expect(await db.encounters.count()).toBe(1);
  });

  it('treats a genuinely separate capture as a separate catch', async () => {
    await createCatchDraft({ files: [photo()], clientKey: 'a' }, db);
    await createCatchDraft({ files: [photo()], clientKey: 'b' }, db);
    expect(await db.specimens.count()).toBe(2);
  });

  it('adds a repeat sighting as a chapter rather than a second card (FR-R03)', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    await addEncounterChapter(draft.specimen.id, { observedAt: '2026-09-15T12:00:00.000Z' }, db);
    expect(await db.specimens.count()).toBe(1);
    expect(await db.encounters.where('specimenId').equals(draft.specimen.id).count()).toBe(2);
  });
});

describe('identification (FR-I04, FR-I06)', () => {
  it('records no confidence percentage for a manual confirmation', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    const a = await assertIdentity(
      { specimenId: draft.specimen.id, speciesId: 'sp_jaguar_cichlid', source: 'user', status: 'user-confirmed', confidence: 100 },
      db,
    );
    expect(a.confidence).toBeUndefined();
  });

  it('preserves the earlier assertion when the identity is corrected', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    await assertIdentity({ specimenId: draft.specimen.id, speciesId: 'sp_jaguar_cichlid', source: 'user', status: 'user-confirmed' }, db);
    await assertIdentity({ specimenId: draft.specimen.id, speciesId: 'sp_wolf_cichlid', source: 'user', status: 'user-confirmed' }, db);

    const history = await identityHistory(draft.specimen.id, db);
    expect(history).toHaveLength(2);
    const jaguar = history.find((h) => h.candidateSpeciesId === 'sp_jaguar_cichlid')!;
    expect(jaguar.supersededByAssertionId).toBeTruthy();
    expect(jaguar.assertedAt).toBeTruthy();

    const specimen = await db.specimens.get(draft.specimen.id);
    expect(specimen!.speciesId).toBe('sp_wolf_cichlid');
  });

  it('searches common names, scientific names and store aliases (FR-I02)', async () => {
    expect((await searchSpecies('managuense', db)).map((s) => s.id)).toContain('sp_jaguar_cichlid');
    expect((await searchSpecies('Parachromis', db)).map((s) => s.id)).toHaveLength(2);
    expect(await searchSpecies('', db)).toEqual([]);
  });
});

describe('evaluation persistence (FR-E02, FR-E07)', () => {
  beforeEach(async () => {
    await upsertAquarium(seventyFive(), db);
  });

  it('refuses a verdict while the fish is unidentified (FR-I05)', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    const [result] = await evaluateSpecimen(draft.specimen.id, {}, db);
    expect(result!.verdict).toBe('insufficient-data');
  });

  it('keeps the encounter-day snapshot when the evaluation is re-run', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    await assertIdentity({ specimenId: draft.specimen.id, speciesId: 'sp_neon_tetra', source: 'user', status: 'user-confirmed' }, db);
    await evaluateSpecimen(draft.specimen.id, {}, db);
    await evaluateSpecimen(draft.specimen.id, {}, db);

    const history = await assessmentHistory(draft.specimen.id, db);
    expect(history.length).toBe(2);
    expect(history[0]!.id).not.toBe(history[1]!.id);
  });

  it('screens against live residents but ignores a holding that has reached zero', async () => {
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', speciesId: 'sp_neon_tetra', rawLabel: 'Neon Tetra', kind: 'group', openingQuantity: 6 },
      db,
    );
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    await assertIdentity({ specimenId: draft.specimen.id, speciesId: 'sp_senegal_bichir', source: 'user', status: 'user-confirmed' }, db);

    const [withTetras] = await evaluateSpecimen(draft.specimen.id, {}, db);
    expect(withTetras!.factors.find((f) => f.factor === 'predation')!.verdict).toBe('extreme-risk');

    // Wipe the group out; the bichir is no longer a predation problem here.
    await recordDeath({ holdingId: holding.id, quantity: 6 }, db);
    const [afterLoss] = await evaluateSpecimen(draft.specimen.id, {}, db);
    expect(afterLoss!.factors.find((f) => f.factor === 'predation')!.verdict).not.toBe('extreme-risk');
  });
});

describe('ownership lifecycle (FR-T01, FR-T03, FR-T06)', () => {
  beforeEach(async () => {
    await upsertAquarium(seventyFive({ stockingState: 'low' }), db);
    await upsertAquarium(seventyFive({ id: 'tank_qt', name: 'Quarantine', kind: 'quarantine' }), db);
  });

  it('advances the same specimen to resident without creating a duplicate', async () => {
    const draft = await createCatchDraft({ files: [photo()], clientKey: 'k1' }, db);
    await assertIdentity({ specimenId: draft.specimen.id, speciesId: 'sp_neon_tetra', source: 'user', status: 'user-confirmed' }, db);
    const { holding } = await acquireSpecimen(draft.specimen.id, 'tank_75g', { quantity: 1 }, db);

    expect(holding.specimenId).toBe(draft.specimen.id);
    expect(await db.specimens.count()).toBe(1);
    expect((await db.specimens.get(draft.specimen.id))!.status).toBe('resident');
    // The original encounter and its media are still attached to that specimen.
    expect(await db.encounters.where('specimenId').equals(draft.specimen.id).count()).toBe(1);
    expect(await db.media.where('encounterId').equals(draft.encounter.id).count()).toBe(1);
  });

  it('a move closes the old residency and opens a new one', async () => {
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', rawLabel: 'Pleco', kind: 'individual', openingQuantity: 1, on: '2026-01-01' },
      db,
    );
    await moveHolding(holding.id, 'tank_qt', '2026-08-27', db);

    const residencies = await db.residencies.where('holdingId').equals(holding.id).toArray();
    expect(residencies).toHaveLength(2);
    const closed = residencies.find((r) => r.endDate)!;
    const open = residencies.find((r) => !r.endDate)!;
    expect(closed.aquariumId).toBe('tank_75g');
    expect(closed.startDate).toBe('2026-01-01');
    expect(open.aquariumId).toBe('tank_qt');
    expect(await db.lifeEvents.where('holdingId').equals(holding.id).count()).toBe(1);
  });

  it('derives Current and Past kept from history rather than a status field', async () => {
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', rawLabel: 'Neon Tetra', kind: 'group', openingQuantity: 6 },
      db,
    );
    const events1 = await db.lifeEvents.toArray();
    const res1 = await db.residencies.toArray();
    expect(deriveBadge(holding, events1, res1)).toBe('current');

    await recordDeath({ holdingId: holding.id, quantity: 6 }, db);
    const events2 = await db.lifeEvents.toArray();
    const res2 = await db.residencies.toArray();
    expect(deriveQuantity(holding, events2)).toBe(0);
    expect(deriveBadge(holding, events2, res2)).toBe('past-kept');
  });
});

describe('Fish Heaven (FR-L01, FR-L02, FR-L04)', () => {
  beforeEach(async () => { await upsertAquarium(seventyFive({ stockingState: 'low' }), db); });

  it('keeps the fish in tank history after it dies', async () => {
    const { holding, residency } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', rawLabel: 'Senegal Bichir', kind: 'individual', openingQuantity: 1, on: '2024-03-01' },
      db,
    );
    await recordDeath({ holdingId: holding.id, occurredOn: '2026-08-01', story: 'Found him behind the driftwood.' }, db);

    // The holding, its residency and its start date all survive.
    expect(await db.holdings.get(holding.id)).toBeTruthy();
    const stored = await db.residencies.get(residency.id);
    expect(stored!.startDate).toBe('2024-03-01');
    expect(stored!.endDate).toBe('2026-08-01');
    expect(await db.memorials.count()).toBe(1);
  });

  it('accepts an unknown cause with several suspected contributors', async () => {
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', rawLabel: 'Goby', kind: 'individual', openingQuantity: 1 }, db,
    );
    const memorial = await recordDeath(
      { holdingId: holding.id, suspectedContributors: ['temperature swing', 'possible bullying'], causeConfidence: 'suspected' },
      db,
    );
    expect(memorial.causeConfidence).toBe('suspected');
    expect(memorial.suspectedContributors).toHaveLength(2);
  });

  it('keeps a surviving group open after a partial loss', async () => {
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', rawLabel: 'Neon Tetra', kind: 'group', openingQuantity: 6 }, db,
    );
    await recordDeath({ holdingId: holding.id, quantity: 2 }, db);
    const events = await db.lifeEvents.toArray();
    expect(deriveQuantity(holding, events)).toBe(4);
    const open = (await db.residencies.where('holdingId').equals(holding.id).toArray()).find((r) => !r.endDate);
    expect(open).toBeTruthy();
  });

  it('turns a lesson into a private principle linked back to the fish', async () => {
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', rawLabel: 'Goby', kind: 'individual', openingQuantity: 1 }, db,
    );
    const memorial = await recordDeath({ holdingId: holding.id, lesson: 'Quarantine every wild-caught goby.' }, db);
    await createKeeperPrinciple('Quarantine every wild-caught fish for 30 days.', { memorialId: memorial.id }, db);

    const principle = await db.keeperPrinciples.toArray();
    expect(principle[0]!.sourceMemorialId).toBe(memorial.id);
    expect((await db.memorials.get(memorial.id))!.keeperPrincipleId).toBe(principle[0]!.id);
  });
});

// ---------------------------------------------------------------------------
// PRD section 10 - the primary MVP acceptance scenario
// ---------------------------------------------------------------------------

describe('End-to-end acceptance: the Panther (PRD 10)', () => {
  it('runs all nine steps without a purchase, a duplicate, or a fabricated number', async () => {
    // The 75G as it actually stands: full, and marked so by its keeper.
    await upsertAquarium(seventyFive(), db);
    const { holding: pleco } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', speciesId: 'sp_common_pleco', rawLabel: 'Common Pleco', kind: 'individual', openingQuantity: 1 },
      db,
    );
    expect(pleco.openingBalance).toBe(true);

    // Step 2 - Capture. Silent, offline-safe, media only.
    const draft = await createCatchDraft(
      { files: [photo()], clientKey: 'panther-capture', placeId: AQUARIUM_ADVENTURE, observedAt: '2026-08-27T15:04:00.000Z' },
      db,
    );
    expect(draft.specimen.identityStatus).toBe('unknown');
    expect(draft.encounter.placeId).toBe(AQUARIUM_ADVENTURE);

    // Step 3 - Identify, and name him.
    await assertIdentity(
      { specimenId: draft.specimen.id, speciesId: 'sp_jaguar_cichlid', source: 'user', status: 'user-confirmed' },
      db,
    );
    await db.specimens.update(draft.specimen.id, { nickname: 'the Panther' });
    await db.encounters.update(draft.encounter.id, { observedSize: { value: 6, unit: 'in', estimate: true } });

    const panther = (await db.specimens.get(draft.specimen.id))!;
    expect(panther.nickname).toBe('the Panther');
    // FR-J04: the nickname does not replace the scientific identity.
    expect(panther.speciesId).toBe('sp_jaguar_cichlid');

    // Step 4 - Price. $100 asking, $75 member, both retained.
    const price = await recordPrice(
      {
        specimenId: draft.specimen.id,
        speciesId: 'sp_jaguar_cichlid',
        encounterId: draft.encounter.id,
        placeId: AQUARIUM_ADVENTURE,
        askingPrice: 100,
        memberPrice: 75,
        observedSize: { value: 6, unit: 'in', estimate: true },
      },
      db,
    );
    expect(price.askingPrice).toBe(100);
    expect(price.memberPrice).toBe(75);

    // The manual comparison to a smaller $50 J4 specimen.
    await recordPrice(
      { speciesId: 'sp_jaguar_cichlid', askingPrice: 50, observedSize: { value: 4, unit: 'in' }, source: 'online-manual' },
      db,
    );

    // Step 5 - Evaluate. The crowded 75G must come back Extreme risk.
    const [assessment] = await evaluateSpecimen(draft.specimen.id, { observedSize: { value: 6, unit: 'in', estimate: true } }, db);
    expect(assessment!.aquariumId).toBe('tank_75g');
    expect(assessment!.verdict).toBe('extreme-risk');

    const byFactor = new Map(assessment!.factors.map((f) => [f.factor, f]));
    // The PRD names adult size, aggression and crowding as the drivers.
    expect(byFactor.get('adult-size')!.verdict).toBe('extreme-risk');
    expect(byFactor.get('minimum-enclosure')!.verdict).toBe('extreme-risk');
    expect(byFactor.get('aggression')!.verdict).toBe('extreme-risk');
    expect(byFactor.get('crowding')!.verdict).toBe('conditional');
    // FR-E04: every verdict shows its working.
    expect(byFactor.get('adult-size')!.inputsUsed.length).toBeGreaterThan(0);
    expect(assessment!.rulesVersion).toBeTruthy();

    // Step 6 - Reveal. Formula v0.3.0: the score is market scarcity alone.
    const outcome = await revealSpecimen(draft.specimen.id, db);
    expect(outcome.status).toBe('revealed');
    const snapshot = (outcome as Extract<typeof outcome, { status: 'revealed' }>).snapshot;

    // Only one component now. Asserted as an exact key set rather than a
    // presence check, because the failure this guards against is a retired
    // component quietly coming back and inflating the total.
    expect(Object.keys(snapshot.components)).toEqual(['marketScarcity']);
    expect(snapshot.totalScore).toBe(snapshot.components.marketScarcity);

    // Asserted against the live index rather than a hardcoded number, because
    // the score moves whenever a vendor is added - expected, not a regression.
    expect(snapshot.totalScore).toBeGreaterThan(0);

    // The acceptance criterion itself. Asserting only "total == whatever the
    // snapshot says" is circular and would survive the market score silently
    // going to zero, which is exactly what happened while the scarcity rewrite
    // was mid-flight. Jaguar Cichlid is carried by 1 of 3 witness stores, so
    // it scores 61 and lands in epic.
    expect(snapshot.tier).toBe('epic');
    expect(snapshot.formulaVersion).toBe('discovery-tier-v0.3.0');

    // Revealing again returns the SAME snapshot, distinguishably.
    const again = await revealSpecimen(draft.specimen.id, db);
    expect(again.status).toBe('already-revealed');

    await awardGolden(draft.specimen.id, 'The way he tracked me across the glass.', db);
    const golden = await db.specimens.get(draft.specimen.id);
    expect(golden!.golden!.reason).toBeTruthy();
    // FR-R06: Golden changes nothing objective.
    expect((await db.raritySnapshots.get(snapshot.id))!.totalScore).toBe(snapshot.totalScore);

    // Step 7 - Leave responsibly. No holding, no ownership, no purchase.
    expect(await db.holdings.where('specimenId').equals(draft.specimen.id).count()).toBe(0);
    expect((await db.specimens.get(draft.specimen.id))!.status).toBe('encountered');

    // Step 8 - Journal later. The story attaches to the same specimen.
    await addEncounterChapter(
      draft.specimen.id,
      { observedAt: '2026-08-27T22:30:00.000Z', notes: 'Arrived that morning. Unpriced donation cue. I did not want to destabilise the 75G.' },
      db,
    );

    // Step 9 - Revisit, then acquire. Still one specimen, one story.
    await addEncounterChapter(draft.specimen.id, { observedAt: '2026-09-10T14:00:00.000Z' }, db);
    await upsertAquarium(seventyFive({ id: 'tank_predator', name: 'Predator Tank', stockingState: 'low' }), db);
    const { holding } = await acquireSpecimen(draft.specimen.id, 'tank_predator', { on: '2026-09-10' }, db);

    expect(await db.specimens.count()).toBe(1);
    expect(holding.specimenId).toBe(draft.specimen.id);
    expect(await db.encounters.where('specimenId').equals(draft.specimen.id).count()).toBe(3);
    expect((await db.specimens.get(draft.specimen.id))!.status).toBe('resident');
    // The reveal, the price observations and the encounter-day assessment all survive acquisition.
    expect(await db.raritySnapshots.count()).toBe(1);
    expect(await db.priceObservations.where('specimenId').equals(draft.specimen.id).count()).toBe(1);
    expect((await assessmentHistory(draft.specimen.id, db))[0]!.verdict).toBe('extreme-risk');
  });

  it('the seeded jaguar profile cites its placeholder source and says it is one', () => {
    const jaguar = CATALOG_BY_ID.get('sp_jaguar_cichlid')!;
    const source = jaguar.profile.sources[0]!;
    expect(source.url).toBe('https://en.wikipedia.org/wiki/Parachromis_managuensis');
    expect(source.label).toMatch(/PLACEHOLDER/i);
    // The note must keep saying which fields the article does NOT support.
    expect(source.note).toMatch(/NOT sourced from it/i);
  });
});

describe('newId', () => {
  it('produces prefixed unique ids', () => {
    expect(newId('spec')).toMatch(/^spec_[0-9a-f-]{36}$/);
    expect(newId('spec')).not.toBe(newId('spec'));
  });
});

/**
 * The path a fish takes when you never caught it - it was simply already in a
 * tank when the inventory was imported. Everything downstream (the card's
 * colour, its art, its photos) hangs off a specimen, and this is where that
 * specimen comes from.
 */
describe('photos on a fish you keep but never caught', () => {
  const openingBalance = () =>
    createOpeningBalanceHolding(
      {
        aquariumId: 'tank_75g',
        speciesId: 'sp_neon_tetra',
        rawLabel: 'Neon Tetra (school)',
        kind: 'group',
        openingQuantity: 6,
      },
      db,
    );

  it('mints the specimen the holding implied, and links it back', async () => {
    const { holding } = await openingBalance();
    expect(holding.specimenId).toBeUndefined();

    const specimen = await ensureSpecimenForHolding(holding.id, db);

    expect(specimen.status).toBe('resident');
    expect(specimen.kind).toBe('group');
    // FR-O05: the store's own wording survives identification.
    expect(specimen.rawLabel).toBe('Neon Tetra (school)');
    expect((await db.holdings.get(holding.id))!.specimenId).toBe(specimen.id);
  });

  it('records where the identity came from rather than stamping it', async () => {
    const { holding } = await openingBalance();
    const specimen = await ensureSpecimenForHolding(holding.id, db);

    const stored = await db.specimens.get(specimen.id);
    expect(stored!.speciesId).toBe('sp_neon_tetra');
    expect(stored!.identityStatus).toBe('user-confirmed');

    const history = await identityHistory(specimen.id, db);
    expect(history).toHaveLength(1);
    expect(history[0]!.source).toBe('import');
    expect(history[0]!.candidateSpeciesId).toBe('sp_neon_tetra');
  });

  it('is idempotent - a second photo does not mint a second specimen', async () => {
    const { holding } = await openingBalance();
    const first = await ensureSpecimenForHolding(holding.id, db);
    const second = await ensureSpecimenForHolding(holding.id, db);

    expect(second.id).toBe(first.id);
    expect(await db.specimens.count()).toBe(1);
  });

  it('leaves identity unknown when the holding was never matched to a species', async () => {
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', rawLabel: 'Mystery pleco', kind: 'individual', openingQuantity: 1 },
      db,
    );
    const specimen = await ensureSpecimenForHolding(holding.id, db);

    expect(specimen.identityStatus).toBe('unknown');
    expect(await identityHistory(specimen.id, db)).toHaveLength(0);
  });

  it('stores the photo against the specimen, without inventing an encounter', async () => {
    const { holding } = await openingBalance();
    const specimen = await ensureSpecimenForHolding(holding.id, db);

    const media = await addPhotos({ specimenId: specimen.id, files: [photo(), photo()] }, db);

    expect(media).toHaveLength(2);
    expect(media.every((m) => m.specimenIds.includes(specimen.id))).toBe(true);
    // A fish already yours was not "encountered" anywhere.
    expect(media.every((m) => m.encounterId === undefined)).toBe(true);
    expect(await db.encounters.count()).toBe(0);
    expect(await db.blobs.count()).toBe(2);
  });

  it('keeps the original bytes untouched (NFR-03)', async () => {
    const { holding } = await openingBalance();
    const specimen = await ensureSpecimenForHolding(holding.id, db);
    const [media] = await addPhotos({ specimenId: specimen.id, files: [photo()] }, db);

    const stored = await db.blobs.get(media!.originalBlobKey);
    expect(stored!.bytes).toBe(4);
    expect(media!.originalBytes).toBe(4);
  });

  it('refuses to attach a photo to a specimen that does not exist', async () => {
    await expect(addPhotos({ specimenId: 'spec_nope', files: [photo()] }, db)).rejects.toThrow();
  });
});

describe('recording a store label for a fish the catalog lacks (spec 005)', () => {
  async function anUnknownCatch() {
    return createCatchDraft({ files: [], clientKey: newId('k') }, db);
  }

  it('records the wording verbatim and marks the identity provisional', async () => {
    const { specimen } = await anUnknownCatch();
    await recordStoreLabel(specimen.id, '  Emerald Puffer (LFS tag)  ', db);

    const after = await db.specimens.get(specimen.id);
    // Trimmed, but not otherwise touched - FR-O05 keeps the store's wording.
    expect(after!.rawLabel).toBe('Emerald Puffer (LFS tag)');
    expect(after!.identityStatus).toBe('provisional');
  });

  it('invents no speciesId, so nothing downstream reads it as a catalog match', async () => {
    const { specimen } = await anUnknownCatch();
    await recordStoreLabel(specimen.id, 'Mystery loach', db);
    expect((await db.specimens.get(specimen.id))!.speciesId).toBeUndefined();
  });

  it('leaves an auditable assertion rather than stamping the record (FR-I06)', async () => {
    const { specimen } = await anUnknownCatch();
    await recordStoreLabel(specimen.id, 'Mystery loach', db);

    const history = await identityHistory(specimen.id, db);
    expect(history).toHaveLength(1);
    expect(history[0]!.candidateRawText).toBe('Mystery loach');
    expect(history[0]!.candidateSpeciesId).toBeUndefined();
  });

  it('refuses a blank label, because blank is the skip this replaces', async () => {
    const { specimen } = await anUnknownCatch();
    await expect(recordStoreLabel(specimen.id, '   ', db)).rejects.toThrow(/cannot be blank/i);
    expect((await db.specimens.get(specimen.id))!.identityStatus).toBe('unknown');
  });

  it('does not rate it: Discovery needs a species to find market evidence for', async () => {
    const { specimen } = await anUnknownCatch();
    await recordStoreLabel(specimen.id, 'Mystery loach', db);

    const outcome = await revealSpecimen(specimen.id, db);
    expect(outcome.status).toBe('not-identified');
    expect(await db.raritySnapshots.where('specimenId').equals(specimen.id).count()).toBe(0);
  });

  it('can be superseded later by a real catalog match', async () => {
    const { specimen } = await anUnknownCatch();
    await recordStoreLabel(specimen.id, 'Jag 6"', db);
    await assertIdentity(
      { specimenId: specimen.id, speciesId: 'sp_jaguar_cichlid', source: 'user', status: 'user-confirmed' },
      db,
    );

    const after = await db.specimens.get(specimen.id);
    expect(after!.identityStatus).toBe('user-confirmed');
    expect(after!.speciesId).toBe('sp_jaguar_cichlid');
    // FR-O05: the store's wording survives being corrected.
    expect(after!.rawLabel).toBe('Jag 6"');
    expect(await identityHistory(specimen.id, db)).toHaveLength(2);
  });
});

describe('a reveal declines when there is no shelf evidence (spec 005)', () => {
  it('returns the refusal and its reason, and writes no snapshot', async () => {
    const draft = await createCatchDraft({ files: [], clientKey: newId('k') }, db);
    // Listed only by Predatory Fins, which is not a qualifying witness store.
    await assertIdentity(
      { specimenId: draft.specimen.id, speciesId: 'sp_liosomadoras_oncinus', source: 'user', status: 'user-confirmed' },
      db,
    );

    const outcome = await revealSpecimen(draft.specimen.id, db);
    expect(outcome.status).toBe('no-market-evidence');
    expect((outcome as Extract<typeof outcome, { status: 'no-market-evidence' }>).reason).toBeTruthy();
    expect(await db.raritySnapshots.where('specimenId').equals(draft.specimen.id).count()).toBe(0);
  });

  it('still marks a Dream List wish fulfilled, even though nothing was rated', async () => {
    const draft = await createCatchDraft({ files: [], clientKey: newId('k') }, db);
    await db.dreamList.add({
      id: newId('dream'),
      speciesId: 'sp_liosomadoras_oncinus',
      addedAt: '2026-01-01T00:00:00.000Z',
      source: 'manual',
    });
    await assertIdentity(
      { specimenId: draft.specimen.id, speciesId: 'sp_liosomadoras_oncinus', source: 'user', status: 'user-confirmed' },
      db,
    );

    expect((await revealSpecimen(draft.specimen.id, db)).status).toBe('no-market-evidence');

    // The regression this guards: fulfilment used to live inside the snapshot
    // transaction, so a declined reveal would have silently stopped granting
    // wishes for the 78% of the catalog that has no shelf evidence.
    const wish = await db.dreamList.where('speciesId').equals('sp_liosomadoras_oncinus').first();
    expect(wish!.fulfilledBySpecimenId).toBe(draft.specimen.id);
  });
});

describe('stocking a tank directly (spec 005)', () => {
  async function aTank(name = '75G') {
    return createAquarium({ name, kind: 'display' }, db);
  }

  it('records a holding, a residency and a dated acquisition', async () => {
    const tank = await aTank();
    const { holding, residency, event } = await stockTank(
      { aquariumId: tank.id, speciesId: 'sp_jaguar_cichlid', quantity: 3, on: '2026-08-01' }, db,
    );

    expect(holding.speciesId).toBe('sp_jaguar_cichlid');
    expect(residency.aquariumId).toBe(tank.id);
    expect(residency.endDate).toBeUndefined();
    expect(event.type).toBe('acquired');
    expect(event.quantityDelta).toBe(3);
    expect(event.occurredOn).toBe('2026-08-01');
  });

  it('derives the quantity the caller asked for', async () => {
    const tank = await aTank();
    const { holding } = await stockTank({ aquariumId: tank.id, speciesId: 'sp_jaguar_cichlid', quantity: 6 }, db);
    expect(deriveQuantity(holding, await db.lifeEvents.toArray())).toBe(6);
  });

  it('mints no specimen: a holding you keep has never been encountered (FR-T02)', async () => {
    const tank = await aTank();
    const { holding } = await stockTank({ aquariumId: tank.id, speciesId: 'sp_jaguar_cichlid' }, db);
    expect(holding.specimenId).toBeUndefined();
    expect(await db.specimens.count()).toBe(0);
  });

  it('is not an opening balance: this arrival has a known date', async () => {
    const tank = await aTank();
    const { holding } = await stockTank({ aquariumId: tank.id, speciesId: 'sp_jaguar_cichlid' }, db);
    expect(holding.openingBalance).toBe(false);
  });

  it('calls a single fish individual and several a group', async () => {
    const tank = await aTank();
    const one = await stockTank({ aquariumId: tank.id, speciesId: 'sp_jaguar_cichlid', quantity: 1 }, db);
    const many = await stockTank({ aquariumId: tank.id, speciesId: 'sp_jaguar_cichlid', quantity: 5 }, db);
    expect(one.holding.kind).toBe('individual');
    expect(many.holding.kind).toBe('group');
  });

  /** The reported bug: one fish in one tank, another in a different tank. */
  it('puts the same species in two tanks, as two holdings', async () => {
    const a = await aTank('75G');
    const b = await aTank('Predator Tank');
    await stockTank({ aquariumId: a.id, speciesId: 'sp_jaguar_cichlid', quantity: 1 }, db);
    await stockTank({ aquariumId: b.id, speciesId: 'sp_jaguar_cichlid', quantity: 1 }, db);

    const holdings = await db.holdings.where('speciesId').equals('sp_jaguar_cichlid').toArray();
    expect(holdings).toHaveLength(2);

    const residencies = await db.residencies.toArray();
    const tanks = holdings.map((h) => residencies.find((r) => r.holdingId === h.id && !r.endDate)!.aquariumId);
    // Two open residencies in two different tanks - neither closed the other.
    expect(new Set(tanks)).toEqual(new Set([a.id, b.id]));
  });

  it('refuses a tank that does not exist rather than orphaning a holding', async () => {
    await expect(stockTank({ aquariumId: 'tank_nope', speciesId: 'sp_jaguar_cichlid' }, db))
      .rejects.toThrow(/unknown tank/i);
    expect(await db.holdings.count()).toBe(0);
  });

  it.each([0, -2, 1.5])('refuses a quantity of %s', async (quantity) => {
    const tank = await aTank();
    await expect(stockTank({ aquariumId: tank.id, speciesId: 'sp_jaguar_cichlid', quantity }, db))
      .rejects.toThrow(/cannot be stocked/i);
  });
});

describe('raising and lowering a count (spec 005)', () => {
  async function aHolding(quantity = 2) {
    const tank = await createAquarium({ name: '75G', kind: 'display' }, db);
    const { holding } = await stockTank({ aquariumId: tank.id, speciesId: 'sp_jaguar_cichlid', quantity }, db);
    return holding;
  }

  async function quantityOf(holdingId: string) {
    const holding = (await db.holdings.get(holdingId))!;
    return deriveQuantity(holding, await db.lifeEvents.toArray());
  }

  it('adds fish you bought later', async () => {
    const holding = await aHolding(2);
    await adjustHoldingQuantity({ holdingId: holding.id, delta: 3 }, db);
    expect(await quantityOf(holding.id)).toBe(5);
  });

  it('files an increase as an acquisition, not a correction', async () => {
    const holding = await aHolding();
    const event = await adjustHoldingQuantity({ holdingId: holding.id, delta: 1 }, db);
    expect(event.type).toBe('acquired');
  });

  it('files a decrease as a correction, so the journal does not imply a death', async () => {
    const holding = await aHolding(4);
    const event = await adjustHoldingQuantity({ holdingId: holding.id, delta: -1 }, db);
    expect(event.type).toBe('quantity-adjusted');
    expect(await quantityOf(holding.id)).toBe(3);
  });

  it('refuses to go below zero rather than silently clamping', async () => {
    const holding = await aHolding(2);
    await expect(adjustHoldingQuantity({ holdingId: holding.id, delta: -5 }, db))
      .rejects.toThrow(/below zero/i);
    expect(await quantityOf(holding.id)).toBe(2);
  });

  it('refuses a change of zero, which says nothing', async () => {
    const holding = await aHolding();
    await expect(adjustHoldingQuantity({ holdingId: holding.id, delta: 0 }, db))
      .rejects.toThrow(/says nothing/i);
  });
});

describe('placing a holding that lives nowhere (spec 005)', () => {
  it('opens a residency without closing one that was never there', async () => {
    const tank = await createAquarium({ name: '75G', kind: 'display' }, db);
    // An opening-balance holding with no residency: invisible on every screen
    // and unplaceable from any of them before spec 005.
    const holding = {
      id: newId('hold'), speciesId: 'sp_jaguar_cichlid', kind: 'individual' as const,
      openingQuantity: 1, openingBalance: true, createdAt: new Date().toISOString(),
    };
    await db.holdings.add(holding);

    await moveHolding(holding.id, tank.id, '2026-08-01', db);

    const residencies = await db.residencies.where('holdingId').equals(holding.id).toArray();
    expect(residencies).toHaveLength(1);
    expect(residencies[0]!.aquariumId).toBe(tank.id);
    expect(residencies[0]!.endDate).toBeUndefined();
  });
});

describe('editing a catch', () => {
  async function aCatch() {
    const draft = await createCatchDraft({
      files: [], clientKey: newId('k'), rawLabel: 'Jag 6"', observedAt: '2026-08-01T10:00:00.000Z',
    }, db);
    return draft;
  }

  it('corrects the fields the user actually observed', async () => {
    const { specimen } = await aCatch();
    await updateCatch({
      specimenId: specimen.id,
      nickname: 'the Panther',
      observedAt: '2026-07-30T09:00:00.000Z',
      notes: 'Went in for plants.',
      quantitySeen: 2,
    }, db);

    const after = await db.specimens.get(specimen.id);
    const enc = (await db.encounters.where('specimenId').equals(specimen.id).toArray())[0];
    expect(after!.nickname).toBe('the Panther');
    expect(enc!.observedAt).toBe('2026-07-30T09:00:00.000Z');
    expect(enc!.notes).toBe('Went in for plants.');
    expect(enc!.quantitySeen).toBe(2);
  });

  it('leaves untouched fields alone, so a partial form cannot blank the rest', async () => {
    const { specimen } = await aCatch();
    await updateCatch({ specimenId: specimen.id, notes: 'first' }, db);
    await updateCatch({ specimenId: specimen.id, nickname: 'Spot' }, db);

    const enc = (await db.encounters.where('specimenId').equals(specimen.id).toArray())[0];
    expect(enc!.notes).toBe('first');
    expect((await db.specimens.get(specimen.id))!.rawLabel).toBe('Jag 6"');
  });

  it('clears a field on null, which undefined cannot express', async () => {
    const { specimen } = await aCatch();
    await updateCatch({ specimenId: specimen.id, nickname: 'Spot' }, db);
    await updateCatch({ specimenId: specimen.id, nickname: null }, db);
    expect((await db.specimens.get(specimen.id))!.nickname).toBeUndefined();
  });

  it('never changes identity — that path supersedes rather than overwrites', async () => {
    // The audit trail would have a hole in it exactly where the interesting
    // decisions happen if an edit could quietly set speciesId.
    const { specimen } = await aCatch();
    await assertIdentity(
      { specimenId: specimen.id, speciesId: 'sp_jaguar_cichlid', source: 'user', status: 'user-confirmed' },
      db,
    );
    await updateCatch({ specimenId: specimen.id, nickname: 'Spot' }, db);

    const after = await db.specimens.get(specimen.id);
    expect(after!.speciesId).toBe('sp_jaguar_cichlid');
    expect(after!.identityStatus).toBe('user-confirmed');
    expect(await identityHistory(specimen.id, db)).toHaveLength(1);
  });

  it('bumps updatedAt so the record shows it was touched', async () => {
    const { specimen } = await aCatch();
    await updateCatch({ specimenId: specimen.id, nickname: 'Spot' }, db);
    expect((await db.specimens.get(specimen.id))!.updatedAt >= specimen.updatedAt).toBe(true);
  });
});

describe('deleting a catch', () => {
  async function aFullCatch() {
    const { specimen, encounter } = await createCatchDraft({
      files: [photo()],
      clientKey: newId('k'),
    }, db);
    await assertIdentity(
      { specimenId: specimen.id, speciesId: 'sp_jaguar_cichlid', source: 'user', status: 'user-confirmed' },
      db,
    );
    await recordPrice({
      specimenId: specimen.id, speciesId: 'sp_jaguar_cichlid', encounterId: encounter.id, askingPrice: 100,
    }, db);
    await revealSpecimen(specimen.id, db);
    return { specimen, encounter };
  }

  it('states what it will remove before removing it', async () => {
    const { specimen } = await aFullCatch();
    const plan = await planDeleteCatch(specimen.id, db);
    expect(plan.allowed).toBe(true);
    expect(plan).toMatchObject({ encounters: 1, media: 1, prices: 1, identifications: 1 });
  });

  it('removes the catch and everything downstream of it', async () => {
    const { specimen } = await aFullCatch();
    await deleteCatch(specimen.id, db);

    expect(await db.specimens.get(specimen.id)).toBeUndefined();
    expect(await db.encounters.where('specimenId').equals(specimen.id).count()).toBe(0);
    expect(await db.media.where('specimenIds').equals(specimen.id).count()).toBe(0);
    expect(await db.identifications.where('specimenId').equals(specimen.id).count()).toBe(0);
    expect(await db.priceObservations.where('specimenId').equals(specimen.id).count()).toBe(0);
    expect(await db.raritySnapshots.where('specimenId').equals(specimen.id).count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
  });

  it('leaves species-level price notes alone', async () => {
    // A price seen elsewhere is a market observation; it outlives the catch.
    const { specimen } = await aFullCatch();
    await recordPrice(
      { speciesId: 'sp_jaguar_cichlid', askingPrice: 50, source: 'online-manual' },
      db,
    );
    await deleteCatch(specimen.id, db);
    expect(await db.priceObservations.where('speciesId').equals('sp_jaguar_cichlid').count()).toBe(1);
  });

  it('detaches a shared photo rather than destroying it', async () => {
    // The media IS the record. Deleting one catch must never take another
    // catch's only photo with it.
    const a = await aFullCatch();
    const b = await createCatchDraft({ files: [], clientKey: newId('k') }, db);
    const shot = (await db.media.where('specimenIds').equals(a.specimen.id).toArray())[0]!;
    await db.media.update(shot.id, { specimenIds: [a.specimen.id, b.specimen.id] });

    await deleteCatch(a.specimen.id, db);

    const kept = await db.media.get(shot.id);
    expect(kept).toBeDefined();
    expect(kept!.specimenIds).toEqual([b.specimen.id]);
    expect(await db.blobs.get(shot.originalBlobKey!)).toBeDefined();
  });

  /**
   * This used to refuse. It was the right rule about the data and the wrong
   * one about the person: clearing a record that should not exist meant first
   * staging a departure that never happened. The cascade is now stated rather
   * than prevented, and these are the two halves of "stated" - the plan names
   * the tanks before anything happens, and the delete actually empties them.
   */
  it('names the tanks a delete would empty, before it happens', async () => {
    const { specimen } = await aFullCatch();
    await db.aquariums.add(seventyFive());
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', specimenId: specimen.id, speciesId: 'sp_jaguar_cichlid',
        rawLabel: 'Jaguar', kind: 'individual', openingQuantity: 1 },
      db,
    );
    expect(holding).toBeDefined();

    const plan = await planDeleteCatch(specimen.id, db);
    expect(plan.allowed).toBe(true);
    expect(plan.holdings).toBe(1);
    // Named, not counted: a number is something to accept on faith.
    expect(plan.inTanks).toEqual(['75G']);
    // Nothing removed by planning it.
    expect(await db.holdings.get(holding.id)).toBeDefined();
  });

  it('removes the fish from the tank along with the catch', async () => {
    const { specimen } = await aFullCatch();
    await db.aquariums.add(seventyFive());
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', specimenId: specimen.id, speciesId: 'sp_jaguar_cichlid',
        rawLabel: 'Jaguar', kind: 'individual', openingQuantity: 1 },
      db,
    );

    const result = await deleteCatch(specimen.id, db);
    expect(result.allowed).toBe(true);
    expect(await db.specimens.get(specimen.id)).toBeUndefined();

    // The holding and everything that placed or counted it go too - a residency
    // pointing at a holding that no longer exists is a fish half-in a tank.
    expect(await db.holdings.get(holding.id)).toBeUndefined();
    expect(await db.residencies.where('holdingId').equals(holding.id).count()).toBe(0);
    expect(await db.lifeEvents.where('holdingId').equals(holding.id).count()).toBe(0);
    // And the tank itself is untouched.
    expect(await db.aquariums.get('tank_75g')).toBeDefined();
  });

  it('leaves another fish in the same tank alone', async () => {
    const { specimen } = await aFullCatch();
    await db.aquariums.add(seventyFive());
    const mine = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', specimenId: specimen.id, speciesId: 'sp_jaguar_cichlid',
        rawLabel: 'Jaguar', kind: 'individual', openingQuantity: 1 },
      db,
    );
    const neighbour = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', speciesId: 'sp_neon_tetra', rawLabel: 'Neon Tetra',
        kind: 'group', openingQuantity: 6 },
      db,
    );

    await deleteCatch(specimen.id, db);

    expect(await db.holdings.get(mine.holding.id)).toBeUndefined();
    expect(await db.holdings.get(neighbour.holding.id)).toBeDefined();
    expect(await db.residencies.where('holdingId').equals(neighbour.holding.id).count()).toBe(1);
  });

  it('remembers the deletion, so a seeded catch cannot come back', async () => {
    // Every seeder is guarded by "does this id exist?", so without the
    // tombstone a delete is only a hide until the next boot.
    const { specimen } = await aFullCatch();
    await deleteCatch(specimen.id, db);
    expect(await db.deletedRecords.get(specimen.id)).toMatchObject({ kind: 'specimen' });
  });
});

describe('tank photos', () => {
  const shot = (byte: number) => ({
    kind: 'photo' as const,
    blob: new Blob([new Uint8Array([byte])], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
  });

  async function aTank() {
    const id = newId('aq');
    await upsertAquarium({ id, name: 'Reef', kind: 'freshwater', status: 'active', createdAt: '' } as never, db);
    return id;
  }

  it('stores the photo as a real media row, not a loose blob', async () => {
    const id = await aTank();
    const media = await setTankPhoto(id, shot(1), db);

    expect((await db.aquariums.get(id))!.photoMediaId).toBe(media.id);
    expect(await db.blobs.get(media.originalBlobKey)).toBeDefined();
  });

  it('is not a sighting of a fish, and is never counted as one', async () => {
    // A photo of the glass has no encounter and no specimen. If it had either,
    // it would turn up in a catch's media and in the catalog's ownership maths.
    const id = await aTank();
    const media = await setTankPhoto(id, shot(1), db);
    expect(media.specimenIds).toEqual([]);
    expect(media.encounterId).toBeUndefined();
  });

  it('replacing deletes the old bytes rather than accumulating them', async () => {
    // A tank has one photo. Keeping every retake would quietly grow the
    // device's storage, and that budget is the app's to respect.
    const id = await aTank();
    const first = await setTankPhoto(id, shot(1), db);
    await setTankPhoto(id, shot(2), db);

    expect(await db.media.get(first.id)).toBeUndefined();
    expect(await db.blobs.get(first.originalBlobKey)).toBeUndefined();
    expect(await db.media.count()).toBe(1);
    expect(await db.blobs.count()).toBe(1);
  });

  it('clearing removes the photo and leaves the tank', async () => {
    const id = await aTank();
    const media = await setTankPhoto(id, shot(1), db);
    await clearTankPhoto(id, db);

    expect((await db.aquariums.get(id))!.photoMediaId).toBeUndefined();
    expect(await db.media.get(media.id)).toBeUndefined();
    expect(await db.blobs.count()).toBe(0);
    expect(await db.aquariums.get(id)).toBeDefined();
  });

  it('clearing a tank that has no photo is a no-op, not an error', async () => {
    const id = await aTank();
    await expect(clearTankPhoto(id, db)).resolves.toBeUndefined();
  });
});

describe('adding, retiring and deleting tanks', () => {
  it('creates a tank with just a name and a kind', async () => {
    const tank = await createAquarium({ name: '  Dune  ', kind: 'display' }, db);
    // Trimmed, and active from the start.
    expect(tank.name).toBe('Dune');
    expect(tank.status).toBe('active');
    // Unmeasured on purpose - screening reports what it is missing rather than
    // working from a guessed footprint.
    expect(tank.volume).toBeUndefined();
    expect(tank.dimensions).toBeUndefined();
    expect(await db.aquariums.get(tank.id)).toMatchObject({ name: 'Dune' });
  });

  it('refuses a tank with no name', async () => {
    await expect(createAquarium({ name: '   ', kind: 'display' }, db)).rejects.toThrow(/needs a name/i);
  });

  it('deletes a tank that never held a fish, and remembers it is gone', async () => {
    const tank = await createAquarium({ name: 'Spare', kind: 'tote' }, db);
    const plan = await deleteTank(tank.id, db);

    expect(plan.allowed).toBe(true);
    expect(await db.aquariums.get(tank.id)).toBeUndefined();
    // Tombstoned, so first-run seeding cannot bring a deleted tank back.
    expect(await db.deletedRecords.get(tank.id)).toMatchObject({ kind: 'aquarium' });
  });

  it('takes the tank photo with it, and tombstones that too', async () => {
    const tank = await createAquarium({ name: 'Spare', kind: 'tote' }, db);
    await setTankPhoto(tank.id, photo(), db);
    const withPhoto = await db.aquariums.get(tank.id);
    const mediaId = withPhoto!.photoMediaId!;
    expect(mediaId).toBeTruthy();

    const plan = await deleteTank(tank.id, db);
    expect(plan.photo).toBe(true);
    expect(await db.media.get(mediaId)).toBeUndefined();
    expect(await db.deletedRecords.get(mediaId)).toMatchObject({ kind: 'media' });
  });

  it('refuses to delete a tank that still holds fish, and says what to do', async () => {
    await db.aquariums.add(seventyFive());
    await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', speciesId: 'sp_neon_tetra', rawLabel: 'Neon Tetra', kind: 'group', openingQuantity: 6 },
      db,
    );

    const plan = await planDeleteTank('tank_75g', db);
    expect(plan.allowed).toBe(false);
    expect(plan.residents).toBe(1);
    expect(plan.reason).toMatch(/move them/i);

    // And the refusal is enforced, not merely advertised.
    await deleteTank('tank_75g', db);
    expect(await db.aquariums.get('tank_75g')).toBeDefined();
  });

  /**
   * The case that makes retire exist. Once a fish has lived somewhere, its
   * residency names that tank forever; deleting the tank would leave the
   * timeline reading "moved to tank_a3f9c2".
   */
  it('refuses to delete a tank whose history is still referenced, and points at retiring', async () => {
    await db.aquariums.add(seventyFive());
    const spare = await createAquarium({ name: 'Spare', kind: 'tote' }, db);
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: spare.id, speciesId: 'sp_neon_tetra', rawLabel: 'Neon Tetra', kind: 'group', openingQuantity: 6 },
      db,
    );
    await moveHolding(holding.id, 'tank_75g', undefined, db);

    const plan = await planDeleteTank(spare.id, db);
    expect(plan.allowed).toBe(false);
    expect(plan.residents).toBe(0);          // nothing lives there now
    expect(plan.pastResidencies).toBe(1);    // but something did
    expect(plan.reason).toMatch(/retire it instead/i);
    await deleteTank(spare.id, db);
    expect(await db.aquariums.get(spare.id)).toBeDefined();
  });

  it('retires and reinstates without touching the history that names the tank', async () => {
    await db.aquariums.add(seventyFive());
    await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', speciesId: 'sp_neon_tetra', rawLabel: 'Neon Tetra', kind: 'group', openingQuantity: 6 },
      db,
    );
    const before = await db.residencies.where('aquariumId').equals('tank_75g').toArray();

    await setAquariumStatus('tank_75g', 'retired', db);
    expect((await db.aquariums.get('tank_75g'))!.status).toBe('retired');
    expect(await db.residencies.where('aquariumId').equals('tank_75g').toArray()).toEqual(before);

    await setAquariumStatus('tank_75g', 'active', db);
    expect((await db.aquariums.get('tank_75g'))!.status).toBe('active');
  });

  it('tombstones a tank photo the owner removes, so bootstrap cannot re-seed it', async () => {
    const tank = await createAquarium({ name: 'Spare', kind: 'tote' }, db);
    await setTankPhoto(tank.id, photo(), db);
    const mediaId = (await db.aquariums.get(tank.id))!.photoMediaId!;

    await clearTankPhoto(tank.id, db);
    expect((await db.aquariums.get(tank.id))!.photoMediaId).toBeUndefined();
    expect(await db.deletedRecords.get(mediaId)).toMatchObject({ kind: 'media' });
  });
});

describe('logging a species the catalog does not have', () => {
  async function draft() {
    return createCatchDraft({ files: [photo()], clientKey: `k_${crypto.randomUUID()}` }, db);
  }

  it('creates a species of its own, marked as the keeper\'s and not the catalog\'s', async () => {
    const d = await draft();
    const species = await submitUserSpecies({ specimenId: d.specimen.id, label: '  Sailfin Pleco L083  ' }, db);

    expect(species.commonName).toBe('Sailfin Pleco L083');   // trimmed
    expect(species.origin).toBe('user-submitted');
    expect(species.submission).toMatchObject({
      label: 'Sailfin Pleco L083',
      specimenId: d.specimen.id,
    });
    expect(await db.species.get(species.id)).toBeDefined();
  });

  it('links the specimen to it, provisionally rather than confirmed', async () => {
    const d = await draft();
    const species = await submitUserSpecies({ specimenId: d.specimen.id, label: 'Sailfin Pleco L083' }, db);

    const after = await db.specimens.get(d.specimen.id);
    expect(after!.speciesId).toBe(species.id);
    // Confirming would mean "this is that catalog species", and there is none.
    expect(after!.identityStatus).toBe('provisional');
    expect(after!.rawLabel).toBe('Sailfin Pleco L083');
  });

  it('records the assertion so the identity trail explains itself', async () => {
    const d = await draft();
    await submitUserSpecies({ specimenId: d.specimen.id, label: 'Sailfin Pleco L083' }, db);

    const [latest] = await identityHistory(d.specimen.id, db);
    expect(latest!.candidateRawText).toBe('Sailfin Pleco L083');
    expect(latest!.source).toBe('user');
    expect(latest!.note).toMatch(/not in the catalog/i);
  });

  /**
   * The point of reusing: two of the same unlisted fish should become one
   * species with two specimens, which is what makes it worth reviewing.
   */
  it('reuses the species when the same name is logged again', async () => {
    const a = await draft();
    const b = await draft();
    const first = await submitUserSpecies({ specimenId: a.specimen.id, label: 'Sailfin Pleco L083' }, db);
    const second = await submitUserSpecies({ specimenId: b.specimen.id, label: '  sailfin pleco l083 ' }, db);

    expect(second.id).toBe(first.id);
    expect(await db.species.filter((s) => s.origin === 'user-submitted').count()).toBe(1);
    expect((await db.specimens.where('speciesId').equals(first.id).toArray()).length).toBe(2);
  });

  it('never touches a catalog species with the same name', async () => {
    const d = await draft();
    const catalogNeon = await db.species.get('sp_neon_tetra');
    expect(catalogNeon).toBeDefined();

    await submitUserSpecies({ specimenId: d.specimen.id, label: catalogNeon!.commonName }, db);

    // A new user-submitted row, and the catalog's own row left exactly as it was.
    expect(await db.species.get('sp_neon_tetra')).toEqual(catalogNeon);
    const mine = await userSubmittedSpecies(db);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).not.toBe('sp_neon_tetra');
  });

  it('refuses a blank name', async () => {
    const d = await draft();
    await expect(submitUserSpecies({ specimenId: d.specimen.id, label: '   ' }, db))
      .rejects.toThrow(/needs a name/i);
  });

  it('lists only the keeper\'s own species, newest first', async () => {
    const a = await draft();
    const b = await draft();
    await submitUserSpecies({ specimenId: a.specimen.id, label: 'Older Fish' }, db);
    await new Promise((r) => setTimeout(r, 5));
    await submitUserSpecies({ specimenId: b.specimen.id, label: 'Newer Fish' }, db);

    const mine = await userSubmittedSpecies(db);
    expect(mine.map((s) => s.commonName)).toEqual(['Newer Fish', 'Older Fish']);
    // The 2,000-odd seeded catalog species are not in this list.
    expect(mine.every((s) => s.origin === 'user-submitted')).toBe(true);
  });
});

describe('taking a fish out of a tank without killing it', () => {
  async function stocked(qty = 6) {
    await db.aquariums.add(seventyFive());
    return createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', speciesId: 'sp_neon_tetra', rawLabel: 'Neon Tetra', kind: 'group', openingQuantity: qty },
      db,
    );
  }

  it('removes the holding and everything that placed or counted it', async () => {
    const { holding } = await stocked();
    const result = await removeHolding(holding.id, db);

    expect(result.wasInTanks).toEqual(['75G']);
    expect(await db.holdings.get(holding.id)).toBeUndefined();
    expect(await db.residencies.where('holdingId').equals(holding.id).count()).toBe(0);
    expect(await db.lifeEvents.where('holdingId').equals(holding.id).count()).toBe(0);
  });

  /**
   * The whole reason this exists. recordDeath was the only way to empty a
   * slot, so "I rehomed them" had to be filed as a death - a false entry in
   * Fish Heaven that then blocked deleting the catch, because a memorial is
   * deliberately permanent.
   */
  it('writes no memorial, because nothing died', async () => {
    const { holding } = await stocked();
    const before = await db.memorials.count();
    await removeHolding(holding.id, db);
    expect(await db.memorials.count()).toBe(before);
  });

  it('leaves the specimen, its encounter and its photos alone', async () => {
    const a = await createCatchDraft({ files: [photo()], clientKey: `k_${crypto.randomUUID()}` }, db);
    await db.aquariums.add(seventyFive());
    const { holding } = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', specimenId: a.specimen.id, speciesId: 'sp_neon_tetra',
        rawLabel: 'Neon Tetra', kind: 'individual', openingQuantity: 1 },
      db,
    );

    await removeHolding(holding.id, db);

    // The catch happened. Removing it from a tank is not a claim that it did not.
    expect(await db.specimens.get(a.specimen.id)).toBeDefined();
    expect(await db.encounters.where('specimenId').equals(a.specimen.id).count()).toBe(1);
    expect(await db.media.where('specimenIds').equals(a.specimen.id).count()).toBe(1);
  });

  it('leaves the tank and its other residents alone', async () => {
    const { holding } = await stocked();
    const other = await createOpeningBalanceHolding(
      { aquariumId: 'tank_75g', speciesId: 'sp_jaguar_cichlid', rawLabel: 'Jaguar', kind: 'individual', openingQuantity: 1 },
      db,
    );

    await removeHolding(holding.id, db);

    expect(await db.aquariums.get('tank_75g')).toBeDefined();
    expect(await db.holdings.get(other.holding.id)).toBeDefined();
    expect(await db.residencies.where('holdingId').equals(other.holding.id).count()).toBe(1);
  });

  it('refuses an id that is not a holding', async () => {
    await expect(removeHolding('hold_nope', db)).rejects.toThrow(/unknown holding/i);
  });
});

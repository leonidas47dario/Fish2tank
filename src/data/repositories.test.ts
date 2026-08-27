import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB, newId } from './db';
import {
  acquireSpecimen,
  addEncounterChapter,
  assertIdentity,
  assessmentHistory,
  awardGolden,
  createCatchDraft,
  createKeeperPrinciple,
  createOpeningBalanceHolding,
  evaluateSpecimen,
  identityHistory,
  moveHolding,
  recordDeath,
  recordPrice,
  revealSpecimen,
  searchSpecies,
  upsertAquarium,
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

    // Step 6 - Reveal. First jaguar cichlid in the collection.
    const snapshot = await revealSpecimen(draft.specimen.id, db);
    expect(snapshot!.components.firstConfirmedSpecies).toBe(45);
    expect(snapshot!.components.dreamListHit).toBe(0);
    // Cold start: no history yet, so scarcity honestly scores nothing.
    expect(snapshot!.components.personalEncounterScarcity).toBe(0);
    expect(snapshot!.totalScore).toBe(45);
    expect(snapshot!.tier).toBe('rare');

    await awardGolden(draft.specimen.id, 'The way he tracked me across the glass.', db);
    const golden = await db.specimens.get(draft.specimen.id);
    expect(golden!.golden!.reason).toBeTruthy();
    // FR-R06: Golden changes nothing objective.
    expect((await db.raritySnapshots.get(snapshot!.id))!.totalScore).toBe(45);

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

  it('the seeded jaguar profile carries an honest provenance note, not a fake citation', () => {
    const jaguar = CATALOG_BY_ID.get('sp_jaguar_cichlid')!;
    expect(jaguar.profile.sources).toHaveLength(1);
    expect(jaguar.profile.sources[0]!.label).toMatch(/NOT verified/i);
    expect(jaguar.profile.sources[0]!.url).toBeUndefined();
  });
});

describe('newId', () => {
  it('produces prefixed unique ids', () => {
    expect(newId('spec')).toMatch(/^spec_[0-9a-f-]{36}$/);
    expect(newId('spec')).not.toBe(newId('spec'));
  });
});

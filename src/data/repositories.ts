/**
 * Domain operations over the local store.
 *
 * These are the writes the UI performs. Each one is a transaction that keeps
 * the invariants the PRD cares about: one specimen story from encounter
 * through ownership (FR-T01), history closed rather than overwritten
 * (FR-T03), and identity corrections preserved rather than replaced (FR-I06).
 */
import type {
  Aquarium,
  CalendarDate,
  CauseConfidence,
  CompatibilityAssessment,
  Encounter,
  Holding,
  Id,
  IdentificationAssertion,
  Instant,
  LengthMeasurement,
  LifeEvent,
  Media,
  MediaKind,
  Memorial,
  PriceBasis,
  PriceObservation,
  RaritySnapshot,
  Residency,
  Species,
  SpeciesProfile,
  Specimen,
} from '@/domain/types';
import { deriveQuantity, planMove } from '@/domain/holdings';
import { evaluateAllTanks, type CandidateInput, type ResidentInput, type TankInput } from '@/engine/compatibility/engine';
import { computeDiscoveryTier } from '@/engine/rarity/discovery-tier';
import { computeMarketScarcity } from '@/engine/rarity/market-scarcity';
import { marketFor } from './market';
import { db, newId, nowIso, today, type Fish2TankDB } from './db';

type DB = Fish2TankDB;

// ---------------------------------------------------------------------------
// Catch and draft (PRD 4.2)
// ---------------------------------------------------------------------------

export interface CaptureFile {
  kind: MediaKind;
  blob: Blob;
  mimeType: string;
  durationSeconds?: number;
}

export interface CreateCatchDraftInput {
  files: CaptureFile[];
  placeId?: Id;
  observedAt?: Instant;
  rawLabel?: string;
  /**
   * Stable key for this capture attempt. Re-invoking with the same key returns
   * the existing draft instead of creating a second one (FR-C07: "no duplicate
   * catch is created on retry").
   */
  clientKey: string;
}

export interface CatchDraft {
  specimen: Specimen;
  encounter: Encounter;
  media: Media[];
}

/**
 * Create the draft BEFORE media finishes writing (FR-C02).
 *
 * The specimen starts at identity "unknown", which is a valid permanent state
 * (FR-I01, principle P6) - a Mystery Catch is a real record, not a failure.
 */
export async function createCatchDraft(input: CreateCatchDraftInput, database: DB = db): Promise<CatchDraft> {
  const existing = await database.draftKeys.get(input.clientKey);
  if (existing) {
    const specimen = await database.specimens.get(existing.specimenId);
    const encounter = await database.encounters.get(existing.encounterId);
    if (specimen && encounter) {
      const media = await database.media.where('encounterId').equals(encounter.id).toArray();
      return { specimen, encounter, media };
    }
  }

  const at = input.observedAt ?? nowIso();
  const specimen: Specimen = {
    id: newId('spec'),
    kind: 'individual',
    rawLabel: input.rawLabel,
    identityStatus: 'unknown',
    status: 'encountered',
    createdAt: at,
    updatedAt: at,
  };
  const encounter: Encounter = {
    id: newId('enc'),
    specimenId: specimen.id,
    placeId: input.placeId,
    observedAt: at,
    createdAt: at,
    syncState: 'local-draft',
  };

  const media: Media[] = [];
  const blobs = input.files.map((f) => {
    const key = newId('blob');
    const m: Media = {
      id: newId('media'),
      kind: f.kind,
      specimenIds: [specimen.id],
      encounterId: encounter.id,
      originalBlobKey: key,
      originalBytes: f.blob.size,
      mimeType: f.mimeType,
      durationSeconds: f.durationSeconds,
      capturedAt: at,
      syncState: 'local-draft',
    };
    media.push(m);
    return { key, blob: f.blob, bytes: f.blob.size, mimeType: f.mimeType, storedAt: at };
  });

  await database.transaction(
    'rw',
    [database.specimens, database.encounters, database.media, database.blobs, database.draftKeys],
    async () => {
      await database.specimens.add(specimen);
      await database.encounters.add(encounter);
      if (media.length) await database.media.bulkAdd(media);
      if (blobs.length) await database.blobs.bulkAdd(blobs);
      await database.draftKeys.add({
        clientKey: input.clientKey,
        specimenId: specimen.id,
        encounterId: encounter.id,
        createdAt: at,
      });
    },
  );

  return { specimen, encounter, media };
}

/** Add a later chapter to the same specimen rather than duplicating it (FR-R03). */
export async function addEncounterChapter(
  specimenId: Id,
  details: Partial<Omit<Encounter, 'id' | 'specimenId' | 'createdAt' | 'syncState'>> = {},
  database: DB = db,
): Promise<Encounter> {
  const at = details.observedAt ?? nowIso();
  const encounter: Encounter = {
    id: newId('enc'),
    specimenId,
    observedAt: at,
    createdAt: nowIso(),
    syncState: 'local-draft',
    ...details,
  };
  await database.encounters.add(encounter);
  return encounter;
}

// ---------------------------------------------------------------------------
// Identification (PRD 4.3)
// ---------------------------------------------------------------------------

export interface ConfirmIdentityInput {
  specimenId: Id;
  speciesId?: Id;
  rawText?: string;
  source: IdentificationAssertion['source'];
  status: 'provisional' | 'user-confirmed';
  confidence?: number;
  note?: string;
}

/**
 * Assert an identity.
 *
 * FR-I06: the previous assertion is marked superseded, never deleted, so
 * correcting "jaguar cichlid" to "dovii" keeps the earlier claim, its source
 * and its date. FR-I04: confidence is stored only when a source supplied one -
 * a manual confirmation records no percentage at all.
 */
export async function assertIdentity(
  input: ConfirmIdentityInput,
  database: DB = db,
): Promise<IdentificationAssertion> {
  const at = nowIso();
  const assertion: IdentificationAssertion = {
    id: newId('ident'),
    specimenId: input.specimenId,
    candidateSpeciesId: input.speciesId,
    candidateRawText: input.rawText,
    source: input.source,
    confidence: input.source === 'user' ? undefined : input.confidence,
    assertedAt: at,
    note: input.note,
  };

  await database.transaction('rw', [database.identifications, database.specimens], async () => {
    const prior = await database.identifications
      .where('specimenId')
      .equals(input.specimenId)
      .filter((a) => !a.supersededByAssertionId)
      .toArray();
    for (const p of prior) {
      await database.identifications.update(p.id, { supersededByAssertionId: assertion.id });
    }
    await database.identifications.add(assertion);
    await database.specimens.update(input.specimenId, {
      speciesId: input.speciesId,
      identityStatus: input.status,
      updatedAt: at,
    });
  });

  return assertion;
}

/** Full identification history for a specimen, newest first (FR-I06, NFR-09). */
export async function identityHistory(specimenId: Id, database: DB = db): Promise<IdentificationAssertion[]> {
  const all = await database.identifications.where('specimenId').equals(specimenId).toArray();
  return all.sort((a, b) => b.assertedAt.localeCompare(a.assertedAt));
}

// ---------------------------------------------------------------------------
// Price (PRD 4.5)
// ---------------------------------------------------------------------------

export interface RecordPriceInput {
  specimenId?: Id;
  speciesId?: Id;
  encounterId?: Id;
  placeId?: Id;
  askingPrice?: number;
  memberPrice?: number;
  paidPrice?: number;
  currency?: string;
  basis?: PriceBasis;
  packageQuantity?: number;
  observedSize?: LengthMeasurement;
  observedAt?: Instant;
  source?: PriceObservation['source'];
  online?: PriceObservation['online'];
  note?: string;
}

/**
 * FR-P01: a price is a dated observation, not a mutable field on the species.
 * Repeat sightings therefore accumulate rather than overwrite.
 */
export async function recordPrice(input: RecordPriceInput, database: DB = db): Promise<PriceObservation> {
  const observation: PriceObservation = {
    id: newId('price'),
    specimenId: input.specimenId,
    speciesId: input.speciesId,
    encounterId: input.encounterId,
    placeId: input.placeId,
    askingPrice: input.askingPrice,
    memberPrice: input.memberPrice,
    paidPrice: input.paidPrice,
    currency: input.currency ?? 'USD',
    basis: input.basis ?? 'each',
    packageQuantity: input.packageQuantity ?? 1,
    observedSize: input.observedSize,
    observedAt: input.observedAt ?? nowIso(),
    online: input.online,
    source: input.source ?? 'in-store',
    note: input.note,
  };
  await database.priceObservations.add(observation);
  return observation;
}

// ---------------------------------------------------------------------------
// Evaluation (PRD 4.4)
// ---------------------------------------------------------------------------

async function loadTankInputs(database: DB): Promise<TankInput[]> {
  const [aquariums, holdings, residencies, profiles, lifeEvents] = await Promise.all([
    database.aquariums.toArray(),
    database.holdings.toArray(),
    database.residencies.toArray(),
    database.speciesProfiles.toArray(),
    database.lifeEvents.toArray(),
  ]);
  const profileBySpecies = new Map(profiles.map((p) => [p.speciesId, p]));

  return aquariums.map((aquarium) => {
    const residents: ResidentInput[] = residencies
      .filter((r) => r.aquariumId === aquarium.id && !r.endDate)
      .flatMap((r) => {
        const holding = holdings.find((h) => h.id === r.holdingId);
        if (!holding) return [];
        const quantity = deriveQuantity(holding, lifeEvents);
        if (quantity <= 0) return [];
        return [{
          holdingId: holding.id,
          label: holding.rawLabel ?? holding.speciesId ?? 'Unnamed holding',
          quantity,
          speciesId: holding.speciesId,
          profile: holding.speciesId ? profileBySpecies.get(holding.speciesId) : undefined,
          category: holding.category,
        }];
      });
    return { aquarium, residents };
  });
}

/**
 * Screen a specimen against every active tank and persist the snapshots
 * (FR-E02, FR-E07). Re-running later adds new snapshots; the encounter-day
 * results stay exactly where they were.
 */
export async function evaluateSpecimen(
  specimenId: Id,
  options: { quantity?: number; observedSize?: LengthMeasurement } = {},
  database: DB = db,
): Promise<CompatibilityAssessment[]> {
  const specimen = await database.specimens.get(specimenId);
  if (!specimen) throw new Error(`Unknown specimen ${specimenId}`);

  const species = specimen.speciesId ? await database.species.get(specimen.speciesId) : undefined;
  const profile = specimen.speciesId
    ? (await database.speciesProfiles.where('speciesId').equals(specimen.speciesId).first())
    : undefined;

  const latestEncounter = (await database.encounters.where('specimenId').equals(specimenId).toArray())
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];

  const candidate: CandidateInput = {
    specimenId,
    kind: specimen.kind,
    quantity: options.quantity ?? latestEncounter?.quantitySeen ?? 1,
    identityStatus: specimen.identityStatus,
    species,
    profile,
    observedSize: options.observedSize ?? latestEncounter?.observedSize,
  };

  const tanks = await loadTankInputs(database);
  const assessments = evaluateAllTanks(candidate, tanks);
  if (assessments.length) await database.assessments.bulkAdd(assessments);
  return assessments;
}

/** Every assessment ever run for a specimen, newest first. */
export async function assessmentHistory(specimenId: Id, database: DB = db): Promise<CompatibilityAssessment[]> {
  const all = await database.assessments.where('specimenId').equals(specimenId).toArray();
  return all.sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));
}

// ---------------------------------------------------------------------------
// Reveal (PRD 4.6)
// ---------------------------------------------------------------------------

/**
 * Compute and store the reveal-day rarity snapshot (FR-R01, FR-R05).
 *
 * Counts of prior confirmed catches come from the specimen table, so the
 * scarcity component reflects the user's real history at reveal time.
 */
export async function revealSpecimen(specimenId: Id, database: DB = db): Promise<RaritySnapshot | undefined> {
  const specimen = await database.specimens.get(specimenId);
  if (!specimen || specimen.identityStatus !== 'user-confirmed' || !specimen.speciesId) return undefined;

  const existing = await database.raritySnapshots.where('specimenId').equals(specimenId).first();
  if (existing) return existing;

  const confirmed = await database.specimens.where('identityStatus').equals('user-confirmed').toArray();
  const priorConfirmed = confirmed.filter((s) => s.id !== specimenId);
  const priorOfSpecies = priorConfirmed.filter((s) => s.speciesId === specimen.speciesId);

  const dreamItem = await database.dreamList.where('speciesId').equals(specimen.speciesId).first();
  const encounter = (await database.encounters.where('specimenId').equals(specimenId).toArray())
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))[0];

  // Market scarcity is a scored component as of formula v0.2.0.
  const market = computeMarketScarcity(marketFor(specimen.speciesId));

  const snapshot = computeDiscoveryTier({
    specimenId,
    speciesId: specimen.speciesId,
    isFirstConfirmedSpecies: priorOfSpecies.length === 0,
    dreamListAddedAt: dreamItem?.addedAt,
    encounterAt: encounter?.observedAt ?? specimen.createdAt,
    priorConfirmedCatches: priorConfirmed.length,
    priorCatchesOfSpecies: priorOfSpecies.length,
    isExceptionalSpecimen: specimen.exceptional ?? false,
    marketScarcityScore: market.available ? market.score : undefined,
    golden: Boolean(specimen.golden),
  });

  await database.transaction('rw', [database.raritySnapshots, database.dreamList], async () => {
    await database.raritySnapshots.add(snapshot);
    if (dreamItem && !dreamItem.fulfilledBySpecimenId) {
      await database.dreamList.update(dreamItem.id, { fulfilledBySpecimenId: specimenId });
    }
  });
  return snapshot;
}

/** FR-R06: Golden is a personal overlay and never rewrites objective data. */
export async function awardGolden(specimenId: Id, reason?: string, database: DB = db): Promise<void> {
  await database.specimens.update(specimenId, { golden: { awardedAt: nowIso(), reason }, updatedAt: nowIso() });
}

// ---------------------------------------------------------------------------
// Ownership and lifecycle (PRD 4.8)
// ---------------------------------------------------------------------------

/**
 * Advance the SAME specimen from encountered to resident (FR-T01).
 *
 * The new holding points back at the specimen, so the story continues rather
 * than forking into a disconnected duplicate record.
 */
export async function acquireSpecimen(
  specimenId: Id,
  aquariumId: Id,
  input: { on?: CalendarDate; quantity?: number; notes?: string } = {},
  database: DB = db,
): Promise<{ holding: Holding; residency: Residency; event: LifeEvent }> {
  const specimen = await database.specimens.get(specimenId);
  if (!specimen) throw new Error(`Unknown specimen ${specimenId}`);

  const on = input.on ?? today();
  const quantity = input.quantity ?? 1;
  const holding: Holding = {
    id: newId('hold'),
    specimenId,
    speciesId: specimen.speciesId,
    rawLabel: specimen.nickname ?? specimen.rawLabel,
    kind: specimen.kind,
    openingQuantity: 0,
    openingBalance: false,
    notes: input.notes,
    createdAt: nowIso(),
  };
  const residency: Residency = { id: newId('res'), holdingId: holding.id, aquariumId, startDate: on };
  const event: LifeEvent = {
    id: newId('evt'),
    holdingId: holding.id,
    type: 'acquired',
    occurredOn: on,
    quantityDelta: quantity,
    toAquariumId: aquariumId,
    notes: input.notes,
    createdAt: nowIso(),
  };

  await database.transaction(
    'rw',
    [database.holdings, database.residencies, database.lifeEvents, database.specimens],
    async () => {
      await database.holdings.add(holding);
      await database.residencies.add(residency);
      await database.lifeEvents.add(event);
      await database.specimens.update(specimenId, { status: 'resident', updatedAt: nowIso() });
    },
  );

  return { holding, residency, event };
}

/** FR-T02: an owned fish with no prior catch, e.g. an inventory opening balance. */
export async function createOpeningBalanceHolding(
  input: Omit<Holding, 'id' | 'createdAt' | 'openingBalance'> & { aquariumId: Id; on?: CalendarDate },
  database: DB = db,
): Promise<{ holding: Holding; residency: Residency }> {
  const { aquariumId, on, ...rest } = input;
  const holding: Holding = { ...rest, id: newId('hold'), openingBalance: true, createdAt: nowIso() };
  const residency: Residency = {
    id: newId('res'),
    holdingId: holding.id,
    aquariumId,
    startDate: on ?? today(),
    note: 'Opening balance - actual arrival date unknown',
  };
  await database.transaction('rw', [database.holdings, database.residencies], async () => {
    await database.holdings.add(holding);
    await database.residencies.add(residency);
  });
  return { holding, residency };
}

/** FR-T03: close the current interval, open the next, log the move. */
export async function moveHolding(
  holdingId: Id,
  toAquariumId: Id,
  on: CalendarDate = today(),
  database: DB = db,
): Promise<void> {
  const residencies = await database.residencies.where('holdingId').equals(holdingId).toArray();
  const plan = planMove(holdingId, toAquariumId, on, residencies, newId('res'));

  await database.transaction('rw', [database.residencies, database.lifeEvents], async () => {
    if (plan.close) await database.residencies.update(plan.close.id, { endDate: on });
    await database.residencies.add(plan.open);
    await database.lifeEvents.add({
      id: newId('evt'),
      holdingId,
      type: 'moved',
      occurredOn: on,
      quantityDelta: 0,
      fromAquariumId: plan.close?.aquariumId,
      toAquariumId,
      createdAt: nowIso(),
    });
  });
}

/** FR-T04: any dated quantity change - partial loss, sale, birth, correction. */
export async function recordLifeEvent(
  input: Omit<LifeEvent, 'id' | 'createdAt'>,
  database: DB = db,
): Promise<LifeEvent> {
  const event: LifeEvent = { ...input, id: newId('evt'), createdAt: nowIso() };
  await database.lifeEvents.add(event);
  return event;
}

// ---------------------------------------------------------------------------
// Fish Heaven (PRD 4.9)
// ---------------------------------------------------------------------------

export interface RecordDeathInput {
  holdingId: Id;
  specimenId?: Id;
  occurredOn?: CalendarDate;
  quantity?: number;
  story?: string;
  suspectedContributors?: string[];
  causeConfidence?: CauseConfidence;
  lesson?: string;
  /** Whether the fish's tank residency should close. False for a partial group loss. */
  closeResidency?: boolean;
}

/**
 * FR-L01: the fish moves into Fish Heaven WITHOUT leaving tank history. The
 * residency and media stay exactly where they are; only the live count moves.
 * FR-L02: "unknown" is a valid, complete answer for cause.
 */
export async function recordDeath(input: RecordDeathInput, database: DB = db): Promise<Memorial> {
  const on = input.occurredOn ?? today();
  const quantity = input.quantity ?? 1;
  const memorial: Memorial = {
    id: newId('mem'),
    holdingId: input.holdingId,
    specimenId: input.specimenId,
    occurredOn: on,
    quantity,
    story: input.story,
    suspectedContributors: input.suspectedContributors ?? [],
    causeConfidence: input.causeConfidence ?? 'unknown',
    lesson: input.lesson,
    createdAt: nowIso(),
  };

  await database.transaction(
    'rw',
    // `holdings` is in scope because the closure reads it to decide whether the
    // last animal has gone; Dexie requires every touched table to be declared.
    [database.memorials, database.lifeEvents, database.residencies, database.specimens, database.holdings],
    async () => {
      await database.memorials.add(memorial);
      await database.lifeEvents.add({
        id: newId('evt'),
        holdingId: input.holdingId,
        type: 'deceased',
        occurredOn: on,
        quantityDelta: -quantity,
        createdAt: nowIso(),
      });
      if (input.closeResidency !== false) {
        const holding = await database.holdings.get(input.holdingId);
        const events = await database.lifeEvents.where('holdingId').equals(input.holdingId).toArray();
        // Only close the tank placement once the last animal is gone.
        if (holding && deriveQuantity(holding, events) <= 0) {
          const open = (await database.residencies.where('holdingId').equals(input.holdingId).toArray())
            .find((r) => !r.endDate);
          if (open) await database.residencies.update(open.id, { endDate: on });
        }
      }
      if (input.specimenId) {
        await database.specimens.update(input.specimenId, { status: 'deceased', updatedAt: nowIso() });
      }
    },
  );

  return memorial;
}

/** FR-L04: a lesson becomes an optional private principle, linked to its fish. */
export async function createKeeperPrinciple(
  text: string,
  source: { memorialId?: Id; specimenId?: Id } = {},
  database: DB = db,
): Promise<void> {
  const id = newId('principle');
  await database.transaction('rw', [database.keeperPrinciples, database.memorials], async () => {
    await database.keeperPrinciples.add({
      id,
      text,
      sourceMemorialId: source.memorialId,
      sourceSpecimenId: source.specimenId,
      createdAt: nowIso(),
    });
    if (source.memorialId) await database.memorials.update(source.memorialId, { keeperPrincipleId: id });
  });
}

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

export async function upsertSpecies(species: Species, profile?: SpeciesProfile, database: DB = db): Promise<void> {
  await database.transaction('rw', [database.species, database.speciesProfiles], async () => {
    await database.species.put(species);
    if (profile) await database.speciesProfiles.put(profile);
  });
}

export async function upsertAquarium(aquarium: Aquarium, database: DB = db): Promise<void> {
  await database.aquariums.put(aquarium);
}

export async function addToDreamList(speciesId: Id, notes?: string, database: DB = db): Promise<void> {
  const existing = await database.dreamList.where('speciesId').equals(speciesId).first();
  if (existing) return;
  await database.dreamList.add({
    id: newId('dream'),
    speciesId,
    addedAt: nowIso(),
    source: 'search',
    notes,
  });
}

/** FR-I02: search common names, scientific names and store aliases alike. */
export async function searchSpecies(query: string, database: DB = db): Promise<Species[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await database.species.toArray();
  return all.filter(
    (s) =>
      s.commonName.toLowerCase().includes(q) ||
      s.scientificName?.toLowerCase().includes(q) ||
      s.aliases.some((a) => a.toLowerCase().includes(q)),
  );
}

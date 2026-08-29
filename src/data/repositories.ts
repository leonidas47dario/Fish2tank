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
  AquariumKind,
  AquariumStatus,
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
  Dimensions,
  RaritySnapshot,
  Residency,
  Species,
  SpeciesProfile,
  Specimen,
  SpecimenKind,
  VolumeMeasurement,
} from '@/domain/types';
import { deriveQuantity, planMove } from '@/domain/holdings';
import { evaluateAllTanks, type CandidateInput, type ResidentInput, type TankInput } from '@/engine/compatibility/engine';
import { computeDiscoveryTier } from '@/engine/rarity/discovery-tier';
import { scarcityFor } from './market';
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

/**
 * Detach captured bytes from the File before they go near IndexedDB.
 *
 * WHY THIS EXISTS. A File from `<input capture>` is a Blob backed by a path
 * the browser owns, not by bytes the page holds. That backing can go stale
 * between the change event and the transaction commit - the camera or photo
 * library hands over a reference and then invalidates it - and the structured
 * clone fails at write time. Dexie surfaces that as `blobs.bulkAdd()` naming
 * the table and nothing else, which is unactionable and was exactly the report
 * that prompted this.
 *
 * Reading into an ArrayBuffer first makes the stored blob self-contained, so
 * what we persist cannot depend on a handle we do not own. It also moves the
 * failure EARLIER and makes it legible: an unreadable photo is caught here, by
 * name and size, instead of half-way through a transaction.
 *
 * NFR-03 still holds - the bytes are copied, never re-encoded.
 */
async function detachFiles(files: CaptureFile[]): Promise<Array<CaptureFile & { data: ArrayBuffer }>> {
  return Promise.all(
    files.map(async (f, i) => {
      try {
        return { ...f, data: await f.blob.arrayBuffer() };
      } catch (cause) {
        throw new Error(
          `Could not read capture ${i + 1} of ${files.length} ` +
            `(${f.kind}, ${f.mimeType || 'unknown type'}, ${f.blob.size} bytes): ` +
            `${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
          { cause },
        );
      }
    }),
  );
}

/**
 * Turn a storage failure into something a person can act on.
 *
 * Dexie's own message is `blobs.bulkAdd()` plus, sometimes, a count. That says
 * which table refused and nothing about why, which is the difference between a
 * five-minute fix and a day of guessing. This pulls the underlying name out -
 * QuotaExceededError and DataCloneError need completely different responses -
 * and states how much was being written when it happened.
 */
export function storageError(cause: unknown, bytes: number, count: number): Error {
  const e = cause as { name?: string; message?: string; inner?: { name?: string; message?: string } };
  const inner = e?.inner;
  const name = inner?.name ?? e?.name ?? 'Error';
  const mb = (bytes / 1_048_576).toFixed(1);

  const advice =
    name === 'QuotaExceededError'
      ? 'This device is out of storage for the app. Free some space, or export and clear older catches.'
      : name === 'DataCloneError'
        ? 'The browser would not store this capture. Try taking the photo again rather than picking it from the library.'
        : name === 'InvalidStateError'
          ? 'Storage is unavailable — private browsing blocks it on some browsers.'
          : 'Could not write the capture to this device.';

  return new Error(
    `${advice} (${name} while saving ${count} file${count === 1 ? '' : 's'}, ${mb} MB${
      inner?.message || e?.message ? `: ${inner?.message ?? e?.message}` : ''
    })`,
    { cause },
  );
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
  const files = await detachFiles(input.files);
  const blobs = files.map((f) => {
    const key = newId('blob');
    const m: Media = {
      id: newId('media'),
      kind: f.kind,
      specimenIds: [specimen.id],
      encounterId: encounter.id,
      originalBlobKey: key,
      originalBytes: f.data.byteLength,
      mimeType: f.mimeType,
      durationSeconds: f.durationSeconds,
      capturedAt: at,
      syncState: 'local-draft',
    };
    media.push(m);
    return { key, data: f.data, bytes: f.data.byteLength, mimeType: f.mimeType, storedAt: at };
  });

  try {
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
  } catch (cause) {
    // The transaction rolls back as a unit, so there is no half-written draft
    // to clean up - but the caller still needs to know WHY, not just which
    // table refused.
    throw storageError(cause, blobs.reduce((n, b) => n + b.bytes, 0), blobs.length);
  }

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

/**
 * Record what the tag said, for a fish the catalog does not contain (spec 005).
 *
 * The escape hatch from mandatory identification. Since "all records must be
 * identified", the identify flow no longer lets you leave a catch Unknown -
 * but the catalog holds 2,178 species and a shop will sell one it has never
 * heard of, so without this a real catch could reach a screen with no exit.
 *
 * What makes this an identification rather than a skip: it demands the store's
 * wording, keeps it verbatim (FR-O05), and records `provisional` - which the
 * record then displays as weaker than a confirmed match rather than dressing
 * it up as one. No speciesId is invented, so nothing downstream can mistake
 * this for a catalog species.
 */
export async function recordStoreLabel(
  specimenId: Id,
  label: string,
  database: DB = db,
): Promise<void> {
  const text = label.trim();
  if (!text) throw new Error('A store label cannot be blank.');

  await assertIdentity(
    {
      specimenId,
      rawText: text,
      source: 'user',
      status: 'provisional',
      note: 'Not in the catalog. Recorded as the store labelled it.',
    },
    database,
  );
  await database.specimens.update(specimenId, { rawLabel: text, updatedAt: nowIso() });

  // Verify, rather than reporting a success nobody checked.
  const after = await database.specimens.get(specimenId);
  if (after?.identityStatus !== 'provisional' || after.rawLabel !== text) {
    console.error('[identify] store label did not stick', {
      specimenId, wanted: text,
      gotLabel: after?.rawLabel, gotStatus: after?.identityStatus,
    });
    throw new Error('That label could not be saved.');
  }
  console.info('[identify] recorded store label', { specimenId, label: text, status: 'provisional' });
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
/**
 * Every way a reveal can end.
 *
 * A discriminated union rather than `RaritySnapshot | undefined`, because as
 * of formula v0.3.0 there are two distinct reasons no snapshot comes back and
 * the UI has to say different things about them. Conflating them is not
 * hypothetical: the old code returned `undefined` for "already revealed", and
 * a refusal arriving down the same channel would have been announced to the
 * user as "this one was already revealed" - a plain lie about their record.
 */
export type RevealOutcome =
  | { status: 'revealed'; snapshot: RaritySnapshot }
  | { status: 'already-revealed'; snapshot: RaritySnapshot }
  | { status: 'not-identified' }
  | { status: 'no-market-evidence'; reason: string; explanation: string };

/**
 * Rate a confirmed catch, or decline to and say why (FR-R05, PRD 4.6).
 *
 * DECLINING IS THE COMMON CASE. 1,703 of 2,178 catalog species have no shelf
 * evidence, so most reveals end in `no-market-evidence`. That is the honest
 * answer, not a degraded one - see discovery-tier.ts on why absence must never
 * become a zero.
 *
 * Dream List fulfilment is recorded whether or not a snapshot follows. It used
 * to live inside the snapshot transaction, which was harmless while every
 * confirmed catch got a snapshot; under v0.3.0 that would have silently
 * stopped marking wishes fulfilled for 78% of the catalog.
 */
export async function revealSpecimen(specimenId: Id, database: DB = db): Promise<RevealOutcome> {
  const specimen = await database.specimens.get(specimenId);
  if (!specimen || specimen.identityStatus !== 'user-confirmed' || !specimen.speciesId) {
    console.info('[reveal] declined', {
      specimenId,
      outcome: 'not-identified',
      identityStatus: specimen?.identityStatus,
      speciesId: specimen?.speciesId,
    });
    return { status: 'not-identified' };
  }

  const speciesId = specimen.speciesId;

  // Fulfilment first, and outside any snapshot decision. A wish is granted by
  // meeting the fish, not by the fish scoring well enough to be rated.
  const dreamItem = await database.dreamList.where('speciesId').equals(speciesId).first();
  if (dreamItem && !dreamItem.fulfilledBySpecimenId) {
    await database.dreamList.update(dreamItem.id, { fulfilledBySpecimenId: specimenId });
    console.info('[reveal] dream list fulfilled', { specimenId, speciesId, dreamItemId: dreamItem.id });
  }

  const existing = await database.raritySnapshots.where('specimenId').equals(specimenId).first();
  if (existing) {
    console.info('[reveal] already revealed', {
      specimenId, speciesId, snapshotId: existing.id, formulaVersion: existing.formulaVersion,
    });
    return { status: 'already-revealed', snapshot: existing };
  }

  const market = scarcityFor(speciesId);
  if (!market.available) {
    // Logged rather than swallowed: this is the branch that produces no record
    // at all, so without a line here a missing snapshot is indistinguishable
    // from a reveal that never ran.
    console.info('[reveal] declined', {
      specimenId, speciesId, outcome: 'no-market-evidence', reason: market.reason,
    });
    return { status: 'no-market-evidence', reason: market.reason, explanation: market.explanation };
  }

  const snapshot = computeDiscoveryTier({
    specimenId,
    speciesId,
    marketScarcityScore: market.score,
    golden: Boolean(specimen.golden),
  });

  await database.raritySnapshots.add(snapshot);

  // Verify the write landed rather than reporting a success we did not check.
  const written = await database.raritySnapshots.get(snapshot.id);
  if (!written) {
    console.error('[reveal] snapshot vanished after add', { specimenId, speciesId, snapshotId: snapshot.id });
    throw new Error('The reveal could not be saved. Nothing was recorded.');
  }

  console.info('[reveal] revealed', {
    specimenId, speciesId, snapshotId: snapshot.id,
    tier: snapshot.tier, score: snapshot.totalScore,
    formulaVersion: snapshot.formulaVersion,
    witnessesCarrying: market.basis.witnessesCarrying,
    witnessesTracked: market.basis.witnessesTracked,
  });
  return { status: 'revealed', snapshot };
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

/**
 * The specimen a holding always implied, minted on demand.
 *
 * WHY THIS EXISTS. Media hangs off specimens, and an opening-balance holding
 * has no specimen - `Holding.specimenId` is optional by design (FR-T02),
 * because an imported inventory row records a fish you own without any
 * encounter ever having happened. The honest consequence was that a fish you
 * have kept for years had nowhere to put a photo.
 *
 * So the first photo mints it. The specimen is `resident`, not `encountered`:
 * you did not meet this fish in a store, it is simply yours. The identity goes
 * through assertIdentity with source 'import' rather than being stamped onto
 * the record, so the answer to "how do we know what this is?" stays auditable -
 * it came from your own spreadsheet, and the raw label travels with it
 * verbatim (FR-O05).
 *
 * Idempotent: a holding that already has a specimen returns it untouched.
 */
export async function ensureSpecimenForHolding(holdingId: Id, database: DB = db): Promise<Specimen> {
  const holding = await database.holdings.get(holdingId);
  if (!holding) throw new Error(`Unknown holding ${holdingId}`);

  if (holding.specimenId) {
    const existing = await database.specimens.get(holding.specimenId);
    if (existing) return existing;
  }

  const at = nowIso();
  const specimen: Specimen = {
    id: newId('spec'),
    kind: holding.kind,
    rawLabel: holding.rawLabel,
    identityStatus: 'unknown',
    status: 'resident',
    createdAt: at,
    updatedAt: at,
  };

  await database.transaction('rw', [database.specimens, database.holdings], async () => {
    await database.specimens.add(specimen);
    await database.holdings.update(holdingId, { specimenId: specimen.id });
  });

  if (holding.speciesId) {
    await assertIdentity(
      {
        specimenId: specimen.id,
        speciesId: holding.speciesId,
        rawText: holding.rawLabel,
        source: 'import',
        status: 'user-confirmed',
        note: holding.openingBalance
          ? 'Named in your own inventory, so the identity is yours rather than a guess.'
          : undefined,
      },
      database,
    );
    return { ...specimen, speciesId: holding.speciesId, identityStatus: 'user-confirmed' };
  }

  return specimen;
}

/**
 * Add photos or video to a specimen you already have.
 *
 * Deliberately not an encounter: `createCatchDraft` is for meeting a fish, and
 * reusing it here would invent a store visit that never happened. This is just
 * another look at a fish that is already yours, so it writes media and nothing
 * else. The blob is stored untouched (NFR-03).
 */
export async function addPhotos(
  input: { specimenId: Id; files: CaptureFile[]; capturedAt?: Instant },
  database: DB = db,
): Promise<Media[]> {
  const specimen = await database.specimens.get(input.specimenId);
  if (!specimen) throw new Error(`Unknown specimen ${input.specimenId}`);
  if (input.files.length === 0) return [];

  const at = input.capturedAt ?? nowIso();
  const media: Media[] = [];
  const files = await detachFiles(input.files);
  const blobs = files.map((f) => {
    const key = newId('blob');
    media.push({
      id: newId('media'),
      kind: f.kind,
      specimenIds: [input.specimenId],
      originalBlobKey: key,
      originalBytes: f.data.byteLength,
      mimeType: f.mimeType,
      durationSeconds: f.durationSeconds,
      capturedAt: at,
      syncState: 'local-draft',
    });
    return { key, data: f.data, bytes: f.data.byteLength, mimeType: f.mimeType, storedAt: at };
  });

  try {
    await database.transaction('rw', [database.media, database.blobs, database.specimens], async () => {
      await database.media.bulkAdd(media);
      await database.blobs.bulkAdd(blobs);
      await database.specimens.update(input.specimenId, { updatedAt: at });
    });
  } catch (cause) {
    throw storageError(cause, blobs.reduce((n, b) => n + b.bytes, 0), blobs.length);
  }

  return media;
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

/**
 * Put fish of a species straight into a tank (spec 005).
 *
 * THE GAP THIS FILLS. Until now the only routes into a tank were the inventory
 * import and the catch journey, so a fish you already keep and never
 * photographed in a shop could not be recorded at all. That is backwards: the
 * app is for the fish you have.
 *
 * NOT createOpeningBalanceHolding, which is next to this and looks similar.
 * That one is for a spreadsheet row: `openingBalance: true`, quantity carried
 * as `openingQuantity`, no life event, and an explicit note that the arrival
 * date is unknown. This is a dated acquisition you are choosing to record, so
 * it writes an `acquired` event and the quantity lives in the event where
 * every later adjustment lives too.
 *
 * CREATES NO SPECIMEN, deliberately. `Holding.specimenId` is optional by
 * design (FR-T02) and ensureSpecimenForHolding already mints one the moment a
 * photo is added. Minting eagerly here would duplicate that path and invent an
 * encounter that never happened.
 *
 * One species can be stocked into several tanks: each call makes its own
 * holding, which is how "one in the 75, one in the 40" is recorded. A holding
 * is in at most one tank ever - moveHolding closes one residency before
 * opening the next - so a second tank needs a second holding, not a move.
 */
export async function stockTank(
  input: {
    aquariumId: Id;
    speciesId?: Id;
    rawLabel?: string;
    quantity?: number;
    kind?: SpecimenKind;
    on?: CalendarDate;
    notes?: string;
  },
  database: DB = db,
): Promise<{ holding: Holding; residency: Residency; event: LifeEvent }> {
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`A tank cannot be stocked with ${quantity} fish.`);
  }
  const aquarium = await database.aquariums.get(input.aquariumId);
  if (!aquarium) throw new Error(`Unknown tank ${input.aquariumId}`);

  const on = input.on ?? today();
  const holding: Holding = {
    id: newId('hold'),
    speciesId: input.speciesId,
    rawLabel: input.rawLabel,
    kind: input.kind ?? (quantity > 1 ? 'group' : 'individual'),
    // Zero, with the count carried by the acquired event below - the same
    // shape acquireSpecimen uses, so deriveQuantity needs no special case.
    openingQuantity: 0,
    openingBalance: false,
    notes: input.notes,
    createdAt: nowIso(),
  };
  const residency: Residency = {
    id: newId('res'), holdingId: holding.id, aquariumId: input.aquariumId, startDate: on,
  };
  const event: LifeEvent = {
    id: newId('evt'),
    holdingId: holding.id,
    type: 'acquired',
    occurredOn: on,
    quantityDelta: quantity,
    toAquariumId: input.aquariumId,
    notes: input.notes,
    createdAt: nowIso(),
  };

  await database.transaction(
    'rw',
    [database.holdings, database.residencies, database.lifeEvents],
    async () => {
      await database.holdings.add(holding);
      await database.residencies.add(residency);
      await database.lifeEvents.add(event);
    },
  );

  console.info('[stock] added to tank', {
    holdingId: holding.id, aquariumId: input.aquariumId, tank: aquarium.name,
    speciesId: input.speciesId, quantity, on,
  });
  return { holding, residency, event };
}

/**
 * Change how many of a holding are alive, in either direction (FR-T04).
 *
 * recordDeath already writes a negative delta. Nothing wrote a positive one,
 * so buying three more of a fish you keep was unrecordable - the only way to
 * express it was a second holding, which then read as a separate group in a
 * separate row of the same tank.
 */
export async function adjustHoldingQuantity(
  input: { holdingId: Id; delta: number; on?: CalendarDate; notes?: string },
  database: DB = db,
): Promise<LifeEvent> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error(`A quantity change of ${input.delta} says nothing.`);
  }
  const holding = await database.holdings.get(input.holdingId);
  if (!holding) throw new Error(`Unknown holding ${input.holdingId}`);

  const events = await database.lifeEvents.where('holdingId').equals(input.holdingId).toArray();
  const before = deriveQuantity(holding, events);
  if (before + input.delta < 0) {
    // Refusing beats silently clamping to zero: the user believes they have
    // more than the record does, and one of those is wrong in a way worth
    // noticing.
    throw new Error(`That would take the count below zero — there ${before === 1 ? 'is' : 'are'} ${before} recorded.`);
  }

  const event: LifeEvent = {
    id: newId('evt'),
    holdingId: input.holdingId,
    // 'acquired' when fish arrive, 'quantity-adjusted' when the record was
    // simply wrong. Both already exist; using one for the other would make the
    // journal lie about what happened.
    type: input.delta > 0 ? 'acquired' : 'quantity-adjusted',
    occurredOn: input.on ?? today(),
    quantityDelta: input.delta,
    notes: input.notes,
    createdAt: nowIso(),
  };
  await database.lifeEvents.add(event);

  const after = deriveQuantity(holding, [...events, event]);
  if (after !== before + input.delta) {
    console.error('[stock] quantity did not move as expected', {
      holdingId: input.holdingId, before, delta: input.delta, after,
    });
    throw new Error('That change could not be recorded.');
  }
  console.info('[stock] quantity adjusted', {
    holdingId: input.holdingId, before, delta: input.delta, after, type: event.type,
  });
  return event;
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

/**
 * Take a species back off the Dream List.
 *
 * The list and its scoring existed from the start - a fish you had listed and
 * then found is worth 25 points on the Discovery tier - but no screen could
 * add to it and none could take anything off it, so in practice it was
 * permanently empty and Home rendered a standing instruction to use a screen
 * that did not do this. Adding without removing is a one-way door; a wanted
 * list you cannot stop wanting from stops being one within a month.
 *
 * A FULFILLED entry is never deleted here. That one is history: it records
 * that you wanted this fish before you found it, which is the whole reason
 * the tier can award for it. See revealSpecimen.
 */
export async function removeFromDreamList(speciesId: Id, database: DB = db): Promise<void> {
  const existing = await database.dreamList.where('speciesId').equals(speciesId).first();
  if (!existing || existing.fulfilledBySpecimenId) return;
  await database.dreamList.delete(existing.id);
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

// ─────────────────────────────────────────────────────────────────────────
// Editing and deleting a catch
// ─────────────────────────────────────────────────────────────────────────

export interface UpdateCatchInput {
  specimenId: Id;
  /** Which encounter to amend. Defaults to the most recent one. */
  encounterId?: Id;
  /** Narrative name. Pass null to clear it. */
  nickname?: string | null;
  /** The store's own label, verbatim. Pass null to clear it. */
  rawLabel?: string | null;
  exceptional?: boolean;
  observedAt?: Instant;
  placeId?: Id | null;
  quantitySeen?: number | null;
  observedSize?: LengthMeasurement | null;
  rawTankLabel?: string | null;
  observedTankmates?: string | null;
  originLocality?: string | null;
  notes?: string | null;
}

/**
 * Correct what you recorded about a catch.
 *
 * WHAT THIS IS FOR, AND WHAT IT REFUSES TO TOUCH.
 *
 * These are observations the user made, and an observation can simply be wrong:
 * the date defaults to "now" and the visit was yesterday, the nickname was a
 * typo, the store label was misread. Fixing those is not rewriting history, it
 * is making the record true - and FR-C03 has always specified the encounter
 * time as "automatic but editable".
 *
 * IDENTITY IS NOT IN THIS LIST, deliberately. Changing which species a catch is
 * goes through assertIdentity, which supersedes the earlier assertion instead
 * of overwriting it and keeps source, date and status (FR-I06, NFR-09). If
 * this function could set speciesId, the audit trail would have a hole in it
 * exactly where the interesting decisions are made. Same for rarity tiers and
 * compatibility verdicts: those are recomputed into new snapshots, never
 * edited.
 *
 * `undefined` means "leave alone"; `null` means "clear this field". Without
 * that distinction there is no way to remove a nickname you no longer want.
 */
export async function updateCatch(input: UpdateCatchInput, database: DB = db): Promise<void> {
  const specimen = await database.specimens.get(input.specimenId);
  if (!specimen) throw new Error(`No such catch: ${input.specimenId}`);

  const encounters = await database.encounters.where('specimenId').equals(input.specimenId).toArray();
  encounters.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const target = input.encounterId
    ? encounters.find((e) => e.id === input.encounterId)
    : encounters[encounters.length - 1];

  // A field is only written when the caller mentioned it, so a form that
  // submits three fields cannot blank the other seven.
  const set = <T>(value: T | null | undefined, current: T | undefined): T | undefined =>
    value === undefined ? current : (value === null ? undefined : value);

  await database.transaction('rw', [database.specimens, database.encounters], async () => {
    await database.specimens.update(input.specimenId, {
      nickname: set(input.nickname, specimen.nickname),
      rawLabel: set(input.rawLabel, specimen.rawLabel),
      exceptional: input.exceptional === undefined ? specimen.exceptional : input.exceptional,
      updatedAt: nowIso(),
    });

    if (target) {
      await database.encounters.update(target.id, {
        observedAt: input.observedAt ?? target.observedAt,
        placeId: set(input.placeId, target.placeId),
        quantitySeen: set(input.quantitySeen, target.quantitySeen),
        observedSize: set(input.observedSize, target.observedSize),
        rawTankLabel: set(input.rawTankLabel, target.rawTankLabel),
        observedTankmates: set(input.observedTankmates, target.observedTankmates),
        originLocality: set(input.originLocality, target.originLocality),
        notes: set(input.notes, target.notes),
      });
    }
  });
}

/** What a delete would remove, or why it will not happen. */
export interface DeleteCatchPlan {
  allowed: boolean;
  /** Why not, in words a person can act on. Present only when refused. */
  reason?: string;
  encounters: number;
  /** Media removed outright, because nothing else refers to them. */
  media: number;
  /** Media kept because another catch also uses them. */
  mediaSharedElsewhere: number;
  prices: number;
  assessments: number;
  reveals: number;
  identifications: number;
}

/**
 * What deleting this catch would take with it.
 *
 * Separated from the delete itself so the confirmation can state the real
 * consequences - "3 photos and the reveal" - rather than asking the user to
 * accept an unspecified cascade.
 */
export async function planDeleteCatch(specimenId: Id, database: DB = db): Promise<DeleteCatchPlan> {
  const [encounters, allMedia, prices, assessments, reveals, ids, holdings, memorials] =
    await Promise.all([
      database.encounters.where('specimenId').equals(specimenId).toArray(),
      database.media.where('specimenIds').equals(specimenId).toArray(),
      database.priceObservations.where('specimenId').equals(specimenId).toArray(),
      database.assessments.where('specimenId').equals(specimenId).toArray(),
      database.raritySnapshots.where('specimenId').equals(specimenId).toArray(),
      database.identifications.where('specimenId').equals(specimenId).toArray(),
      database.holdings.where('specimenId').equals(specimenId).toArray(),
      database.memorials.where('specimenId').equals(specimenId).toArray(),
    ]);

  const shared = allMedia.filter((m) => m.specimenIds.filter((s) => s !== specimenId).length > 0);

  const plan: DeleteCatchPlan = {
    allowed: true,
    encounters: encounters.length,
    media: allMedia.length - shared.length,
    mediaSharedElsewhere: shared.length,
    prices: prices.length,
    assessments: assessments.length,
    reveals: reveals.length,
    identifications: ids.length,
  };

  /**
   * A fish you actually keep is not a catch you can delete.
   *
   * The holding, its dated residencies and its lifecycle events are tank
   * history, and principle 3 is that the app never rewrites that - "a fish that
   * dies stays in the tank history it lived through". Deleting the specimen
   * underneath a holding would either orphan those rows or quietly destroy
   * them, and neither is something a delete button should do silently. So it
   * refuses and says where to go instead.
   */
  if (holdings.length > 0) {
    return {
      ...plan,
      allowed: false,
      reason: 'This fish is in one of your tanks, so its catch record is part of that tank\'s history. '
        + 'Remove it from the tank first if it is no longer there.',
    };
  }
  if (memorials.length > 0) {
    return {
      ...plan,
      allowed: false,
      reason: 'This fish has a memorial in Fish Heaven. That record is deliberately permanent.',
    };
  }

  return plan;
}

/**
 * Delete a catch and everything that only existed because of it.
 *
 * WHY THIS EXISTS IN AN APP THAT NEVER REWRITES HISTORY. Deleting says "this
 * encounter never happened" - a mis-tap, a duplicate, test data - which is a
 * different claim from "I was wrong about the species" or "the fish died".
 * Those two already have honest paths that preserve the past (assertIdentity
 * supersedes, recordDeath memorialises), and this does not compete with them:
 * planDeleteCatch refuses outright for anything held in a tank or memorialised.
 *
 * Everything removed here is downstream of the catch and meaningless without
 * it: a price you noted on this fish, a screening of this fish against your
 * tanks, its reveal, its identification trail. Species-level price notes are
 * NOT removed, because those are market observations that outlive the catch.
 *
 * Photos are detached rather than destroyed when another catch also uses them.
 * The media IS the record (principle P3), so deleting one catch must never
 * take another catch's only photo with it.
 */
export async function deleteCatch(specimenId: Id, database: DB = db): Promise<DeleteCatchPlan> {
  const plan = await planDeleteCatch(specimenId, database);
  if (!plan.allowed) return plan;

  const encounters = await database.encounters.where('specimenId').equals(specimenId).toArray();
  const encounterIds = new Set(encounters.map((e) => e.id));
  const media = await database.media.where('specimenIds').equals(specimenId).toArray();
  const drafts = (await database.draftKeys.toArray()).filter((d) => d.specimenId === specimenId);

  // Price rows tied to this catch, plus any that point at an encounter about to
  // disappear - a dangling encounterId would outlive the thing it names.
  const prices = await database.priceObservations.toArray();
  const priceIds = prices
    .filter((p) => p.specimenId === specimenId || (p.encounterId && encounterIds.has(p.encounterId)))
    .map((p) => p.id);

  await database.transaction(
    'rw',
    [
      database.specimens, database.encounters, database.media, database.blobs,
      database.identifications, database.priceObservations, database.raritySnapshots,
      database.assessments, database.draftKeys, database.deletedRecords,
    ],
    async () => {
      for (const m of media) {
        const others = m.specimenIds.filter((s) => s !== specimenId);
        if (others.length > 0) {
          // Another catch still needs this photo. Detach, never destroy.
          await database.media.update(m.id, { specimenIds: others });
        } else {
          await database.media.delete(m.id);
          if (m.originalBlobKey) await database.blobs.delete(m.originalBlobKey);
        }
      }

      await database.encounters.bulkDelete([...encounterIds]);
      await database.identifications.bulkDelete(
        (await database.identifications.where('specimenId').equals(specimenId).toArray()).map((r) => r.id),
      );
      await database.priceObservations.bulkDelete(priceIds);
      await database.raritySnapshots.bulkDelete(
        (await database.raritySnapshots.where('specimenId').equals(specimenId).toArray()).map((r) => r.id),
      );
      await database.assessments.bulkDelete(
        (await database.assessments.where('specimenId').equals(specimenId).toArray()).map((r) => r.id),
      );
      await database.draftKeys.bulkDelete(drafts.map((d) => d.clientKey));
      await database.specimens.delete(specimenId);

      // Remembered so a seeded record cannot come back on the next boot.
      await database.deletedRecords.put({ id: specimenId, kind: 'specimen', deletedAt: nowIso() });
    },
  );

  return plan;
}

/**
 * Set (or replace) the photo that represents a tank.
 *
 * The Aquarium type has carried `photoMediaId` since the schema was written and
 * nothing ever filled it. It stores a real Media row rather than a loose blob,
 * so a tank photo obeys the same rules as every other picture in the app -
 * bytes inline (see StoredBlob), original never downsampled (NFR-03).
 *
 * It has no encounter and no specimen: `encounterId` is optional and
 * `specimenIds` is empty, because a photo of the glass is not a sighting of a
 * fish and must never be counted as one.
 *
 * REPLACING DELETES THE OLD ONE. A tank has exactly one photo, so keeping the
 * previous blob would silently grow the device's storage every time somebody
 * retook it - and on a phone that budget is the app's to respect.
 */
export async function setTankPhoto(
  aquariumId: Id,
  file: CaptureFile,
  database: DB = db,
): Promise<Media> {
  const aquarium = await database.aquariums.get(aquariumId);
  if (!aquarium) throw new Error(`Unknown tank ${aquariumId}`);

  const [detached] = await detachFiles([file]);
  if (!detached) throw new Error('Could not read that photo.');

  const at = nowIso();
  const blobKey = newId('blob');
  const media: Media = {
    id: newId('media'),
    kind: 'photo',
    specimenIds: [],
    originalBlobKey: blobKey,
    originalBytes: detached.data.byteLength,
    mimeType: detached.mimeType,
    capturedAt: at,
    syncState: 'local-draft',
  };

  const previous = aquarium.photoMediaId
    ? await database.media.get(aquarium.photoMediaId)
    : undefined;

  try {
    await database.transaction(
      'rw',
      [database.media, database.blobs, database.aquariums],
      async () => {
        await database.blobs.add({
          key: blobKey, data: detached.data, bytes: detached.data.byteLength,
          mimeType: detached.mimeType, storedAt: at,
        });
        await database.media.add(media);
        await database.aquariums.update(aquariumId, { photoMediaId: media.id });
        if (previous) {
          await database.media.delete(previous.id);
          await database.blobs.delete(previous.originalBlobKey);
        }
      },
    );
  } catch (cause) {
    throw storageError(cause, detached.data.byteLength, 1);
  }

  return media;
}

/** Remove a tank's photo, leaving the tank itself alone. */
export async function clearTankPhoto(aquariumId: Id, database: DB = db): Promise<void> {
  const aquarium = await database.aquariums.get(aquariumId);
  if (!aquarium?.photoMediaId) return;
  const media = await database.media.get(aquarium.photoMediaId);

  await database.transaction(
    'rw',
    [database.media, database.blobs, database.aquariums, database.deletedRecords],
    async () => {
      if (media) {
        await database.media.delete(media.id);
        await database.blobs.delete(media.originalBlobKey);
      }
      await database.aquariums.update(aquariumId, { photoMediaId: undefined });
      // Tombstoned, or bootstrap's seedTankPhoto puts a bundled photo straight
      // back on the next load - the same way the Panther used to return.
      if (media) {
        await database.deletedRecords.put({ id: media.id, kind: 'media', deletedAt: nowIso() });
      }
    },
  );
}

/**
 * Create a tank.
 *
 * Volume and dimensions are optional on purpose. A tank you have not measured
 * yet is a real tank, and FR-E05 wants "Not enough data" rather than a guess -
 * so this refuses to invent a footprint from a gallon figure, and the screening
 * rules simply report what they are missing until someone measures it.
 */
export async function createAquarium(
  input: {
    name: string;
    kind: AquariumKind;
    volume?: VolumeMeasurement;
    dimensions?: Dimensions;
    notes?: string;
  },
  database: DB = db,
): Promise<Aquarium> {
  const name = input.name.trim();
  if (!name) throw new Error('A tank needs a name.');

  const aquarium: Aquarium = {
    id: newId('tank'),
    name,
    kind: input.kind,
    volume: input.volume,
    dimensions: input.dimensions,
    status: 'active',
    notes: input.notes?.trim() || undefined,
    createdAt: nowIso(),
  };
  await database.aquariums.add(aquarium);
  return aquarium;
}

/**
 * Retire a tank, or bring it back.
 *
 * Retiring is the non-destructive way to get a broken-down tank out of the way:
 * the record and every residency that names it stay exactly as they were, so a
 * fish that lived there still says so. AquariumStatus has carried 'retired'
 * since the schema was written and nothing could ever set it.
 */
export async function setAquariumStatus(
  aquariumId: Id,
  status: AquariumStatus,
  database: DB = db,
): Promise<void> {
  await database.aquariums.update(aquariumId, { status });
}

export interface DeleteTankPlan {
  allowed: boolean;
  /** Why not, in words a person can act on. Present only when refused. */
  reason?: string;
  /** Fish living in it right now. */
  residents: number;
  /** Ended residencies - fish that lived here and have since moved on. */
  pastResidencies: number;
  /** Move events naming this tank as an origin or destination. */
  moveEvents: number;
  /** Cached screenings against this tank, discarded with it. */
  assessments: number;
  /** Whether a tank photo goes with it. */
  photo: boolean;
}

/**
 * What deleting this tank would take with it, and whether it may go at all.
 *
 * Two refusals, for two different reasons:
 *
 * OCCUPIED. Fish live there. Deleting the tank under them would strand the
 * holdings - rows describing a fish in a place that no longer exists. Move them
 * or record the loss first; both are one tap away on the same screen.
 *
 * HISTORICAL. A residency or a move event names this tank in the past. Those
 * rows are history, and principle 3 is that the app never rewrites it. Deleting
 * the tank does not delete them; it leaves them pointing at nothing, and a
 * fish's timeline that said "moved to Predator Tank" starts saying "moved to
 * tank_a3f9c2". Retiring is the honest way to put such a tank away - it stops
 * appearing among your active tanks and every record that names it still reads
 * correctly.
 *
 * A tank that never held anything has no history to protect, so it just goes.
 */
export async function planDeleteTank(aquariumId: Id, database: DB = db): Promise<DeleteTankPlan> {
  const [aquarium, residencies, events, assessments] = await Promise.all([
    database.aquariums.get(aquariumId),
    database.residencies.where('aquariumId').equals(aquariumId).toArray(),
    database.lifeEvents.toArray(),
    database.assessments.where('aquariumId').equals(aquariumId).toArray(),
  ]);

  const current = residencies.filter((r) => !r.endDate);
  const past = residencies.filter((r) => r.endDate);
  const moves = events.filter(
    (e) => e.fromAquariumId === aquariumId || e.toAquariumId === aquariumId,
  );

  const plan: DeleteTankPlan = {
    allowed: true,
    residents: current.length,
    pastResidencies: past.length,
    moveEvents: moves.length,
    assessments: assessments.length,
    photo: Boolean(aquarium?.photoMediaId),
  };

  if (!aquarium) return { ...plan, allowed: false, reason: 'That tank no longer exists.' };

  if (current.length > 0) {
    const fish = current.length === 1 ? 'one group of fish' : `${current.length} groups of fish`;
    return {
      ...plan,
      allowed: false,
      reason: `${aquarium.name} still holds ${fish}. Move them to another tank, or record the loss, `
        + 'and then it can go.',
    };
  }

  if (past.length > 0 || moves.length > 0) {
    return {
      ...plan,
      allowed: false,
      reason: `Fish have lived in ${aquarium.name} before, and their history still names it. `
        + 'Deleting the tank would leave those records pointing at nothing. Retire it instead - '
        + 'it leaves your active tanks and every past record still reads correctly.',
    };
  }

  return plan;
}

/**
 * Delete a tank that never held a fish.
 *
 * planDeleteTank refuses anything with residents or history, so by the time we
 * get here the only things to clean up are the tank, its photo, and any cached
 * screening against it. Assessments are derived - re-running the check
 * regenerates them - so they go without ceremony.
 */
export async function deleteTank(aquariumId: Id, database: DB = db): Promise<DeleteTankPlan> {
  const plan = await planDeleteTank(aquariumId, database);
  if (!plan.allowed) return plan;

  const aquarium = await database.aquariums.get(aquariumId);
  const media = aquarium?.photoMediaId ? await database.media.get(aquarium.photoMediaId) : undefined;
  const assessments = await database.assessments.where('aquariumId').equals(aquariumId).toArray();

  await database.transaction(
    'rw',
    [
      database.aquariums, database.media, database.blobs,
      database.assessments, database.deletedRecords,
    ],
    async () => {
      if (media) {
        await database.media.delete(media.id);
        await database.blobs.delete(media.originalBlobKey);
        await database.deletedRecords.put({ id: media.id, kind: 'media', deletedAt: nowIso() });
      }
      await database.assessments.bulkDelete(assessments.map((a) => a.id));
      await database.aquariums.delete(aquariumId);
      // Remembered so a seeded tank cannot come back on the next boot.
      await database.deletedRecords.put({ id: aquariumId, kind: 'aquarium', deletedAt: nowIso() });
    },
  );

  return plan;
}

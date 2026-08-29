/**
 * First-run seeding.
 *
 * Seeds the species catalog, Ryan's six enclosures, his real 61-row inventory,
 * and the Panther encounter that PRD section 10 is built around - so the app
 * opens on real data rather than an empty shell.
 *
 * Only the 75G gets real dimensions (a standard 75-gallon footprint is a known
 * 48 x 18 x 21 inches). The other five are seeded unmeasured on purpose: the
 * source sheet has no volume or dimension column, and the honest consequence -
 * screening returns "Not enough data" until they are measured - is exactly
 * what FR-E05 asks for. A guessed volume would produce confident answers built
 * on nothing.
 */
import { db } from './db';
import { SPECIES_CATALOG } from './seed/species-catalog';
import { assertIdentity, recordPrice, upsertSpecies } from './repositories';
import { applyInventoryImport } from './import-service';
import { parseInventoryCsv } from './seed/inventory-import';
import type { Aquarium, Id } from '@/domain/types';
import inventoryCsv from './seed/fish_inventory.csv?raw';
import pantherPhotoUrl from './seed/assets/the-panther.jpg';
import deepSeaPhotoUrl from './seed/assets/tank-deep-sea-collector.jpg';
import peacefulGardenPhotoUrl from './seed/assets/tank-peaceful-garden.jpg';

const SEEDED_AT = '2026-08-27T00:00:00.000Z';
const NEEDS_MEASURING = 'Add volume and dimensions to enable compatibility screening.';

/**
 * DO NOT RENAME THESE. The names here are a join key, not a label.
 *
 * fish_inventory.csv addresses its tanks by name, and applyInventoryImport
 * matches an imported label to an existing tank by name. Rename a tank here and
 * the import stops matching it, silently creating a second empty tank beside it
 * and leaving 61 fish in the wrong one. The display names the owner actually
 * sees are applied afterwards by updateSeededTanks(), which runs once the
 * import has already linked everything up.
 */
export const STARTER_TANKS: Aquarium[] = [
  {
    id: 'tank_75g', name: '75G', kind: 'display',
    volume: { value: 75, unit: 'gal' },
    dimensions: {
      length: { value: 48, unit: 'in' },
      width: { value: 18, unit: 'in' },
      height: { value: 21, unit: 'in' },
    },
    status: 'active', stockingState: 'crowded', createdAt: SEEDED_AT,
  },
  { id: 'tank_breeder_tote', name: 'Breeder Tote', kind: 'tote', status: 'active', notes: NEEDS_MEASURING, createdAt: SEEDED_AT },
  { id: 'tank_quarantine', name: 'Quarantine', kind: 'quarantine', status: 'active', notes: NEEDS_MEASURING, createdAt: SEEDED_AT },
  { id: 'tank_bass_tote', name: 'Bass Tote', kind: 'tote', status: 'active', notes: NEEDS_MEASURING, createdAt: SEEDED_AT },
  {
    id: 'tank_mini', name: 'Mini Tank', kind: 'display', status: 'active',
    // Volume as the owner stated it. Dimensions deliberately absent: nobody has
    // measured the footprint, and the swim-space and minimum-footprint factors
    // both need it, so this unlocks the volume check and says "not enough data"
    // for the rest rather than inventing a 30 x 12 because that is what a
    // 20-gallon usually is.
    volume: { value: 20, unit: 'gal' }, notes: NEEDS_MEASURING, createdAt: SEEDED_AT,
  },
  {
    id: 'tank_predator', name: 'Predator Tank', kind: 'display', status: 'active',
    volume: { value: 40, unit: 'gal' }, notes: NEEDS_MEASURING, createdAt: SEEDED_AT,
  },
];

export const STARTER_PLACE = {
  id: 'place_aquarium_adventure',
  name: 'Aquarium Adventure',
  type: 'fish-store' as const,
  coarseLocation: 'Chicago area',
  // NFR-04 / 8.2: exact locations stay private and never leave the device.
  privacy: 'private-exact' as const,
  isFavorite: true,
  createdAt: SEEDED_AT,
};

const PANTHER_ID = 'spec_the_panther';
const PANTHER_ENCOUNTER_ID = 'enc_the_panther';

/**
 * The encounter the PRD is written around, seeded so the product is legible on
 * first open. The bundled photo is a 1400px derivative of the original
 * capture; the full-resolution original lives at docs/the-panther-original.jpg
 * rather than in the app bundle. NFR-03's "never silently downsample the only
 * copy" governs the user's own captures, not a demo asset shipped with the app.
 */
async function seedPanther(): Promise<void> {
  if (await db.specimens.get(PANTHER_ID)) return;
  // Deleted on purpose stays deleted. Without this the seeder's own "does it
  // exist?" guard turns a delete into a temporary hide, and the Panther walks
  // back in on the next load.
  if (await db.deletedRecords.get(PANTHER_ID)) return;

  const observedAt = '2026-08-27T15:04:00.000Z';
  await db.specimens.add({
    id: PANTHER_ID,
    kind: 'individual',
    identityStatus: 'unknown',
    status: 'encountered',
    nickname: 'the Panther',
    createdAt: observedAt,
    updatedAt: observedAt,
  });
  await db.encounters.add({
    id: PANTHER_ENCOUNTER_ID,
    specimenId: PANTHER_ID,
    placeId: STARTER_PLACE.id,
    observedAt,
    observedSize: { value: 6, unit: 'in', estimate: true },
    quantitySeen: 1,
    notes: 'Arrived that morning. Went in for plants with a friend and left with this instead — a photo, not a fish.',
    createdAt: observedAt,
    syncState: 'local-draft',
  });

  // The photo ships as a bundled asset; fetch it back into a blob so it lives
  // in the same store as any real capture.
  try {
    const res = await fetch(pantherPhotoUrl);
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    // Stored as bytes, same as any real capture — see StoredBlob in db.ts for
    // why a Blob in IndexedDB is not safe on WebKit.
    const data = await res.arrayBuffer();
    const blobKey = 'blob_the_panther';
    await db.blobs.add({
      key: blobKey, data, bytes: data.byteLength, mimeType, storedAt: observedAt,
    });
    await db.media.add({
      id: 'media_the_panther',
      kind: 'photo',
      specimenIds: [PANTHER_ID],
      encounterId: PANTHER_ENCOUNTER_ID,
      originalBlobKey: blobKey,
      originalBytes: data.byteLength,
      mimeType,
      capturedAt: observedAt,
      syncState: 'local-draft',
    });
  } catch {
    // A missing demo photo must never stop the app booting.
  }

  await assertIdentity({
    specimenId: PANTHER_ID, speciesId: 'sp_jaguar_cichlid', source: 'user', status: 'user-confirmed',
  });

  // $100 asking / $75 member, plus the smaller J4 seen elsewhere for $50.
  await recordPrice({
    specimenId: PANTHER_ID, speciesId: 'sp_jaguar_cichlid', encounterId: PANTHER_ENCOUNTER_ID,
    placeId: STARTER_PLACE.id, askingPrice: 100, memberPrice: 75,
    observedSize: { value: 6, unit: 'in', estimate: true }, observedAt,
  });
  await recordPrice({
    speciesId: 'sp_jaguar_cichlid', askingPrice: 50, observedSize: { value: 4, unit: 'in' },
    source: 'online-manual', note: 'Smaller J4 seen elsewhere', observedAt: '2026-08-20T00:00:00.000Z',
  });
}

/**
 * Bring a device that already has the seeded tanks up to their current names,
 * volumes and photos.
 *
 * WHY THIS EXISTS. STARTER_TANKS only runs when there are no aquariums at all,
 * so editing it renames tanks on a fresh install and does nothing whatsoever on
 * the phone that actually has the fish. This is the pass that reaches an
 * existing device.
 *
 * IT ONLY TOUCHES WHAT NOBODY HAS TOUCHED. A record is updated only while it
 * still carries the exact name it was seeded with - the signature of a record
 * no human has renamed. If the owner has already called it something else,
 * that is a decision, and this walks past it.
 */
const TANK_UPDATES: Array<{
  id: Id; wasNamed: string; name: string;
  volume?: { value: number; unit: 'gal' };
  photo?: { key: string; url: string };
}> = [
  { id: 'tank_75g', wasNamed: '75G', name: 'Deep Sea Collector',
    photo: { key: 'blob_tank_75g', url: deepSeaPhotoUrl } },
  { id: 'tank_mini', wasNamed: 'Mini Tank', name: 'Peaceful Garden',
    volume: { value: 20, unit: 'gal' },
    photo: { key: 'blob_tank_mini', url: peacefulGardenPhotoUrl } },
  { id: 'tank_predator', wasNamed: 'Predator Tank', name: 'Dune',
    volume: { value: 40, unit: 'gal' } },
];

async function updateSeededTanks(): Promise<void> {
  for (const u of TANK_UPDATES) {
    const tank = await db.aquariums.get(u.id);
    if (!tank) continue;

    // Renamed by a person? Then it is theirs, and none of this applies.
    if (tank.name !== u.wasNamed && tank.name !== u.name) continue;

    const patch: Partial<Aquarium> = {};
    if (tank.name === u.wasNamed) patch.name = u.name;
    // A volume the owner has since set by hand always wins.
    if (u.volume && !tank.volume) patch.volume = u.volume;
    if (Object.keys(patch).length) await db.aquariums.update(u.id, patch);

    if (u.photo) await seedTankPhoto(u.id, u.photo.key, u.photo.url);
  }
}

/**
 * Attach a bundled photo to a tank, once.
 *
 * Skipped when the tank already has a photo - one the owner took beats one that
 * shipped - and when the media id is tombstoned, so a photo they deleted does
 * not walk back in on the next load the way the Panther would have.
 */
async function seedTankPhoto(aquariumId: Id, blobKey: string, url: string): Promise<void> {
  const mediaId = `media_${blobKey}`;
  const tank = await db.aquariums.get(aquariumId);
  if (!tank || tank.photoMediaId) return;
  if (await db.deletedRecords.get(mediaId)) return;

  try {
    const res = await fetch(url);
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    const data = await res.arrayBuffer();
    await db.transaction('rw', [db.blobs, db.media, db.aquariums], async () => {
      await db.blobs.put({ key: blobKey, data, bytes: data.byteLength, mimeType, storedAt: SEEDED_AT });
      await db.media.put({
        id: mediaId, kind: 'photo', specimenIds: [], originalBlobKey: blobKey,
        originalBytes: data.byteLength, mimeType, capturedAt: SEEDED_AT, syncState: 'local-draft',
      });
      await db.aquariums.update(aquariumId, { photoMediaId: mediaId });
    });
  } catch {
    // A missing bundled photo must never stop the app booting.
  }
}

let started: Promise<void> | undefined;

export function bootstrap(): Promise<void> {
  started ??= (async () => {
    if ((await db.species.count()) === 0) {
      for (const entry of SPECIES_CATALOG) await upsertSpecies(entry.species, entry.profile);
    }
    if ((await db.aquariums.count()) === 0) {
      // Not simply STARTER_TANKS: deleting every tank would take the count back
      // to zero and seed all six straight back, which reads as the delete
      // having silently failed. A tank the owner deleted stays deleted.
      const tombstoned = new Set((await db.deletedRecords.toArray()).map((r) => r.id));
      const fresh = STARTER_TANKS.filter((t) => !tombstoned.has(t.id));
      if (fresh.length) await db.aquariums.bulkAdd(fresh);
    }
    if ((await db.places.count()) === 0) await db.places.add(STARTER_PLACE);
    if ((await db.holdings.count()) === 0) {
      await applyInventoryImport(parseInventoryCsv(inventoryCsv));
    }
    await seedPanther();
    await updateSeededTanks();
  })();
  return started;
}

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
import type { Aquarium } from '@/domain/types';
import inventoryCsv from './seed/fish_inventory.csv?raw';
import pantherPhotoUrl from './seed/assets/the-panther.jpg';

const SEEDED_AT = '2026-08-27T00:00:00.000Z';
const NEEDS_MEASURING = 'Add volume and dimensions to enable compatibility screening.';

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
  { id: 'tank_mini', name: 'Mini Tank', kind: 'display', status: 'active', notes: NEEDS_MEASURING, createdAt: SEEDED_AT },
  { id: 'tank_predator', name: 'Predator Tank', kind: 'display', status: 'active', notes: NEEDS_MEASURING, createdAt: SEEDED_AT },
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
    const blob = await (await fetch(pantherPhotoUrl)).blob();
    const blobKey = 'blob_the_panther';
    await db.blobs.add({
      key: blobKey, blob, bytes: blob.size, mimeType: blob.type || 'image/jpeg', storedAt: observedAt,
    });
    await db.media.add({
      id: 'media_the_panther',
      kind: 'photo',
      specimenIds: [PANTHER_ID],
      encounterId: PANTHER_ENCOUNTER_ID,
      originalBlobKey: blobKey,
      originalBytes: blob.size,
      mimeType: blob.type || 'image/jpeg',
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

let started: Promise<void> | undefined;

export function bootstrap(): Promise<void> {
  started ??= (async () => {
    if ((await db.species.count()) === 0) {
      for (const entry of SPECIES_CATALOG) await upsertSpecies(entry.species, entry.profile);
    }
    if ((await db.aquariums.count()) === 0) await db.aquariums.bulkAdd(STARTER_TANKS);
    if ((await db.places.count()) === 0) await db.places.add(STARTER_PLACE);
    if ((await db.holdings.count()) === 0) {
      await applyInventoryImport(parseInventoryCsv(inventoryCsv));
    }
    await seedPanther();
  })();
  return started;
}

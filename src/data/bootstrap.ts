/**
 * First-run seeding.
 *
 * Populates the species catalog and Ryan's six enclosure labels from PRD 6.2.
 * Only the 75G gets real dimensions, because a standard 75-gallon footprint is
 * a known quantity (48 x 18 x 21 inches). The other five are created with no
 * volume and no dimensions on purpose: the honest consequence is that
 * screening returns "Not enough data" for them until the user measures them,
 * which is exactly what FR-E05 asks for and what a guessed number would hide.
 */
import { db } from './db';
import { SPECIES_CATALOG } from './seed/species-catalog';
import { upsertSpecies } from './repositories';
import type { Aquarium } from '@/domain/types';

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

let started: Promise<void> | undefined;

export function bootstrap(): Promise<void> {
  started ??= (async () => {
    const alreadySeeded = await db.species.count();
    if (alreadySeeded === 0) {
      for (const entry of SPECIES_CATALOG) await upsertSpecies(entry.species, entry.profile);
    }
    if ((await db.aquariums.count()) === 0) await db.aquariums.bulkAdd(STARTER_TANKS);
    if ((await db.places.count()) === 0) await db.places.add(STARTER_PLACE);
  })();
  return started;
}

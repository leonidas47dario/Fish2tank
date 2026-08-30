/**
 * The sample collection's tanks and store.
 *
 * Split out of `bootstrap.ts` so tooling can read them. `bootstrap.ts` imports
 * `fish_inventory.csv?raw`, which only Vite understands, so anything importing
 * that file cannot run under plain `tsx` - and `etl/build-smoke-fixture.ts`
 * needs exactly these constants. The definitions are unchanged; only their
 * address is.
 *
 * `bootstrap.ts` re-exports both, so existing importers keep working.
 */
import type { Aquarium } from '@/domain/types';

export const SEEDED_AT = '2026-08-27T00:00:00.000Z';
export const NEEDS_MEASURING = 'Add volume and dimensions to enable compatibility screening.';

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
  // NFR-04 / 8.2: exact locations stay private and are never published. Not
  // "never leave the device" - see the note on Place.exactLocation (BUG-05).
  privacy: 'private-exact' as const,
  isFavorite: true,
  createdAt: SEEDED_AT,
};

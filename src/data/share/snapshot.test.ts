/**
 * What a published tank may and may not contain.
 *
 * The first test here is the load-bearing one. It asserts the resident keys
 * EXACTLY rather than asserting that a few known-private fields are absent,
 * because the failure this guards against is somebody adding a field to
 * `Holding` in a year's time and it silently becoming public. An exact key
 * list breaks loudly the moment the projection stops being a projection.
 */
import { describe, expect, it } from 'vitest';
import { buildSnapshot, fingerprintOf, toPublic } from './snapshot';
import type { Aquarium } from '@/domain/types';
import type { TankResident } from '@/domain/tank-stats';

const aquarium = {
  id: 'aq_1',
  name: 'Deep Sea Collector',
  kind: 'display',
  status: 'active',
  volume: { value: 75, unit: 'gal' },
  dimensions: {
    length: { value: 48, unit: 'in' },
    width: { value: 18, unit: 'in' },
    height: { value: 21, unit: 'in' },
  },
  notes: 'PRIVATE - the heater is dodgy',
  createdAt: '2026-01-01T00:00:00.000Z',
} as Aquarium;

const resident = {
  holding: {
    id: 'h_1',
    speciesId: 'sp_betta',
    rawLabel: 'Betta',
    kind: 'fish',
    openingQuantity: 2,
    notes: 'PRIVATE - bought with the birthday money',
  },
  quantity: 2,
  speciesId: 'sp_betta',
  commonName: 'Betta',
  scientificName: 'Betta splendens',
  portraitUrl: '/assets/portraits/sp_betta.jpg',
  adultSizeIn: 2.5,
  minVolumeGal: 5,
  aggression: 'semi-aggressive',
  waterZone: 'top',
  unitPrice: 12,
} as unknown as TankResident;

const base = {
  aquarium,
  residents: [resident],
  token: 'tok_1',
  publishedAt: '2026-08-30T12:00:00.000Z',
  buildId: 'build-1',
  owner: 'ryan@example.com',
};

describe('buildSnapshot', () => {
  it('publishes exactly the allowed resident fields and nothing else', () => {
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });

    expect(Object.keys(snap.residents[0]!).sort()).toEqual([
      'adultSizeIn',
      'aggression',
      'commonName',
      'minVolumeGal',
      'quantity',
      'scientificName',
      'speciesId',
      'unitPrice',
      'waterZone',
    ]);
  });

  it('carries no note, no holding id, and no other internal record', () => {
    const serialised = JSON.stringify(buildSnapshot({ ...base, tankPhotoBlobKey: undefined }));

    expect(serialised).not.toContain('PRIVATE');
    expect(serialised).not.toContain('h_1');
    // The tank's own id is not published either: it is the token that names a
    // share, and an aquarium id is a handle into the owner's database.
    expect(serialised).not.toContain('aq_1');
  });

  it('publishes exactly the allowed tank fields', () => {
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: 'blob_x' });

    expect(Object.keys(snap.tank).sort()).toEqual(['kind', 'name', 'photoBlobKey', 'volume']);
    expect(snap.tank.name).toBe('Deep Sea Collector');
  });

  it('permits exactly the photo keys the view references', () => {
    const none = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });
    expect(none.allowedBlobKeys).toEqual([]);
    expect(none.tank.photoBlobKey).toBeUndefined();

    const one = buildSnapshot({ ...base, tankPhotoBlobKey: 'blob_x' });
    expect(one.allowedBlobKeys).toEqual(['blob_x']);
    expect(one.tank.photoBlobKey).toBe('blob_x');
  });

  it('carries the stats the owner computed, so a guest recomputes nothing', () => {
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });

    expect(snap.stats.fish).toBe(2);
    expect(snap.stats.species).toBe(1);
    // The decision recorded in spec 015: estimated value is public.
    expect(snap.stats.estimatedValue).toBe(24);
  });

});

describe('fingerprintOf', () => {
  it('ignores the fields that change on every publish', () => {
    const a = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });
    const b = buildSnapshot({
      ...base, tankPhotoBlobKey: undefined,
      token: 'a-different-token', publishedAt: '2027-01-01T00:00:00.000Z', buildId: 'b99',
    });

    // Otherwise every comparison would differ and nothing would ever be
    // recognised as unchanged, so the republisher would write on every tick.
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  it('changes when a guest would see something different', () => {
    const before = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });

    const oneMore = buildSnapshot({
      ...base, tankPhotoBlobKey: undefined,
      residents: [{ ...resident, quantity: 3 } as TankResident],
    });
    expect(fingerprintOf(oneMore)).not.toBe(fingerprintOf(before));

    const renamed = buildSnapshot({
      ...base, tankPhotoBlobKey: undefined,
      aquarium: { ...aquarium, name: 'The 40 Breeder' },
    });
    expect(fingerprintOf(renamed)).not.toBe(fingerprintOf(before));

    const photographed = buildSnapshot({ ...base, tankPhotoBlobKey: 'blob_x' });
    expect(fingerprintOf(photographed)).not.toBe(fingerprintOf(before));
  });

  it('does not change for an edit no guest can see', () => {
    const before = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });
    const notePrivately = buildSnapshot({
      ...base, tankPhotoBlobKey: undefined,
      residents: [{
        ...resident,
        holding: { ...resident.holding, notes: 'PRIVATE - rehome the big one' },
      } as TankResident],
    });

    expect(fingerprintOf(notePrivately)).toBe(fingerprintOf(before));
  });

  it('is stable across calls, or the republisher would loop', () => {
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });
    expect(fingerprintOf(snap)).toBe(fingerprintOf(snap));
  });
});

describe('the public projection', () => {
  it('is what a guest receives', () => {
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: 'blob_x' });
    const publicView = toPublic(snap);

    expect(snap.owner).toBe('ryan@example.com');
    expect('owner' in publicView).toBe(false);
    expect('allowedBlobKeys' in publicView).toBe(false);
    // But everything a guest needs survives the stripping.
    expect(publicView.tank.photoBlobKey).toBe('blob_x');
    expect(publicView.residents).toHaveLength(1);
  });
});

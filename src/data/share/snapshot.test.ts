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
import { buildSnapshot, fingerprintOf, needsRepublish, toPublic } from './snapshot';
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
  artUrl: '/assets/portraits/sp_betta.jpg',
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

    // `photoBlobKey` joined this list deliberately in spec 026. It is a key,
    // not bytes, and the Worker serves it only if it is also in
    // `allowedBlobKeys` - which is asserted separately below.
    expect(Object.keys(snap.residents[0]!).sort()).toEqual([
      'adultSizeIn',
      'aggression',
      'commonName',
      'minVolumeGal',
      'photoBlobKey',
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
    // The decision recorded in spec 023: estimated value is public.
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
    expect(fingerprintOf(photographed, 'media_1')).not.toBe(fingerprintOf(before));
  });

  /**
   * The bug this pins down: keying on the blob key compares a content question
   * against a sync-state answer. A tank whose photo has not finished uploading
   * publishes without the key, so on the next tick the fingerprint would
   * differ from itself and the republisher would write forever.
   */
  it('does not change when only the photo\'s SYNC STATE differs', () => {
    const notYetUploaded = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });
    const uploaded = buildSnapshot({ ...base, tankPhotoBlobKey: 'blob_x' });

    expect(fingerprintOf(uploaded, 'media_1')).toBe(fingerprintOf(notYetUploaded, 'media_1'));
  });

  it('changes when the photo itself is replaced', () => {
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });

    expect(fingerprintOf(snap, 'media_2')).not.toBe(fingerprintOf(snap, 'media_1'));
    expect(fingerprintOf(snap, undefined)).not.toBe(fingerprintOf(snap, 'media_1'));
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

describe('needsRepublish', () => {
  const published = { fingerprint: 'fp-1', photoIncluded: true };

  it('says no when nothing a guest sees has moved', () => {
    expect(needsRepublish(published, { fingerprint: 'fp-1', hasPhoto: true })).toBe(false);
  });

  it('says yes when the content changed', () => {
    expect(needsRepublish(published, { fingerprint: 'fp-2', hasPhoto: true })).toBe(true);
  });

  /**
   * The photo finishing its upload changes nothing about the tank, so the
   * fingerprint cannot see it. Without this clause a shared tank whose photo
   * was still syncing would never show that photo to a guest until somebody
   * pressed the button by hand.
   */
  it('says yes when the photo has arrived since the last publish', () => {
    expect(needsRepublish(
      { fingerprint: 'fp-1', photoIncluded: false },
      { fingerprint: 'fp-1', hasPhoto: true },
    )).toBe(true);
  });

  it('says no for a tank that simply has no photo', () => {
    expect(needsRepublish(
      { fingerprint: 'fp-1', photoIncluded: false },
      { fingerprint: 'fp-1', hasPhoto: false },
    )).toBe(false);
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

describe("the keeper's own photos (spec 026)", () => {
  const keys = new Map([['h_1', 'blob_betta']]);

  it('publishes a resident photo key AND puts it in the allowlist', () => {
    // The two halves are what make the Worker able to serve it. A key on the
    // page without a key in the allowlist is a torn image; the reverse is an
    // object published for nothing.
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: undefined, residentPhotoKeys: keys });

    expect(snap.residents[0]!.photoBlobKey).toBe('blob_betta');
    expect(snap.allowedBlobKeys).toContain('blob_betta');
  });

  it('allows the tank photo and every fish photo together, without duplicates', () => {
    const snap = buildSnapshot({
      ...base, tankPhotoBlobKey: 'blob_tank', residentPhotoKeys: keys,
    });

    expect(snap.allowedBlobKeys.sort()).toEqual(['blob_betta', 'blob_tank']);
  });

  it('leaves a fish with no published photo to its portrait', () => {
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: undefined, residentPhotoKeys: new Map() });

    expect(snap.residents[0]!.photoBlobKey).toBeUndefined();
    expect(snap.allowedBlobKeys).toEqual([]);
  });

  it('does NOT let an unsynced fish photo change the fingerprint', () => {
    // The trap fingerprintOf already documents for the tank photo, one field
    // over. If a blob key reached the hash, a tank holding one photo that
    // never uploads would republish on every tick, forever.
    const withKey = buildSnapshot({ ...base, tankPhotoBlobKey: undefined, residentPhotoKeys: keys });
    const withoutKey = buildSnapshot({
      ...base, tankPhotoBlobKey: undefined, residentPhotoKeys: new Map(),
    });

    expect(fingerprintOf(withKey, undefined, ['m_1']))
      .toBe(fingerprintOf(withoutKey, undefined, ['m_1']));
  });

  it('DOES change the fingerprint when a fish gains or swaps a photo', () => {
    const snap = buildSnapshot({ ...base, tankPhotoBlobKey: undefined });

    expect(fingerprintOf(snap, undefined, ['m_1'])).not.toBe(fingerprintOf(snap, undefined, []));
    expect(fingerprintOf(snap, undefined, ['m_2'])).not.toBe(fingerprintOf(snap, undefined, ['m_1']));
  });

  it('republishes once a fish photo finishes uploading', () => {
    // Nothing about the tank changed, so the fingerprint cannot see it - the
    // same reason the tank photo needed its own clause.
    expect(needsRepublish(
      { fingerprint: 'same', photoIncluded: true, photoCount: 0 },
      { fingerprint: 'same', hasPhoto: true, photoCount: 1 },
    )).toBe(true);
  });

  it('does not republish when every photographed fish is already published', () => {
    expect(needsRepublish(
      { fingerprint: 'same', photoIncluded: true, photoCount: 2 },
      { fingerprint: 'same', hasPhoto: true, photoCount: 2 },
    )).toBe(false);
  });
});

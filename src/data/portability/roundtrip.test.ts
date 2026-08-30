import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { Fish2TankDB, blobFor } from '../db';
import type { Media, Species } from '@/domain/types';
import { exportArchive, referencedBlobKeys } from './export';
import { ArchiveRejected, importArchive, parseArchive } from './import';
import { ARCHIVE_VERSION, MANIFEST_PATH, RECORDS_PATH } from './manifest';

let db: Fish2TankDB;

const AT = '2026-08-29T00:00:00.000Z';

/** A collection with the shapes that matter: media bytes, and a typed-in species. */
async function seed(database: Fish2TankDB) {
  await database.users.put({
    id: 'user_local',
    displayName: 'Ryan',
    settings: { themeId: 'midnight-aquarium', sceneId: 'original-tank', reducedMotion: false, currency: 'USD' },
    createdAt: AT,
  });

  await database.species.bulkPut([
    // From the shipped catalog: derived, regenerable, must NOT be exported.
    { id: 'sp_catalog', commonName: 'Oscar', aliases: [], createdAt: AT, origin: 'catalog' },
    // Typed in by the keeper: exists nowhere else, must survive.
    {
      id: 'sp_mine', commonName: 'Weird Store Fish', aliases: [], createdAt: AT,
      origin: 'user-submitted',
      submission: { label: 'weird store fish', submittedAt: AT },
    },
  ] as Species[]);

  await database.speciesProfiles.bulkPut([
    { id: 'prof_mine', speciesId: 'sp_mine', socialNeeds: [], predationTags: [], sources: [], profileVersion: 1, updatedAt: AT },
    { id: 'prof_cat', speciesId: 'sp_catalog', socialNeeds: [], predationTags: [], sources: [], profileVersion: 1, updatedAt: AT },
  ]);

  await database.aquariums.put({ id: 'tank_1', name: '75G', kind: 'display', status: 'active', createdAt: AT });
  await database.holdings.put({
    id: 'hold_1', speciesId: 'sp_mine', kind: 'group', openingQuantity: 6,
    openingBalance: true, createdAt: AT,
  });

  await database.media.put({
    id: 'med_1', kind: 'photo', specimenIds: ['spec_1'],
    originalBlobKey: 'b_orig', originalBytes: 512, mimeType: 'image/jpeg',
    thumbnailBlobKey: 'b_thumb',
    capturedAt: AT, syncState: 'local-draft',
  } as Media);

  const orig = new Uint8Array(512).map((_, i) => i % 251);
  const thumb = new Uint8Array(64).fill(7);
  await database.blobs.bulkPut([
    { key: 'b_orig', data: orig.buffer, bytes: 512, mimeType: 'image/jpeg', storedAt: AT },
    { key: 'b_thumb', data: thumb.buffer, bytes: 64, mimeType: 'image/jpeg', storedAt: AT },
  ]);
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

beforeEach(async () => {
  db = new Fish2TankDB(`portability-${crypto.randomUUID()}`);
  await db.open();
  await seed(db);
});

describe('referencedBlobKeys', () => {
  it('collects every key a media row points at, without duplicates', () => {
    const rows = [
      { originalBlobKey: 'a', thumbnailBlobKey: 'b' },
      { originalBlobKey: 'a', previewBlobKey: 'c' },
    ] as Media[];
    expect(referencedBlobKeys(rows).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('export', () => {
  it('writes a manifest, records and one file per referenced blob', async () => {
    const { blob, manifest } = await exportArchive(db);
    const files = unzipSync(await bytesOf(blob));

    expect(Object.keys(files)).toContain(MANIFEST_PATH);
    expect(Object.keys(files)).toContain(RECORDS_PATH);
    expect(Object.keys(files)).toContain('media/b_orig');
    expect(Object.keys(files)).toContain('media/b_thumb');
    expect(manifest.version).toBe(ARCHIVE_VERSION);
    expect(manifest.media).toEqual({ count: 2, bytes: 576 });
  });

  it('carries a user-submitted species but not a catalog one', async () => {
    const { blob } = await exportArchive(db);
    const parsed = parseArchive(await bytesOf(blob));
    const species = parsed.records.species as Species[];

    expect(species.map((s) => s.id)).toEqual(['sp_mine']);
  });

  it('carries only the profiles belonging to exported species', async () => {
    const { blob } = await exportArchive(db);
    const parsed = parseArchive(await bytesOf(blob));
    const profiles = parsed.records.speciesProfiles as Array<{ id: string }>;

    expect(profiles.map((p) => p.id)).toEqual(['prof_mine']);
  });

  it('counts every table in the manifest', async () => {
    const { manifest } = await exportArchive(db);
    expect(manifest.tables.users).toBe(1);
    expect(manifest.tables.holdings).toBe(1);
    expect(manifest.tables.aquariums).toBe(1);
    expect(manifest.tables.species).toBe(1);
  });

  it('omits a blob whose bytes are missing rather than failing the export', async () => {
    await db.blobs.delete('b_thumb');
    const { manifest, blob } = await exportArchive(db);
    const files = unzipSync(await bytesOf(blob));

    expect(manifest.media.count).toBe(1);
    expect(Object.keys(files)).not.toContain('media/b_thumb');
  });
});

describe('import', () => {
  it('reproduces every exported row in an empty database', async () => {
    const { blob } = await exportArchive(db);

    const fresh = new Fish2TankDB(`portability-fresh-${crypto.randomUUID()}`);
    await fresh.open();
    const result = await importArchive(await bytesOf(blob), fresh);

    expect(result.tables.users).toBe(1);
    expect((await fresh.users.get('user_local'))!.displayName).toBe('Ryan');
    expect((await fresh.holdings.get('hold_1'))!.openingQuantity).toBe(6);
    expect((await fresh.species.get('sp_mine'))!.origin).toBe('user-submitted');
    expect(result.mediaRestored).toBe(2);
  });

  it('round-trips media bytes byte-identically (NFR-03)', async () => {
    const before = new Uint8Array(await blobFor(await db.blobs.get('b_orig'))!.arrayBuffer());
    const { blob } = await exportArchive(db);

    const fresh = new Fish2TankDB(`portability-bytes-${crypto.randomUUID()}`);
    await fresh.open();
    await importArchive(await bytesOf(blob), fresh);

    const after = new Uint8Array(await blobFor(await fresh.blobs.get('b_orig'))!.arrayBuffer());
    expect(after.byteLength).toBe(512);
    expect([...after]).toEqual([...before]);
  });

  it('is idempotent: importing twice leaves one copy, not two', async () => {
    const { blob } = await exportArchive(db);
    const bytes = await bytesOf(blob);

    const fresh = new Fish2TankDB(`portability-twice-${crypto.randomUUID()}`);
    await fresh.open();
    await importArchive(bytes, fresh);
    const afterOne = await fresh.holdings.count();
    await importArchive(bytes, fresh);

    expect(await fresh.holdings.count()).toBe(afterOne);
    expect(await fresh.users.count()).toBe(1);
    expect(await fresh.blobs.count()).toBe(2);
  });

  it('restores onto a re-seeded database without doubling the inventory', async () => {
    /*
     * The real disaster path, and the one that caught a live bug. Safari
     * evicts IndexedDB (ENH-04), the app reopens, bootstrap() re-seeds the
     * inventory because `holdings` is empty, and then the keeper restores a
     * backup. Measured before the fix: 122 holdings instead of 61, because the
     * re-seeded rows carried fresh random ids. Seeded ids are derived from the
     * row content now, so the restore lands on top of them.
     */
    const { importInventory, parseInventoryCsv } = await import('../seed/inventory-import');
    const csv = (await import('../seed/fish_inventory.csv?raw')).default;

    const first = importInventory(parseInventoryCsv(csv), []);
    const second = importInventory(parseInventoryCsv(csv), []);

    expect(second.holdings.map((h) => h.id)).toEqual(first.holdings.map((h) => h.id));
    expect(second.residencies.map((r) => r.id)).toEqual(first.residencies.map((r) => r.id));
    expect(new Set(first.holdings.map((h) => h.id)).size).toBe(first.holdings.length);
  });

  it('never deletes a local row the archive does not mention', async () => {
    const { blob } = await exportArchive(db);

    const other = new Fish2TankDB(`portability-additive-${crypto.randomUUID()}`);
    await other.open();
    await other.aquariums.put({
      id: 'tank_since', name: 'Bought Later', kind: 'display', status: 'active', createdAt: AT,
    });

    await importArchive(await bytesOf(blob), other);

    expect(await other.aquariums.get('tank_since')).toBeDefined();
    expect(await other.aquariums.count()).toBe(2);
  });
});

describe('a bad archive is refused whole', () => {
  async function corruptedManifest(mutate: (m: Record<string, unknown>) => void) {
    const { blob } = await exportArchive(db);
    const files = unzipSync(await bytesOf(blob));
    const manifest = JSON.parse(new TextDecoder().decode(files[MANIFEST_PATH]!)) as Record<string, unknown>;
    mutate(manifest);
    files[MANIFEST_PATH] = strToU8(JSON.stringify(manifest));
    return zipSync(files);
  }

  it('rejects a row count that disagrees with the records', async () => {
    const bad = await corruptedManifest((m) => {
      (m.tables as Record<string, number>).holdings = 99;
    });
    const fresh = new Fish2TankDB(`portability-badrows-${crypto.randomUUID()}`);
    await fresh.open();

    await expect(importArchive(bad, fresh)).rejects.toThrow(ArchiveRejected);
    expect(await fresh.holdings.count()).toBe(0);
  });

  it('rejects a media byte total that disagrees, and writes nothing', async () => {
    const bad = await corruptedManifest((m) => {
      (m.media as Record<string, number>).bytes = 1;
    });
    const fresh = new Fish2TankDB(`portability-badbytes-${crypto.randomUUID()}`);
    await fresh.open();

    await expect(importArchive(bad, fresh)).rejects.toThrow(/manifest claims 1 bytes/);
    expect(await fresh.blobs.count()).toBe(0);
    expect(await fresh.users.count()).toBe(0);
  });

  it('rejects an archive written by a newer layout', async () => {
    const bad = await corruptedManifest((m) => { m.version = ARCHIVE_VERSION + 1; });
    const fresh = new Fish2TankDB(`portability-badver-${crypto.randomUUID()}`);
    await fresh.open();

    await expect(importArchive(bad, fresh)).rejects.toThrow(/archive version/);
  });

  it('names every disagreement at once rather than the first', async () => {
    const bad = await corruptedManifest((m) => {
      (m.tables as Record<string, number>).holdings = 99;
      (m.media as Record<string, number>).count = 42;
    });
    const fresh = new Fish2TankDB(`portability-multi-${crypto.randomUUID()}`);
    await fresh.open();

    await importArchive(bad, fresh).catch((err: ArchiveRejected) => {
      expect(err.problems.length).toBe(2);
    });
    expect.assertions(1);
  });

  it('rejects a zip with no manifest', async () => {
    const bad = zipSync({ 'records.json': strToU8('{}') });
    const fresh = new Fish2TankDB(`portability-nomanifest-${crypto.randomUUID()}`);
    await fresh.open();

    await expect(importArchive(bad, fresh)).rejects.toThrow(/no manifest.json/);
  });
});

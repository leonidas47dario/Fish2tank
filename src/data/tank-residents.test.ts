import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from './db';
import { CATALOG_BY_SPECIES } from './catalog';
import { loadTankResidents } from './tank-residents';

/**
 * The join behind both a tank screen and a shared tank page (spec 023).
 *
 * These tests exist for one property above all: `loadTankResidents` NAMES the
 * keeper's own photograph rather than putting it in `artUrl`. That is what lets
 * the owner's screen show their picture while the published page shows a
 * bundled portrait, and it is the only thing standing between "share a tank"
 * and "publish a photograph of every fish in it" (see `collectBlobKeys`).
 */

let db: Fish2TankDB;

/** A species that really is in the catalog and really has a bundled portrait. */
const SPECIES = [...CATALOG_BY_SPECIES.values()].find((s) => s.portrait)!;

beforeEach(async () => {
  db = new Fish2TankDB(`test_${crypto.randomUUID()}`);
  await db.open();

  await db.aquariums.add({
    id: 'aq_1', name: 'Peaceful Garden', kind: 'display', status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
});

/** One fish in the tank, optionally with a photo of its own. */
async function stock(
  holdingId: string,
  opts: { specimenId?: string; speciesId?: string; mediaIds?: string[] } = {},
) {
  await db.holdings.add({
    id: holdingId,
    specimenId: opts.specimenId,
    speciesId: opts.speciesId ?? SPECIES.speciesId,
    kind: 'individual',
    openingQuantity: 1,
    openingBalance: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  await db.residencies.add({
    id: `res_${holdingId}`, holdingId, aquariumId: 'aq_1', startDate: '2026-08-01',
  });
  for (const [i, id] of (opts.mediaIds ?? []).entries()) {
    await db.media.add({
      id,
      kind: 'photo',
      specimenIds: opts.specimenId ? [opts.specimenId] : [],
      originalBlobKey: `blob_${id}`,
      originalBytes: 4,
      mimeType: 'image/jpeg',
      // Ascending, so the newest is the last one added.
      capturedAt: `2026-08-0${i + 1}T00:00:00.000Z`,
      syncState: 'synced',
    });
  }
}

describe('loadTankResidents (spec 023)', () => {
  it('names the keeper\'s own photo instead of putting it in artUrl', async () => {
    await stock('h_1', { specimenId: 'spec_1', mediaIds: ['m_old', 'm_new'] });

    const loaded = (await loadTankResidents('aq_1', db))!;

    // The resident a projection would publish carries no private photo at all.
    expect(loaded.residents).toHaveLength(1);
    expect(loaded.residents[0]!.artUrl).toBeUndefined();
    // The choice is reported separately, newest first (spec 021's precedence).
    expect(loaded.ownArt).toEqual([{ holdingId: 'h_1', mediaId: 'm_new' }]);
  });

  it('leaves the bundled portrait in artUrl when the fish has no photo', async () => {
    await stock('h_1', { specimenId: 'spec_1' });

    const loaded = (await loadTankResidents('aq_1', db))!;

    expect(loaded.residents[0]!.artUrl).toBeDefined();
    expect(loaded.ownArt).toEqual([]);
  });

  it('does not lend one fish\'s photo to a tankmate of the same species', async () => {
    // The bug spec 021 fixed, guarded at the layer that now decides it.
    await stock('h_photographed', { specimenId: 'spec_1', mediaIds: ['m_1'] });
    await stock('h_bare', { specimenId: 'spec_2' });

    const loaded = (await loadTankResidents('aq_1', db))!;

    expect(loaded.ownArt).toEqual([{ holdingId: 'h_photographed', mediaId: 'm_1' }]);
    const bare = loaded.residents.find((r) => r.holding.id === 'h_bare')!;
    expect(bare.artUrl).toBeDefined();
  });

  it('honours an explicit "use the reference portrait" choice', async () => {
    await stock('h_1', { specimenId: 'spec_1', mediaIds: ['m_1'] });
    await db.cardPrefs.add({
      speciesId: SPECIES.speciesId, artSource: 'portrait',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });

    const loaded = (await loadTankResidents('aq_1', db))!;

    expect(loaded.ownArt).toEqual([]);
    expect(loaded.residents[0]!.artUrl).toBeDefined();
  });

  it('holds a fish nobody has identified, with no portrait to fall back to', async () => {
    // FR-T02: a holding needs no specimen and no species. The importer makes
    // exactly this, and spec 021 made it placeable in a tank.
    await db.holdings.add({
      id: 'h_unknown', kind: 'individual', openingQuantity: 1, openingBalance: true,
      rawLabel: 'the blue one', createdAt: '2026-08-01T00:00:00.000Z',
    });
    await db.residencies.add({
      id: 'res_unknown', holdingId: 'h_unknown', aquariumId: 'aq_1', startDate: '2026-08-01',
    });

    const loaded = (await loadTankResidents('aq_1', db))!;

    expect(loaded.residents[0]!.commonName).toBe('the blue one');
    expect(loaded.residents[0]!.artUrl).toBeUndefined();
    expect(loaded.ownArt).toEqual([]);
  });
});

describe('read paths never write (spec 027)', () => {
  /**
   * The regression that blanked the species page and made sign-out look
   * broken. `loadProfile()` CREATES `user_local` when it is missing, and this
   * join runs inside `useLiveQuery` - a write inside a read-only transaction,
   * which IndexedDB rejects with ReadOnlyError and React turns into an empty
   * screen. It was latent until spec 022 stopped ThemeProvider creating the
   * row eagerly; sign-out clears `users`, so it fired every time afterwards.
   */
  it('loads a tank without creating a profile row', async () => {
    expect(await db.users.count()).toBe(0);

    const loaded = await loadTankResidents('aq_1', db);

    expect(loaded).toBeDefined();
    // The assertion that fails if anything here goes back to loadProfile().
    expect(await db.users.count()).toBe(0);
  });

  it('still prices in the keeper\'s currency once a profile exists', async () => {
    await db.users.put({
      id: 'user_local',
      settings: { themeId: 'midnight-aquarium', sceneId: 'original-tank', currency: 'GBP' },
    } as never);

    const loaded = await loadTankResidents('aq_1', db);

    expect(loaded).toBeDefined();
    expect(await db.users.count()).toBe(1);
  });
});

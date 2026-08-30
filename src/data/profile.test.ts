import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from './db';
import {
  DEFAULT_SETTINGS,
  LOCAL_PROFILE_ID,
  foldLegacySettings,
  loadProfile,
  setDisplayName,
  updateSettings,
} from './profile';
import { recordPrice } from './repositories';

let db: Fish2TankDB;

beforeEach(async () => {
  db = new Fish2TankDB(`profile-test-${crypto.randomUUID()}`);
  await db.open();
});

describe('foldLegacySettings', () => {
  it('carries every known field across from the localStorage shape', () => {
    const folded = foldLegacySettings(
      '{"theme":"playful-collector","scene":"planted","reducedMotion":true,"muted":true}',
    );
    expect(folded).toEqual({
      themeId: 'playful-collector',
      sceneId: 'planted',
      reducedMotion: true,
      currency: 'USD',
      // Spec 014. The legacy payload predates it, so it folds to the default
      // cadence rather than to nothing - an old profile should sync photos on
      // the same schedule as a new one, not sit still.
      photoSyncMinutes: 30,
    });
  });

  it('drops muted, which stays device-level', () => {
    const folded = foldLegacySettings('{"muted":true}');
    expect(folded).not.toHaveProperty('muted');
  });

  it('falls back to defaults for absent, empty or corrupt input', () => {
    expect(foldLegacySettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(foldLegacySettings('')).toEqual(DEFAULT_SETTINGS);
    expect(foldLegacySettings('{ not json')).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores unknown keys rather than storing them', () => {
    const folded = foldLegacySettings('{"theme":"planted","somethingElse":42}');
    expect(folded).not.toHaveProperty('somethingElse');
  });
});

describe('loadProfile', () => {
  it('creates a profile on first call', async () => {
    const profile = await loadProfile(db);
    expect(profile.id).toBe(LOCAL_PROFILE_ID);
    expect(profile.settings).toEqual(DEFAULT_SETTINGS);
    expect(await db.users.count()).toBe(1);
  });

  it('is idempotent: a second call returns the same row, not a second one', async () => {
    const first = await loadProfile(db);
    await updateSettings({ themeId: 'planted' }, db);
    const second = await loadProfile(db);
    expect(await db.users.count()).toBe(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.settings.themeId).toBe('planted');
  });

  it('seeds from legacy settings when given them, but only on creation', async () => {
    await loadProfile(db, '{"theme":"expedition-fieldbook"}');
    await loadProfile(db, '{"theme":"playful-collector"}');
    const profile = await loadProfile(db);
    expect(profile.settings.themeId).toBe('expedition-fieldbook');
  });
});

describe('updateSettings', () => {
  it('patches one field without disturbing the others', async () => {
    await loadProfile(db);
    await updateSettings({ currency: 'EUR' }, db);
    const profile = await loadProfile(db);
    expect(profile.settings.currency).toBe('EUR');
    expect(profile.settings.themeId).toBe(DEFAULT_SETTINGS.themeId);
  });

  it('creates the profile first if it does not exist yet', async () => {
    await updateSettings({ currency: 'GBP' }, db);
    expect((await loadProfile(db)).settings.currency).toBe('GBP');
  });
});

describe('setDisplayName', () => {
  it('stores the name without disturbing settings', async () => {
    await updateSettings({ currency: 'CAD' }, db);
    await setDisplayName('Ryan', db);
    const profile = await loadProfile(db);
    expect(profile.displayName).toBe('Ryan');
    expect(profile.settings.currency).toBe('CAD');
  });
});

/**
 * Spec 005: the profile is the record most likely to be edited from two
 * devices at once, so it is written with property-level `update()` rather than
 * a whole-record `put()`. These lock the parts of that decision a unit test
 * can see - the sync-merge behaviour itself belongs to Dexie Cloud.
 */
describe('profile writes are narrow and honest', () => {
  it('does not write at all when the name has not changed', async () => {
    await loadProfile(db);
    await setDisplayName('Ryan', db);
    const before = await db.users.get(LOCAL_PROFILE_ID);

    let writes = 0;
    db.users.hook('updating', () => {
      writes += 1;
    });
    await setDisplayName('Ryan', db);

    // A no-op keystroke must not become a sync mutation.
    expect(writes).toBe(0);
    expect(await db.users.get(LOCAL_PROFILE_ID)).toEqual(before);
  });

  it('does not write for an empty settings patch', async () => {
    await loadProfile(db);
    let writes = 0;
    db.users.hook('updating', () => {
      writes += 1;
    });
    await updateSettings({}, db);
    expect(writes).toBe(0);
  });

  it('touches only the patched setting, leaving siblings alone', async () => {
    await loadProfile(db);
    await updateSettings({ currency: 'GBP' }, db);

    let changed: unknown;
    db.users.hook('updating', (mods) => {
      changed = mods;
    });
    await updateSettings({ themeId: 'reef-noon' }, db);

    // The whole point: the mutation names one property, so a second device's
    // currency change is not carried along and overwritten.
    expect(changed).toEqual({ 'settings.themeId': 'reef-noon' });
    const after = await db.users.get(LOCAL_PROFILE_ID);
    expect(after?.settings.currency).toBe('GBP');
    expect(after?.settings.themeId).toBe('reef-noon');
  });

  it('recreates a deleted profile rather than losing the write', async () => {
    await loadProfile(db);
    await db.users.delete(LOCAL_PROFILE_ID);

    // `loadProfile` recreates, so the write lands on a fresh row with defaults.
    // Worth pinning: the throw inside patchProfile is a guard against the
    // narrow race where the row disappears between the load and the update,
    // NOT the path taken here, and a reader could easily assume otherwise.
    await setDisplayName('Ryan', db);

    const after = await db.users.get(LOCAL_PROFILE_ID);
    expect(after?.displayName).toBe('Ryan');
    expect(after?.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('recordPrice currency', () => {
  it('defaults to the profile currency rather than USD', async () => {
    await updateSettings({ currency: 'EUR' }, db);
    const observation = await recordPrice({ speciesId: 'sp_x', askingPrice: 10 }, db);
    expect(observation.currency).toBe('EUR');
  });

  it('still lets an explicit currency win, for a price seen abroad', async () => {
    await updateSettings({ currency: 'EUR' }, db);
    const observation = await recordPrice(
      { speciesId: 'sp_x', askingPrice: 10, currency: 'JPY' },
      db,
    );
    expect(observation.currency).toBe('JPY');
  });
});

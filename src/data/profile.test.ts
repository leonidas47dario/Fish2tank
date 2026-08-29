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

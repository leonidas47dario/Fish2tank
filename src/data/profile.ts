/**
 * The keeper's profile.
 *
 * Spec 005 FR-A04. Until now `User` and `UserSettings` were declared and never
 * written, while the settings people actually change lived in localStorage
 * under a different shape. This module is the single place that knows where a
 * profile is stored, so Release 2 can point it at a synced identity without
 * anything upstream changing.
 *
 * Account-level settings live here. `muted` deliberately does not: it is about
 * the room a device is in, and stays in localStorage.
 */
import { db, nowIso, type Fish2TankDB } from './db';
import type { User, UserSettings } from '@/domain/types';

/**
 * Fixed while the app is single-user and offline. Release 2 maps the synced
 * identity onto this row rather than creating a second one.
 */
export const LOCAL_PROFILE_ID = 'user_local';

export const DEFAULT_SETTINGS: UserSettings = {
  themeId: 'midnight-aquarium',
  sceneId: 'original-tank',
  reducedMotion: false,
  currency: 'USD',
};

/** The shape ThemeProvider wrote to localStorage before this existed. */
interface LegacySettings {
  theme?: unknown;
  scene?: unknown;
  reducedMotion?: unknown;
}

/**
 * Reads the pre-profile localStorage payload into settings.
 *
 * Total, by design: a keeper who never opened Settings, or whose stored JSON
 * is corrupt, gets defaults rather than an error. Losing a theme preference is
 * not worth a failed startup. `muted` is dropped on purpose.
 */
export function foldLegacySettings(raw: string | null | undefined): UserSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let parsed: LegacySettings;
  try {
    parsed = JSON.parse(raw) as LegacySettings;
  } catch (err) {
    console.warn('[profile] legacy settings were not valid JSON, using defaults', err);
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
  return {
    themeId: typeof parsed.theme === 'string' ? parsed.theme : DEFAULT_SETTINGS.themeId,
    sceneId: typeof parsed.scene === 'string' ? parsed.scene : DEFAULT_SETTINGS.sceneId,
    reducedMotion:
      typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    currency: DEFAULT_SETTINGS.currency,
  };
}

/**
 * The profile, created on first call.
 *
 * `legacyRaw` seeds settings at creation only. Passing it again later does
 * nothing, so a stale localStorage value can never overwrite a deliberate
 * change made afterwards.
 */
export async function loadProfile(
  database: Fish2TankDB = db,
  legacyRaw?: string | null,
): Promise<User> {
  const existing = await database.users.get(LOCAL_PROFILE_ID);
  if (existing) return existing;

  const created: User = {
    id: LOCAL_PROFILE_ID,
    displayName: '',
    settings: foldLegacySettings(legacyRaw),
    createdAt: nowIso(),
  };
  await database.users.put(created);
  console.info(
    `[profile] created ${LOCAL_PROFILE_ID} theme=${created.settings.themeId} ` +
      `scene=${created.settings.sceneId} currency=${created.settings.currency} ` +
      `legacy=${legacyRaw ? 'folded' : 'none'}`,
  );
  return created;
}

/** Patches settings, creating the profile first if needed. */
export async function updateSettings(
  patch: Partial<UserSettings>,
  database: Fish2TankDB = db,
): Promise<User> {
  const current = await loadProfile(database);
  const next: User = { ...current, settings: { ...current.settings, ...patch } };
  await database.users.put(next);
  return next;
}

/** Sets the display name, creating the profile first if needed. */
export async function setDisplayName(
  displayName: string,
  database: Fish2TankDB = db,
): Promise<User> {
  const current = await loadProfile(database);
  const next: User = { ...current, displayName };
  await database.users.put(next);
  return next;
}

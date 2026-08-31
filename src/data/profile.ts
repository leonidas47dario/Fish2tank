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
import { DEFAULT_SYNC_INTERVAL_MINUTES } from './sync/auto-sync';
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
  photoSyncMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
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
    photoSyncMinutes: DEFAULT_SETTINGS.photoSyncMinutes,
  };
}

/** The row a first run would create. Not stored by itself. */
function blankProfile(legacyRaw?: string | null): User {
  return {
    id: LOCAL_PROFILE_ID,
    displayName: '',
    settings: foldLegacySettings(legacyRaw),
    createdAt: nowIso(),
  };
}

/**
 * The profile as it stands, without creating one - spec 020, BUG-08.
 *
 * WHY A READ THAT WRITES NOTHING EXISTS. `users` is a synced table and
 * `user_local` is a hardcoded primary key, so a row written here before anyone
 * has signed in is a row that will be pushed over the account's real profile
 * on the first sync. `ThemeProvider` mounts above the sign-in gate and needs a
 * theme immediately, which used to mean every signed-out launch manufactured a
 * default profile under a key the account already uses. Reading is enough for
 * that; the row is created by the first deliberate settings change instead.
 */
export async function readProfile(
  database: Fish2TankDB = db,
  legacyRaw?: string | null,
): Promise<User> {
  return (await database.users.get(LOCAL_PROFILE_ID)) ?? blankProfile(legacyRaw);
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

  const created = blankProfile(legacyRaw);
  await database.users.put(created);
  console.info(
    `[profile] created ${LOCAL_PROFILE_ID} theme=${created.settings.themeId} ` +
      `scene=${created.settings.sceneId} currency=${created.settings.currency} ` +
      `legacy=${legacyRaw ? 'folded' : 'none'}`,
  );
  return created;
}

/**
 * Apply a change to the profile, and refuse to report success without it.
 *
 * WHY `update()` AND NOT `put()`. Once this row syncs it is the record most
 * likely to be edited from two devices at once, because it is the one holding
 * preferences that follow the person. Dexie Cloud syncs `put()` as "replace
 * the entire object", so a phone setting a theme would silently discard a
 * laptop setting a currency in the same window. `update()` with a changes
 * object syncs as a property-level operation, and two devices touching
 * different properties both survive. Same property from both is last-writer-
 * wins by client clock, which is the best anyone can do.
 *
 * Dotted keys reach into `settings` so the granularity is per setting, not
 * per settings object.
 */
async function patchProfile(
  changes: Record<string, unknown>,
  database: Fish2TankDB,
): Promise<void> {
  const updated = await database.users.update(LOCAL_PROFILE_ID, changes);
  // A settings write that quietly hit no rows would leave the UI showing a
  // value that was never stored. Say so rather than reporting success.
  if (updated === 0) {
    console.error('[profile] update matched no row', { id: LOCAL_PROFILE_ID, changes });
    throw new Error(`Profile ${LOCAL_PROFILE_ID} was missing when saving ${Object.keys(changes).join(', ')}`);
  }
}

/** Patches settings, creating the profile first if needed. */
export async function updateSettings(
  patch: Partial<UserSettings>,
  database: Fish2TankDB = db,
): Promise<User> {
  const current = await loadProfile(database);
  const changes = Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [`settings.${key}`, value]),
  );
  if (Object.keys(changes).length > 0) await patchProfile(changes, database);
  return { ...current, settings: { ...current.settings, ...patch } };
}

/*
 * `setDisplayName` was removed in spec 017 along with the Settings field that
 * was its only caller. The greeting now reads the signed-in account's name and
 * falls back to `displayName` for anyone who set one before the field went, so
 * the stored property is still read - it is just no longer writable from the
 * app. Restore this function alongside any future "choose a nickname" control
 * rather than reaching for `patchProfile` directly; the guard against writing
 * an unchanged value is the part worth keeping (one mutation per keystroke on
 * a synced record is what it existed to prevent).
 */

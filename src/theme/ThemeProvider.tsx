/**
 * Theme + accessibility settings.
 *
 * PRD 7.3: app theme is separate from aquarium scene, and switching either
 * must never touch records, calculations or structure. This provider only ever
 * writes attributes on <html>; nothing downstream of it reads a theme name to
 * decide behaviour.
 *
 * PRD 7.5 / NFR-06: global mute and reduced-motion controls ship from first
 * release, so they live here rather than behind a later settings milestone.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from '@/data/db';
import { readProfile, updateSettings } from '@/data/profile';
import type { UserSettings } from '@/domain/types';
import { resolveSceneId, resolveThemeId } from './resolve';

export const THEMES = [
  { id: 'midnight-aquarium', name: 'Midnight Aquarium', blurb: 'Dark gallery, luminous media, restrained foil.' },
  { id: 'playful-collector', name: 'Playful Collector', blurb: 'Bright aquatic colour, rounded cards, buoyant icons.' },
  { id: 'expedition-fieldbook', name: 'Expedition Fieldbook', blurb: 'Warm paper, stamps, annotated dossiers.' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** The Living Portrait surrounds from PRD 7.4. Independent of app theme. */
export const SCENES = [
  { id: 'original-tank', name: 'Original Tank', blurb: 'Unaltered photo and video. Always available.' },
  { id: 'moon-sand', name: 'Moon Sand', blurb: 'Dark surround, pale sand, minimal distraction.' },
  { id: 'planted', name: 'Planted', blurb: 'Soft greenery around the media window.' },
] as const;

export type SceneId = (typeof SCENES)[number]['id'];

interface Settings {
  theme: ThemeId;
  scene: SceneId;
  reducedMotion: boolean;
  /** Device-level (spec 005 FR-A04): never in the profile, never synced. */
  muted: boolean;
}

const DEFAULTS: Settings = {
  theme: 'midnight-aquarium',
  scene: 'original-tank',
  reducedMotion: false,
  muted: true,
};

const STORAGE_KEY = 'fish2tank.settings';

interface ThemeContextValue extends Settings {
  setTheme: (id: ThemeId) => void;
  setScene: (id: SceneId) => void;
  setReducedMotion: (on: boolean) => void;
  setMuted: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * First-paint cache only.
 *
 * Spec 005 FR-A04 makes the profile in IndexedDB authoritative, but IndexedDB
 * cannot be read synchronously, and rendering defaults for one frame would
 * flash the wrong theme on every load. So localStorage is read first for the
 * first paint and then corrected by the profile.
 */
function loadCache(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    // A blocked or unavailable store is not an error worth surfacing here.
    return DEFAULTS;
  }
}

/** Reading the cache must never take the app down; the profile is the record. */
function cachedRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadCache);

  // The profile wins over the cache, but only if there is one. This reads and
  // never writes (spec 022): `user_local` is a hardcoded key in a synced table,
  // and this component mounts above the sign-in gate, so creating the row here
  // meant every signed-out launch queued a default profile to be pushed over
  // the account's real one. The row is created by the first settings change.
  useEffect(() => {
    let cancelled = false;
    readProfile(db, cachedRaw())
      .then((profile) => {
        if (cancelled) return;
        setSettings((s) => ({
          ...s,
          theme: resolveThemeId(profile.settings.themeId),
          scene: resolveSceneId(profile.settings.sceneId),
          reducedMotion: profile.settings.reducedMotion,
        }));
      })
      .catch((err) => {
        // Keep the cached values rather than snapping to defaults, but say so:
        // silence here means settings appear to work and never persist.
        console.error('[theme] could not load profile, staying on cached settings', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    root.setAttribute('data-scene', settings.scene);
    root.setAttribute('data-reduced-motion', String(settings.reducedMotion));
    root.setAttribute('data-muted', String(settings.muted));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* the cache is a convenience; the profile is the record */
    }
  }, [settings]);

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);

  /** Applies locally for instant feedback, then persists the account-level part. */
  const patchProfile = useCallback(
    (p: Partial<Settings>, stored: Partial<UserSettings>) => {
      patch(p);
      updateSettings(stored).catch((err) =>
        console.error(`[theme] failed to persist ${JSON.stringify(stored)}`, err),
      );
    },
    [patch],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...settings,
      setTheme: (theme) => patchProfile({ theme }, { themeId: theme }),
      setScene: (scene) => patchProfile({ scene }, { sceneId: scene }),
      setReducedMotion: (reducedMotion) => patchProfile({ reducedMotion }, { reducedMotion }),
      // Device-level: cache only, never the profile.
      setMuted: (muted) => patch({ muted }),
    }),
    [settings, patch, patchProfile],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/**
 * True when motion should be suppressed, honouring both the in-app toggle and
 * the OS setting. FR-R04: the reveal must respect this.
 */
export function usePrefersReducedMotion(): boolean {
  const { reducedMotion } = useTheme();
  const [os, setOs] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setOs(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reducedMotion || os;
}

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

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    // A blocked or unavailable store is not an error worth surfacing here.
    return DEFAULTS;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    root.setAttribute('data-scene', settings.scene);
    root.setAttribute('data-reduced-motion', String(settings.reducedMotion));
    root.setAttribute('data-muted', String(settings.muted));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* persistence is a convenience, never a requirement */
    }
  }, [settings]);

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...settings,
      setTheme: (theme) => patch({ theme }),
      setScene: (scene) => patch({ scene }),
      setReducedMotion: (reducedMotion) => patch({ reducedMotion }),
      setMuted: (muted) => patch({ muted }),
    }),
    [settings, patch],
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

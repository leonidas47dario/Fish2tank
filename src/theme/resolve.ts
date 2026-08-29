/**
 * Narrowing a stored theme or scene id to one this build can actually render.
 *
 * Spec 005 FR-A04 stores these as plain strings, because after Release 2 a
 * profile synced from a newer build can name a theme this one has never heard
 * of. Falling back beats rendering an app with no tokens applied.
 *
 * The id lists live in ThemeProvider.tsx alongside their display copy; this
 * module imports them so there is still exactly one definition.
 */
import { SCENES, THEMES, type SceneId, type ThemeId } from './ThemeProvider';

export const DEFAULT_THEME_ID: ThemeId = 'midnight-aquarium';
export const DEFAULT_SCENE_ID: SceneId = 'original-tank';

export function resolveThemeId(id: string | undefined): ThemeId {
  const match = THEMES.find((t) => t.id === id);
  if (match) return match.id;
  if (id) console.warn(`[theme] unknown theme id "${id}", falling back to ${DEFAULT_THEME_ID}`);
  return DEFAULT_THEME_ID;
}

export function resolveSceneId(id: string | undefined): SceneId {
  const match = SCENES.find((s) => s.id === id);
  if (match) return match.id;
  if (id) console.warn(`[theme] unknown scene id "${id}", falling back to ${DEFAULT_SCENE_ID}`);
  return DEFAULT_SCENE_ID;
}

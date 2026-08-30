/**
 * The Settings sections, named once.
 *
 * Spec 018. The navigation and the panels are both generated from this list,
 * so a section cannot appear in one and not the other - which is the whole
 * failure mode a hand-written jump menu has.
 *
 * Ids are explicit rather than slugged from the label. A slug would mean
 * renaming "Your data" silently changes the DOM id, and anything holding that
 * id (a scroll target, a future deep link) breaks without a compiler or a test
 * saying so.
 */
export interface SettingsSection {
  id: string;
  label: string;
  /** Open on arrival. Exactly one, so the screen is a single screenful. */
  defaultOpen?: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'account', label: 'Account', defaultOpen: true },
  { id: 'theme', label: 'Theme' },
  { id: 'data', label: 'Your data' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'build', label: 'Build' },
] as const;

/**
 * The DOM id for a section. Prefixed because `build` and `account` are short
 * enough to collide with something else on a page one day.
 */
export function sectionDomId(id: string): string {
  return `settings-${id}`;
}

/** Ids of the sections that start expanded. */
export function initiallyOpen(
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): string[] {
  return sections.filter((s) => s.defaultOpen).map((s) => s.id);
}

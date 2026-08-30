import { describe, expect, it } from 'vitest';
import {
  SETTINGS_SECTIONS,
  initiallyOpen,
  sectionDomId,
  type SettingsSection,
} from './settings-sections';

describe('SETTINGS_SECTIONS', () => {
  it('has a unique id per section, because the nav scrolls to them by id', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every section a label and a non-empty id', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.id).not.toBe('');
      expect(section.label).not.toBe('');
    }
  });

  it('opens exactly one section on arrival, so the screen stays one screenful', () => {
    expect(initiallyOpen()).toEqual(['account']);
  });

  it('opens Account, because it is what the screen is most often opened for', () => {
    expect(SETTINGS_SECTIONS[0]?.id).toBe('account');
    expect(SETTINGS_SECTIONS[0]?.defaultOpen).toBe(true);
  });

  it('keeps Build last', () => {
    expect(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1]?.id).toBe('build');
  });

  it('namespaces the DOM id rather than using the bare section id', () => {
    expect(sectionDomId('account')).toBe('settings-account');
  });

  it('returns nothing to open when no section asks to be', () => {
    const none: SettingsSection[] = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    expect(initiallyOpen(none)).toEqual([]);
  });
});

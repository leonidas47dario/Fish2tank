import { describe, expect, it } from 'vitest';
import { resolveSceneId, resolveThemeId } from './resolve';

describe('resolveThemeId', () => {
  it('passes a known theme through', () => {
    expect(resolveThemeId('playful-collector')).toBe('playful-collector');
  });

  it('falls back for an id this build does not know', () => {
    expect(resolveThemeId('theme-from-a-newer-build')).toBe('midnight-aquarium');
  });

  it('falls back for absent or empty input', () => {
    expect(resolveThemeId(undefined)).toBe('midnight-aquarium');
    expect(resolveThemeId('')).toBe('midnight-aquarium');
  });
});

describe('resolveSceneId', () => {
  it('passes a known scene through', () => {
    expect(resolveSceneId('planted')).toBe('planted');
  });

  it('falls back for an unknown scene', () => {
    expect(resolveSceneId('nope')).toBe('original-tank');
  });
});

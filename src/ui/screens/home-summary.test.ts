import { describe, expect, it } from 'vitest';
import { homeSummary } from './home-summary';

const base = { metCount: 9, fishKept: 61, tankCount: 7, measured: 4, displayName: 'Ryan' };

describe('homeSummary heading', () => {
  it('greets the keeper by name', () => {
    expect(homeSummary(base).heading).toBe('Welcome, Ryan.');
  });

  it('falls back when no name has been set', () => {
    expect(homeSummary({ ...base, displayName: '' }).heading).toBe('Welcome back.');
  });
});

describe('homeSummary sub', () => {
  it('reports species met and fish kept alongside the tanks', () => {
    expect(homeSummary(base).sub).toBe('9 species met, 61 fish kept. 7 tanks, 4 measured.');
  });

  it('says all measured rather than repeating the number', () => {
    expect(homeSummary({ ...base, measured: 7 }).sub).toBe(
      '9 species met, 61 fish kept. 7 tanks, all measured.',
    );
  });

  it('does not pluralise a single tank', () => {
    expect(homeSummary({ ...base, tankCount: 1, measured: 0 }).sub).toContain('1 tank, 0 measured.');
  });

  it('explains why nothing can be screened when there are no tanks', () => {
    expect(homeSummary({ ...base, tankCount: 0, measured: 0 }).sub).toBe(
      '9 species met, 61 fish kept. No tanks recorded, so nothing can be screened yet.',
    );
  });

  it('keeps "species" and "fish" unpluralised at one', () => {
    expect(homeSummary({ ...base, metCount: 1, fishKept: 1 }).sub).toContain(
      '1 species met, 1 fish kept.',
    );
  });

  it('says nothing caught only when both counts are zero', () => {
    expect(homeSummary({ ...base, metCount: 0, fishKept: 0 }).sub).toContain('Nothing caught yet.');
  });

  it('still reports kept fish when none have been caught, which is the import case', () => {
    // 61 opening-balance holdings and no confirmed catches is exactly the
    // state after the inventory import (FR-O03), so this must not read
    // "Nothing caught yet".
    expect(homeSummary({ ...base, metCount: 0, fishKept: 61 }).sub).toContain(
      '0 species met, 61 fish kept.',
    );
  });

  it('shows a loading line until both counts have arrived', () => {
    expect(homeSummary({ ...base, metCount: undefined }).sub).toBe('Loading your collection…');
    expect(homeSummary({ ...base, fishKept: undefined }).sub).toBe('Loading your collection…');
  });

  it('still greets by name while loading', () => {
    expect(homeSummary({ ...base, metCount: undefined }).heading).toBe('Welcome, Ryan.');
  });
});

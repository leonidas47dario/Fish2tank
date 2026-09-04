import { describe, expect, it } from 'vitest';
import {
  applyTankFilter, countFish, isEmptyFilter, matchesFilter, toggleFilter,
} from './tank-filter';
import type { TankResident } from './tank-stats';
import type { Holding } from './types';

/**
 * Spec 049. What a tap on the dashboard is allowed to claim about a fish.
 *
 * The rule worth guarding is the one about missing data: a fish nobody
 * recorded a zone for must match "Not recorded" and nothing else. Counting it
 * into a likely-looking bucket, or dropping it from every bucket, are the two
 * ways a filter quietly lies about a tank.
 */

function fish(id: string, over: Partial<TankResident> = {}): TankResident {
  return {
    holding: { id, kind: 'individual', openingQuantity: 1, openingBalance: true,
      createdAt: '2024-01-01T00:00:00.000Z' } as Holding,
    quantity: 1,
    commonName: 'A fish',
    ...over,
  };
}

const bottomPeaceful = fish('h1', { waterZone: 'bottom', aggression: 'peaceful', speciesId: 'sp_cory' });
const bottomAggressive = fish('h2', { waterZone: 'bottom', aggression: 'aggressive', speciesId: 'sp_pleco' });
const topPeaceful = fish('h3', { waterZone: 'top', aggression: 'peaceful', speciesId: 'sp_hatchet' });
const unrecorded = fish('h4');
const school = fish('h5', { waterZone: 'mid', aggression: 'peaceful', speciesId: 'sp_neon', quantity: 6 });

const ALL = [bottomPeaceful, bottomAggressive, topPeaceful, unrecorded, school];

describe('tank filter (spec 049)', () => {
  it('an empty filter matches everything and is recognised as empty', () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(applyTankFilter(ALL, {})).toHaveLength(5);
  });

  it('filters by where they swim', () => {
    expect(applyTankFilter(ALL, { zone: 'bottom' }).map((r) => r.holding.id))
      .toEqual(['h1', 'h2']);
  });

  it('filters by temperament', () => {
    expect(applyTankFilter(ALL, { aggression: 'aggressive' }).map((r) => r.holding.id))
      .toEqual(['h2']);
  });

  it('filters by species', () => {
    expect(applyTankFilter(ALL, { speciesId: 'sp_neon' }).map((r) => r.holding.id))
      .toEqual(['h5']);
  });

  it('COMBINES SELECTIONS FROM DIFFERENT CHARTS', () => {
    // The question no single chart can answer, and the reason to combine at
    // all: which of my aggressive fish are bottom-dwellers?
    expect(applyTankFilter(ALL, { zone: 'bottom', aggression: 'aggressive' })
      .map((r) => r.holding.id)).toEqual(['h2']);
  });

  it('A FISH NOBODY RECORDED MATCHES "not recorded" AND NOTHING ELSE', () => {
    // Both failure modes at once: it must not be counted into a likely bucket,
    // and it must not vanish from every bucket.
    expect(matchesFilter(unrecorded, { zone: 'unknown' })).toBe(true);
    expect(matchesFilter(unrecorded, { aggression: 'unknown' })).toBe(true);
    expect(matchesFilter(unrecorded, { zone: 'bottom' })).toBe(false);
    expect(matchesFilter(unrecorded, { aggression: 'peaceful' })).toBe(false);
    expect(applyTankFilter(ALL, { zone: 'unknown' }).map((r) => r.holding.id)).toEqual(['h4']);
  });

  it('does not let a recorded fish match "not recorded"', () => {
    expect(matchesFilter(bottomPeaceful, { zone: 'unknown' })).toBe(false);
  });

  it('toggles a selection off when the same value is tapped again', () => {
    const on = toggleFilter({}, 'zone', 'bottom');
    expect(on.zone).toBe('bottom');
    expect(isEmptyFilter(toggleFilter(on, 'zone', 'bottom'))).toBe(true);
  });

  it('replaces the selection within one chart, and keeps the others', () => {
    const both = toggleFilter(toggleFilter({}, 'zone', 'bottom'), 'aggression', 'peaceful');
    const moved = toggleFilter(both, 'zone', 'top');

    expect(moved).toEqual({ zone: 'top', aggression: 'peaceful' });
  });

  it('never mutates the filter it was handed', () => {
    const before = { zone: 'bottom' as const };
    toggleFilter(before, 'aggression', 'peaceful');
    expect(before).toEqual({ zone: 'bottom' });
  });

  it('COUNTS FISH, NOT HOLDINGS', () => {
    // A holding of six tetras is six fish. "Showing 1 of 24" above a grid
    // displaying six animals would disagree with the stat tile above it.
    expect(countFish(applyTankFilter(ALL, { speciesId: 'sp_neon' }))).toBe(6);
    expect(countFish(ALL)).toBe(10);
  });

  it('reports an impossible combination as no fish rather than as everything', () => {
    // The empty-filter shortcut must not swallow a filter that simply matches
    // nothing - that would show the whole tank under a claim of filtering it.
    expect(applyTankFilter(ALL, { zone: 'top', aggression: 'aggressive' })).toEqual([]);
  });
});

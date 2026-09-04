/**
 * Filtering a tank by tapping its dashboard - spec 049.
 *
 * THE GAP THIS CLOSES. The dashboard answers *how many* and the grid answers
 * *which ones*, and nothing connected them: a keeper reading "Aggressive 2" on
 * a tank of 24 learned that two are a problem and had no way to find out which.
 * The number that raises the question could not answer it.
 *
 * PURE, like everything in `domain/`. No React, no clock, no database - which
 * is what lets the rule about what may be counted as a match be tested rather
 * than looked at.
 *
 * WHERE P6 BITES. A fish with no recorded water zone matches the `unknown`
 * selection and no other. It is never quietly counted into whichever bucket
 * seems likely, and it never silently disappears from a tank being filtered on
 * a dimension nobody recorded for it. That is the rule the tallies in
 * `tank-stats.ts` already follow, applied to selection.
 */
import type { TankResident } from './tank-stats';
import type { AggressionRating } from './types';
import type { WaterZone } from '@/data/seed/taxonomy';

/** Which chart a selection came from. One selection per chart, at most. */
export interface TankFilter {
  zone?: WaterZone | 'unknown';
  aggression?: AggressionRating | 'unknown';
  /** A species, from a `Grown up` row. Never 'unknown' - those rows have one. */
  speciesId?: string;
}

export type TankFilterDimension = keyof TankFilter;

export function isEmptyFilter(filter: TankFilter): boolean {
  return !filter.zone && !filter.aggression && !filter.speciesId;
}

/**
 * Tap to select, tap the same thing again to clear it.
 *
 * Returns a new object rather than mutating, so React sees the change and a
 * caller holding the previous filter still has it.
 */
export function toggleFilter(
  filter: TankFilter,
  dimension: TankFilterDimension,
  value: string,
): TankFilter {
  const next = { ...filter };
  if (next[dimension] === value) delete next[dimension];
  else next[dimension] = value as never;
  return next;
}

/** Does this resident match every selection currently made? */
export function matchesFilter(resident: TankResident, filter: TankFilter): boolean {
  if (filter.zone && (resident.waterZone ?? 'unknown') !== filter.zone) return false;
  if (filter.aggression && (resident.aggression ?? 'unknown') !== filter.aggression) return false;
  if (filter.speciesId && resident.speciesId !== filter.speciesId) return false;
  return true;
}

export function applyTankFilter(
  residents: TankResident[],
  filter: TankFilter,
): TankResident[] {
  if (isEmptyFilter(filter)) return residents;
  return residents.filter((r) => matchesFilter(r, filter));
}

/**
 * How many FISH match, not how many holdings.
 *
 * Every other number on the dashboard counts animals - a holding of six tetras
 * is six fish - and a grid that said "showing 1 of 24" while displaying six
 * animals would disagree with the stat tile directly above it.
 */
export function countFish(residents: TankResident[]): number {
  return residents.reduce((n, r) => n + r.quantity, 0);
}

/**
 * What a tank adds up to - the numbers behind the viewer dashboard.
 *
 * Pure, and deliberately separate from the screen that draws it: these are
 * claims about someone's fish, and a claim you can test is worth more than one
 * you can only look at.
 *
 * THE RULE THAT SHAPES ALL OF IT. A tank is never fully described by the
 * catalog. Twelve of the sixty-one seeded holdings are labels nobody could
 * resolve to a species - "Severum (unspecified)", "Striped cory" - and the
 * project refuses to guess them (see the README). So every total here reports
 * its own denominator: how many fish it counted, and how many it could not.
 * A dashboard that silently averaged over 80% of a tank and presented it as
 * the tank would be the most confident kind of lie.
 */
import type { AggressionRating, Holding, LifeEvent } from './types';
import type { WaterZone } from '@/data/seed/taxonomy';

/** One resident, joined to whatever the catalog and market could tell us. */
export interface TankResident {
  holding: Holding;
  quantity: number;
  speciesId?: string;
  commonName: string;
  scientificName?: string;
  portraitUrl?: string;
  adultSizeIn?: number;
  minVolumeGal?: number;
  aggression?: AggressionRating;
  waterZone?: WaterZone;
  /** Median market price for one fish, when the index can price it. */
  unitPrice?: number;
}

/** A count with the share it represents, so a bar never has to be re-derived. */
export interface Slice<T extends string> {
  key: T;
  label: string;
  fish: number;
  share: number;
}

export const WATER_ZONE_ORDER: WaterZone[] = ['top', 'mid', 'bottom', 'all-levels'];
export const WATER_ZONE_LABEL: Record<WaterZone, string> = {
  top: 'Top', mid: 'Middle', bottom: 'Bottom', 'all-levels': 'All levels',
};

export const AGGRESSION_ORDER: AggressionRating[] = [
  'peaceful', 'semi-aggressive', 'aggressive', 'highly-aggressive',
];
export const AGGRESSION_LABEL: Record<AggressionRating, string> = {
  peaceful: 'Peaceful',
  'semi-aggressive': 'Semi-aggressive',
  aggressive: 'Aggressive',
  'highly-aggressive': 'Highly aggressive',
};

export interface TankStats {
  /** Every fish in the tank, counting quantities, identified or not. */
  fish: number;
  /** Distinct species, among residents the catalog could resolve. */
  species: number;
  /** Fish whose holding never resolved to a species. Excluded from every chart. */
  unidentifiedFish: number;

  /** Sum of median market price x quantity, over the fish that can be priced. */
  estimatedValue?: number;
  /** How many fish that figure covers, and how many it does not. */
  valuedFish: number;
  unvaluedFish: number;

  byZone: Slice<WaterZone | 'unknown'>[];
  zonedFish: number;
  byAggression: Slice<AggressionRating | 'unknown'>[];
  ratedFish: number;

  /** Biggest adult size among residents, and who it is. */
  largest?: { name: string; adultSizeIn: number };
  /** The largest minimum-volume requirement any single resident carries. */
  mostDemanding?: { name: string; minVolumeGal: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function tally<T extends string>(
  residents: TankResident[],
  pick: (r: TankResident) => T | undefined,
  order: T[],
  labels: Record<T, string>,
): { slices: Slice<T | 'unknown'>[]; known: number } {
  const counts = new Map<T | 'unknown', number>();
  let known = 0;
  for (const r of residents) {
    const key = pick(r);
    if (key) known += r.quantity;
    const k = (key ?? 'unknown') as T | 'unknown';
    counts.set(k, (counts.get(k) ?? 0) + r.quantity);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  // 'unknown' is always last and always shown when non-zero: it is the part of
  // the tank the chart cannot speak for, and hiding it would overstate the rest.
  const keys: Array<T | 'unknown'> = [...order, 'unknown' as const];
  return {
    known,
    slices: keys
      .filter((k) => (counts.get(k) ?? 0) > 0)
      .map((k) => ({
        key: k,
        label: k === 'unknown' ? 'Not recorded' : labels[k as T],
        fish: counts.get(k)!,
        share: total ? round2((counts.get(k)! / total) * 100) : 0,
      })),
  };
}

export function summariseTank(residents: TankResident[]): TankStats {
  const fish = residents.reduce((n, r) => n + r.quantity, 0);
  const identified = residents.filter((r) => r.speciesId);

  const priced = residents.filter((r) => r.unitPrice !== undefined);
  const valuedFish = priced.reduce((n, r) => n + r.quantity, 0);
  const estimatedValue = priced.length
    ? round2(priced.reduce((sum, r) => sum + r.unitPrice! * r.quantity, 0))
    : undefined;

  const zones = tally(residents, (r) => r.waterZone, WATER_ZONE_ORDER, WATER_ZONE_LABEL);
  const aggro = tally(residents, (r) => r.aggression, AGGRESSION_ORDER, AGGRESSION_LABEL);

  const sized = residents.filter((r) => r.adultSizeIn !== undefined);
  const largest = sized.length
    ? sized.reduce((a, b) => (b.adultSizeIn! > a.adultSizeIn! ? b : a))
    : undefined;

  const demanding = residents.filter((r) => r.minVolumeGal !== undefined);
  const mostDemanding = demanding.length
    ? demanding.reduce((a, b) => (b.minVolumeGal! > a.minVolumeGal! ? b : a))
    : undefined;

  return {
    fish,
    species: new Set(identified.map((r) => r.speciesId)).size,
    unidentifiedFish: fish - identified.reduce((n, r) => n + r.quantity, 0),

    estimatedValue,
    valuedFish,
    unvaluedFish: fish - valuedFish,

    byZone: zones.slices,
    zonedFish: zones.known,
    byAggression: aggro.slices,
    ratedFish: aggro.known,

    ...(largest ? { largest: { name: largest.commonName, adultSizeIn: largest.adultSizeIn! } } : {}),
    ...(mostDemanding
      ? { mostDemanding: { name: mostDemanding.commonName, minVolumeGal: mostDemanding.minVolumeGal! } }
      : {}),
  };
}

/** Residents ordered for display: biggest first, unidentified last. */
export function forDisplay(residents: TankResident[]): TankResident[] {
  return [...residents].sort((a, b) => {
    if (Boolean(a.speciesId) !== Boolean(b.speciesId)) return a.speciesId ? -1 : 1;
    return (b.adultSizeIn ?? 0) - (a.adultSizeIn ?? 0)
      || a.commonName.localeCompare(b.commonName);
  });
}

/** Quantity for a holding, re-exported so the screen has one import. */
export type { Holding, LifeEvent };

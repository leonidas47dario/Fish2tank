/**
 * Price-fit calculation contract - PRD 5.4.
 *
 * Rules this module exists to enforce:
 *   - Normalize only genuinely comparable observations (species, size range,
 *     basis, currency, date window).
 *   - Show median and range ONLY when the minimum sample count is met, and
 *     always show the sample count.
 *   - Keep membership discount a separate observation; surface both sticker
 *     and effective price (FR-P03).
 *   - When comparison is weak, show the recorded facts and "Insufficient
 *     comparison data" - never an unsupported bargain badge (FR-P04).
 */
import type { CurrencyCode, Id, LengthMeasurement, PriceBasis, PriceObservation } from '@/domain/types';
import { toCm } from '@/domain/units';

export interface PriceFitConfig {
  version: string;
  /** Below this many comparable observations, no median is published. */
  minimumSampleCount: number;
  /** Observations older than this are not comparable to the subject. */
  dateWindowDays: number;
  /**
   * Fractional size tolerance. 0.5 means a comparable must be within +/-50%
   * of the subject's observed length - a 3in and a 9in specimen of the same
   * species are simply not the same product.
   */
  sizeTolerance: number;
  /**
   * Percentage band around the median that counts as "in line". FR-P04
   * forbids a deal badge "without a stated threshold", so this value is
   * returned in every result rather than being applied invisibly.
   */
  inLineTolerance: number;
}

export const DEFAULT_PRICE_CONFIG: PriceFitConfig = {
  version: 'price-fit-v0.1.0',
  minimumSampleCount: 3,
  dateWindowDays: 365,
  sizeTolerance: 0.5,
  inLineTolerance: 0.15,
};

/** Why an observation was left out. Surfaced to the user (NFR-05). */
export type ExclusionReason =
  | 'different-species'
  | 'different-currency'
  | 'outside-date-window'
  | 'size-not-comparable'
  | 'size-unknown'
  | 'missing-package-quantity'
  | 'no-price-recorded'
  | 'is-subject';

export interface ExcludedObservation {
  observationId: Id;
  reason: ExclusionReason;
}

export interface PricePoint {
  observationId: Id;
  /** Price per individual fish after normalizing the basis (FR-P04). */
  unitPrice: number;
  /** The price actually payable: member price when present, else asking. */
  effective: number;
  sticker?: number;
  memberPrice?: number;
  basis: PriceBasis;
  packageQuantity: number;
  observedAt: string;
  observedSize?: LengthMeasurement;
}

export type PriceFitStatus = 'compared' | 'insufficient-comparison-data';
export type PriceBand = 'below-market' | 'in-line' | 'above-market';

export interface PriceFitResult {
  status: PriceFitStatus;
  configVersion: string;
  /** Always reported, whatever the status (PRD 5.4: "always show sample count"). */
  sampleCount: number;
  minimumSampleCount: number;
  /** The subject's own recorded facts, always shown even with no comparison. */
  subject: {
    sticker?: number;
    memberPrice?: number;
    paidPrice?: number;
    unitPrice?: number;
    effective?: number;
    currency: CurrencyCode;
    basis: PriceBasis;
    packageQuantity: number;
    observedSize?: LengthMeasurement;
  };
  comparables: PricePoint[];
  excluded: ExcludedObservation[];
  /** Populated only when status === 'compared'. */
  comparison?: {
    median: number;
    min: number;
    max: number;
    sizeRange?: { minCm: number; maxCm: number };
    dateRange: { earliest: string; latest: string };
    /** The subject's position, with the threshold that produced it. */
    band: PriceBand;
    percentDifferenceFromMedian: number;
    inLineTolerance: number;
  };
  message: string;
}

/** Per-fish price. Requires a package quantity, per FR-P04. */
function unitPriceOf(o: PriceObservation): number | undefined {
  const headline = o.memberPrice ?? o.askingPrice ?? o.paidPrice;
  if (headline === undefined) return undefined;
  if (!o.packageQuantity || o.packageQuantity < 1) return undefined;
  return headline / o.packageQuantity;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function classify(subjectUnit: number, med: number, tolerance: number): { band: PriceBand; percent: number } {
  const percent = (subjectUnit - med) / med;
  if (percent < -tolerance) return { band: 'below-market', percent };
  if (percent > tolerance) return { band: 'above-market', percent };
  return { band: 'in-line', percent };
}

export interface PriceFitInput {
  subject: PriceObservation;
  /** Every other price observation the user has recorded. */
  candidates: PriceObservation[];
}

/**
 * Compare one price observation against the user's own history.
 *
 * FR-P02: the comparison set is the user's own saved observations plus any
 * manually entered comparisons. Nothing is fetched; nothing is inferred from
 * a market the app cannot see.
 */
export function evaluatePriceFit(
  { subject, candidates }: PriceFitInput,
  cfg: PriceFitConfig = DEFAULT_PRICE_CONFIG,
): PriceFitResult {
  const subjectUnit = unitPriceOf(subject);
  const subjectSizeCm = toCm(subject.observedSize);

  const comparables: PricePoint[] = [];
  const excluded: ExcludedObservation[] = [];

  for (const o of candidates) {
    if (o.id === subject.id) {
      excluded.push({ observationId: o.id, reason: 'is-subject' });
      continue;
    }
    if (!subject.speciesId || o.speciesId !== subject.speciesId) {
      excluded.push({ observationId: o.id, reason: 'different-species' });
      continue;
    }
    if (o.currency !== subject.currency) {
      excluded.push({ observationId: o.id, reason: 'different-currency' });
      continue;
    }
    if (daysBetween(o.observedAt, subject.observedAt) > cfg.dateWindowDays) {
      excluded.push({ observationId: o.id, reason: 'outside-date-window' });
      continue;
    }
    if (!o.packageQuantity || o.packageQuantity < 1) {
      excluded.push({ observationId: o.id, reason: 'missing-package-quantity' });
      continue;
    }
    const unit = unitPriceOf(o);
    if (unit === undefined) {
      excluded.push({ observationId: o.id, reason: 'no-price-recorded' });
      continue;
    }
    // Size comparability. If either side's size is unrecorded we cannot claim
    // the two are the same product, so the observation is excluded and the
    // reason is reported rather than quietly assumed away.
    const otherSizeCm = toCm(o.observedSize);
    if (subjectSizeCm === undefined || otherSizeCm === undefined) {
      excluded.push({ observationId: o.id, reason: 'size-unknown' });
      continue;
    }
    const ratio = Math.abs(otherSizeCm - subjectSizeCm) / subjectSizeCm;
    if (ratio > cfg.sizeTolerance) {
      excluded.push({ observationId: o.id, reason: 'size-not-comparable' });
      continue;
    }

    comparables.push({
      observationId: o.id,
      unitPrice: unit,
      effective: o.memberPrice ?? o.askingPrice ?? o.paidPrice ?? unit,
      sticker: o.askingPrice,
      memberPrice: o.memberPrice,
      basis: o.basis,
      packageQuantity: o.packageQuantity,
      observedAt: o.observedAt,
      observedSize: o.observedSize,
    });
  }

  const subjectFacts: PriceFitResult['subject'] = {
    sticker: subject.askingPrice,
    memberPrice: subject.memberPrice,
    paidPrice: subject.paidPrice,
    unitPrice: subjectUnit,
    effective: subject.memberPrice ?? subject.askingPrice ?? subject.paidPrice,
    currency: subject.currency,
    basis: subject.basis,
    packageQuantity: subject.packageQuantity,
    observedSize: subject.observedSize,
  };

  const base = {
    configVersion: cfg.version,
    sampleCount: comparables.length,
    minimumSampleCount: cfg.minimumSampleCount,
    subject: subjectFacts,
    comparables,
    excluded,
  };

  if (comparables.length < cfg.minimumSampleCount || subjectUnit === undefined) {
    return {
      ...base,
      status: 'insufficient-comparison-data',
      message:
        subjectUnit === undefined
          ? 'Insufficient comparison data - no comparable price recorded for this encounter.'
          : `Insufficient comparison data - ${comparables.length} comparable observation(s), ${cfg.minimumSampleCount} needed.`,
    };
  }

  const units = comparables.map((c) => c.unitPrice);
  const med = median(units);
  const { band, percent } = classify(subjectUnit, med, cfg.inLineTolerance);
  const sizes = comparables.map((c) => toCm(c.observedSize)!).filter((n) => Number.isFinite(n));
  const dates = comparables.map((c) => c.observedAt).sort();

  return {
    ...base,
    status: 'compared',
    comparison: {
      median: med,
      min: Math.min(...units),
      max: Math.max(...units),
      sizeRange: sizes.length ? { minCm: Math.min(...sizes), maxCm: Math.max(...sizes) } : undefined,
      dateRange: { earliest: dates[0]!, latest: dates[dates.length - 1]! },
      band,
      percentDifferenceFromMedian: percent,
      inLineTolerance: cfg.inLineTolerance,
    },
    message: `Compared against ${comparables.length} of your own observations.`,
  };
}

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  'different-species': 'Different species',
  'different-currency': 'Different currency',
  'outside-date-window': 'Outside the comparison date window',
  'size-not-comparable': 'Size too different to compare',
  'size-unknown': 'Size not recorded on one side',
  'missing-package-quantity': 'No package quantity, so no per-fish price',
  'no-price-recorded': 'No price recorded',
  'is-subject': 'This is the observation being compared',
};

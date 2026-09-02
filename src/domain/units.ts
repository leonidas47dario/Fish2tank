/**
 * Unit normalization. Every rule compares in a single canonical unit so that a
 * tank recorded in gallons and a profile recorded in litres never silently
 * mis-compare.
 */
import type { LengthMeasurement, VolumeMeasurement, WeightMeasurement } from './types';

const CM_PER_IN = 2.54;
const L_PER_GAL = 3.785411784;

export function toCm(m: LengthMeasurement | undefined): number | undefined {
  if (!m) return undefined;
  return m.unit === 'cm' ? m.value : m.value * CM_PER_IN;
}

export function toLitres(m: VolumeMeasurement | undefined): number | undefined {
  if (!m) return undefined;
  return m.unit === 'l' ? m.value : m.value * L_PER_GAL;
}

export function fromCm(cm: number, unit: 'in' | 'cm'): LengthMeasurement {
  return { value: unit === 'cm' ? cm : cm / CM_PER_IN, unit };
}

export function fromLitres(l: number, unit: 'gal' | 'l'): VolumeMeasurement {
  return { value: unit === 'l' ? l : l / L_PER_GAL, unit };
}

export function formatLength(m: LengthMeasurement | undefined): string {
  if (!m) return 'unknown';
  const rounded = Math.round(m.value * 10) / 10;
  return `${rounded}${m.unit}${m.estimate ? ' (est.)' : ''}`;
}

export function formatVolume(m: VolumeMeasurement | undefined): string {
  if (!m) return 'unknown';
  const rounded = Math.round(m.value * 10) / 10;
  return `${rounded}${m.unit === 'gal' ? 'G' : 'L'}`;
}

/**
 * A weight with its unit - spec 037. Same shape and same rounding as
 * `formatLength`, including the estimate marker, so an eyeballed weight is
 * never mistaken for one off a scale.
 */
export function formatWeight(m: WeightMeasurement | undefined): string {
  if (!m) return 'unknown';
  const rounded = Math.round(m.value * 10) / 10;
  return `${rounded}${m.unit}${m.estimate ? ' (est.)' : ''}`;
}

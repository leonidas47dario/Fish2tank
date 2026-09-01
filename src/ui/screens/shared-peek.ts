/**
 * What the shared-tank peek can honestly show about a fish (spec 025).
 *
 * Split out of `SharedTank.tsx` because it is the only part of the peek with a
 * decision in it, and this repo tests UI by extracting the decision rather than
 * by rendering (see `home-summary.ts`, `settings-sections.ts`).
 *
 * THE RULE IS P6: never invent a number. A field nobody measured is ABSENT,
 * not blurred - a blurred "unknown" pretends there is something behind the
 * blur, which is fabrication in its most tempting form, because the blur is
 * exactly what stops anyone checking.
 */
import type { SharedResident } from '@/data/share/snapshot';

export interface PeekRow {
  label: string;
  value: string;
}

/**
 * The rows worth blurring, in reading order.
 *
 * Only what the published snapshot actually carries. Zero is treated as
 * missing for size, volume and price on purpose: a 0 in adult size or price is
 * a gap in the data rather than a fish of no size, and rendering "$0.00" as a
 * typical price would be a fabricated fact wearing a currency symbol.
 */
export function peekRows(resident: SharedResident): PeekRow[] {
  const rows: PeekRow[] = [];
  if (resident.adultSizeIn) rows.push({ label: 'Adult size', value: `${resident.adultSizeIn.toFixed(1)} in` });
  if (resident.minVolumeGal) rows.push({ label: 'Minimum tank', value: `${resident.minVolumeGal} gal` });
  if (resident.aggression) rows.push({ label: 'Temperament', value: resident.aggression });
  if (resident.waterZone) rows.push({ label: 'Swims', value: resident.waterZone });
  if (resident.unitPrice) rows.push({ label: 'Typical price', value: `$${resident.unitPrice.toFixed(2)}` });
  return rows;
}

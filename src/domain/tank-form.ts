/**
 * What editing a tank should actually write - BUG-09.
 *
 * PURE, so the rule that decides whether a footprint survives an edit can be
 * tested rather than observed by editing a tank and looking.
 *
 * TWO DEFECTS, ONE FUNCTION, and they compound.
 *
 * 1. EVERY SAVE WROTE EVERY KEY. `db.aquariums.update()` was handed all four
 *    fields on every save, and Dexie DELETES a property given `undefined`. So
 *    a field that happened to be blank was destroyed by an edit to a different
 *    field - renaming a tank could take its footprint with it, and the
 *    footprint is what the swim-space and minimum-footprint screening rules
 *    need. This is the same shape as BUG-16 in `updateCatch`, which was fixed
 *    by patching only the keys the caller mentioned.
 *
 * 2. THE STORED UNIT WAS DISCARDED. The form read `dimensions.length.value`
 *    and wrote it back with `unit: 'in'` hardcoded, and read `volume.value`
 *    and wrote `unit: 'gal'`. A tank held in centimetres or litres therefore
 *    had its NUMBER relabelled rather than converted - a silent 2.54x error on
 *    a footprint and 3.79x on a volume, in the direction that makes a tank
 *    look bigger than it is. Worse than deletion, because nothing looks wrong.
 *
 * AN EXPLICIT CLEAR IS STILL A CLEAR. Blanking a box that had a value writes
 * `undefined` deliberately - the keeper said "I do not know this", which P6
 * treats as a real answer. What must not happen is a field nobody touched
 * being cleared as a side effect.
 */
import type { Aquarium, Dimensions, LengthUnit, StockingState, VolumeUnit } from './types';

export interface TankFormValues {
  name: string;
  /** As typed. Empty means the box is blank. */
  gallons: string;
  length: string;
  width: string;
  height: string;
  stocking: StockingState | '';
}

/** Only the keys that should actually change. Absent means "leave it alone". */
export type TankPatch = Partial<Pick<Aquarium, 'name' | 'volume' | 'dimensions' | 'stockingState'>>;

const num = (s: string): number | undefined => {
  const n = Number(s.trim());
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

export function tankFormPatch(form: TankFormValues, current: Aquarium): TankPatch {
  const patch: TankPatch = {};

  const name = form.name.trim();
  if (name && name !== current.name) patch.name = name;

  /*
   * The unit comes from what is STORED, not from the label above the box. The
   * box is titled "Volume (gallons)" and a tank imported in litres was still
   * shown its litre figure, so writing `gal` turned 200 L into 200 gal.
   */
  const gallons = num(form.gallons);
  const volUnit: VolumeUnit = current.volume?.unit ?? 'gal';
  if (gallons === undefined) {
    if (current.volume !== undefined) patch.volume = undefined; // a real clear
  } else if (gallons !== current.volume?.value || volUnit !== current.volume?.unit) {
    patch.volume = { value: gallons, unit: volUnit };
  }

  const l = num(form.length); const w = num(form.width); const h = num(form.height);
  const dimUnit: LengthUnit = current.dimensions?.length.unit ?? 'in';
  if (l === undefined || w === undefined || h === undefined) {
    // All three are needed for a footprint; a partial one is not a smaller
    // footprint, it is no footprint.
    if (current.dimensions !== undefined) patch.dimensions = undefined;
  } else {
    const next: Dimensions = {
      length: { value: l, unit: dimUnit },
      width: { value: w, unit: dimUnit },
      height: { value: h, unit: dimUnit },
    };
    const same = current.dimensions
      && current.dimensions.length.value === l && current.dimensions.width.value === w
      && current.dimensions.height.value === h && current.dimensions.length.unit === dimUnit;
    if (!same) patch.dimensions = next;
  }

  const stocking = form.stocking || undefined;
  if (stocking !== current.stockingState) patch.stockingState = stocking;

  return patch;
}

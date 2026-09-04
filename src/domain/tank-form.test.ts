import { describe, expect, it } from 'vitest';
import { tankFormPatch, type TankFormValues } from './tank-form';
import type { Aquarium } from './types';

/**
 * BUG-09. The rule that decides whether a tank's footprint survives an edit.
 *
 * The two failure modes are opposite in shape and both silent: a field nobody
 * touched being deleted, and a field being kept but relabelled into the wrong
 * unit. Neither shows an error, and the footprint is what the swim-space and
 * minimum-footprint screening rules read.
 */
const tank = (over: Partial<Aquarium> = {}): Aquarium => ({
  id: 'aq_1', name: 'Peaceful Garden', kind: 'display', status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z', ...over,
});

const form = (over: Partial<TankFormValues> = {}): TankFormValues => ({
  name: 'Peaceful Garden', gallons: '', length: '', width: '', height: '', stocking: '', ...over,
});

const SIXTY_GAL = { value: 60, unit: 'gal' as const };
const FOOTPRINT = {
  length: { value: 48, unit: 'in' as const },
  width: { value: 18, unit: 'in' as const },
  height: { value: 21, unit: 'in' as const },
};

describe('editing a tank (BUG-09)', () => {
  it('RENAMING A TANK TOUCHES ONLY THE NAME', () => {
    /*
     * The reported bug: every save wrote every key, and Dexie DELETES a
     * property given `undefined`, so an edit to the name took the footprint
     * with it. The form is seeded from the tank, so a rename arrives with the
     * measurement boxes still holding their stored values - and the patch must
     * then contain the name and nothing else.
     */
    const current = tank({ volume: SIXTY_GAL, dimensions: FOOTPRINT, stockingState: 'crowded' });
    const seeded = form({
      name: 'The 75', gallons: '60', length: '48', width: '18', height: '21', stocking: 'crowded',
    });

    const patch = tankFormPatch(seeded, current);

    expect(patch).toEqual({ name: 'The 75' });
    expect('dimensions' in patch).toBe(false);
    expect('volume' in patch).toBe(false);
    expect('stockingState' in patch).toBe(false);
  });

  it('CLEARS EVERYTHING IF THE FORM WAS NEVER SEEDED - which is why seeding matters', () => {
    /*
     * The other half of the mechanism, asserted so it is not a surprise. This
     * function cannot tell "the keeper blanked the box" from "the box was
     * never filled in", and it must not: blanking is a real answer (P6).
     *
     * The protection therefore has to live where the form is built - it is
     * remounted per tank via a `key`, so its boxes always start from the tank
     * on screen. Without that, this is what an unrelated edit would write.
     */
    const current = tank({ volume: SIXTY_GAL, dimensions: FOOTPRINT, stockingState: 'crowded' });

    const patch = tankFormPatch(form({ name: 'The 75' }), current);

    expect(patch.name).toBe('The 75');
    expect('volume' in patch).toBe(true);
    expect(patch.volume).toBeUndefined();
    expect('dimensions' in patch).toBe(true);
  });

  it('KEEPS THE STORED UNIT rather than relabelling the number', () => {
    // The box is titled "Volume (gallons)" and a tank imported in litres was
    // still shown its litre figure. Writing `gal` turned 200 L into 200 gal -
    // a 3.79x error, in the direction that makes a tank look bigger.
    const current = tank({ volume: { value: 200, unit: 'l' } });
    const patch = tankFormPatch(form({ gallons: '250' }), current);

    expect(patch.volume).toEqual({ value: 250, unit: 'l' });
  });

  it('keeps a centimetre footprint in centimetres', () => {
    const cm = {
      length: { value: 120, unit: 'cm' as const },
      width: { value: 45, unit: 'cm' as const },
      height: { value: 50, unit: 'cm' as const },
    };
    const patch = tankFormPatch(
      form({ length: '130', width: '45', height: '50' }),
      tank({ dimensions: cm }),
    );

    expect(patch.dimensions?.length).toEqual({ value: 130, unit: 'cm' });
  });

  it('writes nothing at all when nothing changed', () => {
    const current = tank({ volume: SIXTY_GAL, dimensions: FOOTPRINT, stockingState: 'crowded' });
    const patch = tankFormPatch(
      form({ gallons: '60', length: '48', width: '18', height: '21', stocking: 'crowded' }),
      current,
    );

    expect(patch).toEqual({});
  });

  it('STILL CLEARS A FIELD THE KEEPER ACTUALLY BLANKED', () => {
    // P6: "I do not know this" is a real answer. What must not happen is a
    // field nobody touched being cleared as a side effect of another edit.
    const current = tank({ volume: SIXTY_GAL, dimensions: FOOTPRINT });
    const patch = tankFormPatch(form({ gallons: '', length: '48', width: '18', height: '21' }), current);

    expect('volume' in patch).toBe(true);
    expect(patch.volume).toBeUndefined();
    expect('dimensions' in patch).toBe(false);
  });

  it('treats a half-filled footprint as no footprint, not a smaller one', () => {
    const patch = tankFormPatch(
      form({ length: '48', width: '18', height: '' }),
      tank({ dimensions: FOOTPRINT }),
    );

    expect('dimensions' in patch).toBe(true);
    expect(patch.dimensions).toBeUndefined();
  });

  it('ignores a blank or nonsense number rather than storing NaN', () => {
    const patch = tankFormPatch(form({ gallons: 'sixty' }), tank());
    expect(patch).toEqual({});
  });

  it('refuses to blank a name', () => {
    // A tank with no name is unfindable; the field is not optional the way
    // the measurements are.
    expect(tankFormPatch(form({ name: '   ' }), tank({ name: 'Peaceful Garden' }))).toEqual({});
  });
});

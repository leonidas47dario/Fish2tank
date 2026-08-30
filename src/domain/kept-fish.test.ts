import { describe, expect, it } from 'vitest';
import { keptFishRows } from './kept-fish';
import type { Aquarium, Holding, LifeEvent, Residency, Specimen } from './types';

const NOW = '2026-08-27T12:00:00.000Z';

function specimen(over: Partial<Specimen> & { id: string }): Specimen {
  return {
    kind: 'individual', identityStatus: 'user-confirmed', status: 'resident',
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

function holding(over: Partial<Holding> & { id: string }): Holding {
  return {
    kind: 'individual', openingQuantity: 1, openingBalance: true, createdAt: NOW, ...over,
  };
}

function residency(over: Partial<Residency> & { id: string; holdingId: string }): Residency {
  return { aquariumId: 'tank_garden', startDate: '2026-01-01', ...over };
}

function tank(id: string, name: string): Aquarium {
  return { id, name, kind: 'display', status: 'active', createdAt: NOW };
}

const TANKS = [tank('tank_garden', 'Peaceful Garden'), tank('tank_75g', '75G')];

function rows(over: {
  specimens?: Specimen[];
  holdings?: Holding[];
  residencies?: Residency[];
  lifeEvents?: LifeEvent[];
} = {}) {
  return keptFishRows({
    specimens: over.specimens ?? [],
    holdings: over.holdings ?? [],
    residencies: over.residencies ?? [],
    lifeEvents: over.lifeEvents ?? [],
    aquariums: TANKS,
    speciesName: 'Super red severum',
  });
}

/**
 * Spec 019. Before it, "Your fish" rendered two lists with different facts:
 * specimens showed a name and a date, holdings showed a name, a count and a
 * tank. Opening a holding minted a specimen, which moved the row into the
 * other list and silently dropped its count and its tank.
 */
describe('keptFishRows', () => {
  it('gives a holding with no specimen a row you can mint from', () => {
    const [row, ...rest] = rows({
      holdings: [holding({ id: 'h1', rawLabel: 'Super red severum' })],
      residencies: [residency({ id: 'r1', holdingId: 'h1' })],
    });

    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      key: 'h1', holdingId: 'h1',
      name: 'Super red severum', quantity: 1, tanks: ['Peaceful Garden'],
    });
    expect(row!.specimenId).toBeUndefined();
  });

  it('falls back to the species name when the holding has no label of its own', () => {
    const [row] = rows({ holdings: [holding({ id: 'h1' })] });
    expect(row!.name).toBe('Super red severum');
  });

  it('hides a holding nothing is left of', () => {
    expect(rows({
      holdings: [holding({ id: 'h1', openingQuantity: 2 })],
      lifeEvents: [{
        id: 'e1', holdingId: 'h1', type: 'deceased', occurredOn: '2026-08-02',
        quantityDelta: -2, createdAt: NOW,
      }],
    })).toHaveLength(0);
  });

  it('carries the count and the tank onto a specimen row too', () => {
    const [row] = rows({
      specimens: [specimen({ id: 's1', nickname: 'pineapple' })],
      holdings: [holding({ id: 'h1', specimenId: 's1', openingQuantity: 3, kind: 'group' })],
      residencies: [residency({ id: 'r1', holdingId: 'h1' })],
    });

    expect(row).toMatchObject({
      key: 's1', specimenId: 's1',
      name: 'pineapple', quantity: 3, tanks: ['Peaceful Garden'], createdAt: NOW,
    });
    expect(row!.holdingId).toBeUndefined();
  });

  it('sums a specimen kept in two tanks, and names both', () => {
    const [row] = rows({
      specimens: [specimen({ id: 's1', rawLabel: 'Congo puffer' })],
      holdings: [
        holding({ id: 'h1', specimenId: 's1', openingQuantity: 1 }),
        holding({ id: 'h2', specimenId: 's1', openingQuantity: 2 }),
      ],
      residencies: [
        residency({ id: 'r1', holdingId: 'h1' }),
        residency({ id: 'r2', holdingId: 'h2', aquariumId: 'tank_75g' }),
      ],
    });

    expect(row).toMatchObject({ quantity: 3, tanks: ['Peaceful Garden', '75G'] });
  });

  it('keeps a caught fish that was never brought home, with no tank and no count', () => {
    const [row] = rows({ specimens: [specimen({ id: 's1', nickname: 'the Panther' })] });
    expect(row).toMatchObject({ specimenId: 's1', name: 'the Panther', quantity: 0, tanks: [] });
  });

  it('does not name a tank the fish has already left', () => {
    const [row] = rows({
      holdings: [holding({ id: 'h1' })],
      residencies: [residency({ id: 'r1', holdingId: 'h1', endDate: '2026-08-01' })],
    });
    expect(row!.tanks).toEqual([]);
  });

  it('lists specimens before unminted holdings, so opening one does not reorder the list', () => {
    const listed = rows({
      specimens: [specimen({ id: 's1', nickname: 'pineapple' })],
      holdings: [
        holding({ id: 'h_late', rawLabel: 'second severum' }),
        holding({ id: 'h_kept', specimenId: 's1' }),
      ],
    });
    expect(listed.map((r) => r.key)).toEqual(['s1', 'h_late']);
  });
});

/**
 * The same rows answer "which fish is this a photo OF?". Before spec 019 the
 * picker appeared only when no specimen existed and several holdings did, so
 * minting one by opening a row switched it off and the next photo went to the
 * newest specimen with nothing said.
 */
describe('keptFishRows as photo targets', () => {
  it('is unambiguous with a single candidate', () => {
    expect(rows({ holdings: [holding({ id: 'h1' })] })).toHaveLength(1);
  });

  it('is ambiguous with one minted specimen and one holding still unminted', () => {
    const listed = rows({
      specimens: [specimen({ id: 's1' })],
      holdings: [holding({ id: 'h1', specimenId: 's1' }), holding({ id: 'h2' })],
    });
    expect(listed).toHaveLength(2);
    expect(listed.map((r) => r.specimenId ?? r.holdingId)).toEqual(['s1', 'h2']);
  });
});

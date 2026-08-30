import { describe, expect, it } from 'vitest';
import { planDedupe } from './dedupe';
import type { Holding, LifeEvent, Residency } from './types';

const T1 = '2026-08-27T15:57:46.187Z';
const T2 = '2026-08-29T04:00:10.490Z';
const T3 = '2026-08-29T07:29:56.099Z';

function holding(id: string, over: Partial<Holding> = {}): Holding {
  return {
    id,
    speciesId: 'sp_guppy',
    rawLabel: 'Fancy guppy',
    kind: 'group',
    openingQuantity: 6,
    openingBalance: true,
    createdAt: T1,
    ...over,
  };
}

function residency(holdingId: string, aquariumId = 'tank_a', over: Partial<Residency> = {}): Residency {
  return { id: `res_${holdingId}`, holdingId, aquariumId, startDate: '2026-01-01', ...over };
}

function event(holdingId: string): LifeEvent {
  return {
    id: `evt_${holdingId}`, holdingId, type: 'deceased',
    occurredOn: '2026-08-01', quantityDelta: -1, createdAt: T1,
  };
}

describe('planDedupe', () => {
  it('leaves a collection with no duplicates completely alone', () => {
    const holdings = [holding('h1'), holding('h2', { speciesId: 'sp_wolf_fish' })];
    const plan = planDedupe(holdings, [residency('h1'), residency('h2')], []);

    expect(plan.remove).toEqual([]);
    expect(plan.keep).toHaveLength(2);
  });

  it('collapses the same fish in the same tank down to one row', () => {
    const holdings = [
      holding('h1', { createdAt: T1 }),
      holding('h2', { createdAt: T2 }),
      holding('h3', { createdAt: T3 }),
    ];
    const plan = planDedupe(
      holdings,
      [residency('h1'), residency('h2'), residency('h3')],
      [],
    );

    expect(plan.keep.map((h) => h.id)).toEqual(['h1']);
    expect(plan.remove.map((h) => h.id)).toEqual(['h2', 'h3']);
  });

  it('keeps the same fish in two different tanks, because that is not a duplicate', () => {
    const holdings = [holding('h1'), holding('h2')];
    const plan = planDedupe(
      holdings,
      [residency('h1', 'tank_a'), residency('h2', 'tank_b')],
      [],
    );

    expect(plan.remove).toEqual([]);
  });

  it('never drops the copy carrying a catch link, even when it is not the oldest', () => {
    const holdings = [
      holding('h1', { createdAt: T1 }),
      holding('h2', { createdAt: T2 }),
      holding('h3', { createdAt: T3, specimenId: 'spec_1' }),
    ];
    const plan = planDedupe(
      holdings,
      [residency('h1'), residency('h2'), residency('h3')],
      [],
    );

    expect(plan.keep.map((h) => h.id)).toEqual(['h3']);
  });

  it('never drops the copy carrying life events', () => {
    const holdings = [holding('h1', { createdAt: T1 }), holding('h2', { createdAt: T2 })];
    const plan = planDedupe(holdings, [residency('h1'), residency('h2')], [event('h2')]);

    expect(plan.keep.map((h) => h.id)).toEqual(['h2']);
  });

  it('never drops the copy carrying a note', () => {
    const holdings = [
      holding('h1', { createdAt: T1 }),
      holding('h2', { createdAt: T2, notes: 'jumped the lid once' }),
    ];
    const plan = planDedupe(holdings, [residency('h1'), residency('h2')], []);

    expect(plan.keep.map((h) => h.id)).toEqual(['h2']);
  });

  it('prefers a catch link over a note when different copies carry each', () => {
    const holdings = [
      holding('h1', { createdAt: T1, notes: 'from the swap meet' }),
      holding('h2', { createdAt: T2, specimenId: 'spec_1' }),
    ];
    const plan = planDedupe(holdings, [residency('h1'), residency('h2')], []);

    expect(plan.keep.map((h) => h.id)).toEqual(['h2']);
    expect(plan.notesAtRisk.map((h) => h.id)).toEqual(['h1']);
  });

  it('reports nothing at risk when the dropped note is a copy of the survivor\'s', () => {
    const holdings = [
      holding('h1', { createdAt: T1, notes: 'same note', specimenId: 'spec_1' }),
      holding('h2', { createdAt: T2, notes: 'same note' }),
    ];
    const plan = planDedupe(holdings, [residency('h1'), residency('h2')], []);

    expect(plan.keep.map((h) => h.id)).toEqual(['h1']);
    expect(plan.notesAtRisk).toEqual([]);
  });

  it('will not touch a holding the keeper created by hand', () => {
    const holdings = [
      holding('h1', { createdAt: T1 }),
      holding('h2', { createdAt: T2, openingBalance: false }),
    ];
    const plan = planDedupe(holdings, [residency('h1'), residency('h2')], []);

    expect(plan.remove).toEqual([]);
    expect(plan.keep.map((h) => h.id).sort()).toEqual(['h1', 'h2']);
  });

  it('will not touch a holding that lives in no tank, because its group is unknowable', () => {
    const holdings = [holding('h1'), holding('h2')];
    const plan = planDedupe(holdings, [residency('h1')], []);

    expect(plan.remove).toEqual([]);
    expect(plan.skippedWithoutTank.map((h) => h.id)).toEqual(['h2']);
  });

  it('treats a closed residency as no tank rather than guessing', () => {
    const holdings = [holding('h1'), holding('h2')];
    const plan = planDedupe(
      holdings,
      [residency('h1'), residency('h2', 'tank_a', { endDate: '2026-08-01' })],
      [],
    );

    expect(plan.remove).toEqual([]);
    expect(plan.skippedWithoutTank.map((h) => h.id)).toEqual(['h2']);
  });

  it('distinguishes two unlisted fish by their verbatim label', () => {
    const holdings = [
      holding('h1', { speciesId: undefined, rawLabel: 'Striped cory' }),
      holding('h2', { speciesId: undefined, rawLabel: 'Spotted cory' }),
    ];
    const plan = planDedupe(holdings, [residency('h1'), residency('h2')], []);

    expect(plan.remove).toEqual([]);
  });

  it('is deterministic when copies are identical in every way that matters', () => {
    const holdings = [holding('h_b'), holding('h_a')];
    const first = planDedupe(holdings, [residency('h_b'), residency('h_a')], []);
    const second = planDedupe([...holdings].reverse(), [residency('h_a'), residency('h_b')], []);

    expect(first.keep.map((h) => h.id)).toEqual(second.keep.map((h) => h.id));
    expect(first.keep.map((h) => h.id)).toEqual(['h_a']);
  });

  it('counts what it plans to do, so a caller can say so before doing it', () => {
    const holdings = [holding('h1'), holding('h2'), holding('h3')];
    const plan = planDedupe(
      holdings,
      [residency('h1'), residency('h2'), residency('h3')],
      [],
    );

    expect(plan.before).toBe(3);
    expect(plan.after).toBe(1);
    expect(plan.remove).toHaveLength(2);
  });
});

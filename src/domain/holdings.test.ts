import { describe, expect, it } from 'vitest';
import {
  currentResidency,
  deriveBadge,
  deriveQuantity,
  homeTankmates,
  planMove,
  timeline,
} from './holdings';
import type { Holding, LifeEvent, Residency } from './types';

const NOW = '2026-08-27T12:00:00.000Z';

function holding(over: Partial<Holding> = {}): Holding {
  return {
    id: 'h1', kind: 'group', openingQuantity: 6, openingBalance: true,
    createdAt: NOW, ...over,
  };
}

function event(over: Partial<LifeEvent> & { id: string; type: LifeEvent['type'] }): LifeEvent {
  return {
    holdingId: 'h1', occurredOn: '2026-08-01', quantityDelta: 0, createdAt: NOW, ...over,
  };
}

function residency(over: Partial<Residency> & { id: string }): Residency {
  return { holdingId: 'h1', aquariumId: 'tank_75g', startDate: '2026-01-01', ...over };
}

describe('deriveQuantity (FR-T04)', () => {
  it('starts from the opening balance', () => {
    expect(deriveQuantity(holding(), [])).toBe(6);
  });

  it('applies dated deltas in either direction', () => {
    const events = [
      event({ id: 'e1', type: 'deceased', quantityDelta: -1 }),
      event({ id: 'e2', type: 'birth', quantityDelta: 3 }),
    ];
    expect(deriveQuantity(holding(), events)).toBe(8);
  });

  it('ignores events belonging to a different holding', () => {
    const events = [event({ id: 'e1', type: 'deceased', quantityDelta: -6, holdingId: 'other' })];
    expect(deriveQuantity(holding(), events)).toBe(6);
  });

  it('never renders a negative fish count', () => {
    const events = [event({ id: 'e1', type: 'quantity-adjusted', quantityDelta: -99 })];
    expect(deriveQuantity(holding(), events)).toBe(0);
  });

  it('keeps a surviving group open after a partial loss (edge case, section 9)', () => {
    const events = [event({ id: 'e1', type: 'deceased', quantityDelta: -2 })];
    expect(deriveQuantity(holding(), events)).toBe(4);
  });
});

describe('residency and moves (FR-T03)', () => {
  it('finds the open residency', () => {
    const rs = [
      residency({ id: 'r1', endDate: '2026-05-01' }),
      residency({ id: 'r2', aquariumId: 'tank_tote', startDate: '2026-05-01' }),
    ];
    expect(currentResidency('h1', rs)?.id).toBe('r2');
  });

  it('a move closes the prior interval and opens a new one', () => {
    const rs = [residency({ id: 'r1' })];
    const plan = planMove('h1', 'tank_predator', '2026-08-27', rs, 'r2');
    expect(plan.close).toEqual({ ...rs[0], endDate: '2026-08-27' });
    expect(plan.open).toEqual({
      id: 'r2', holdingId: 'h1', aquariumId: 'tank_predator', startDate: '2026-08-27',
    });
  });

  it('opens the first residency with nothing to close', () => {
    expect(planMove('h1', 'tank_75g', '2026-08-27', [], 'r1').close).toBeUndefined();
  });

  it('never overwrites history with a single tank field', () => {
    const rs = [residency({ id: 'r1' })];
    const plan = planMove('h1', 'tank_tote', '2026-08-27', rs, 'r2');
    // The original record is still readable with its original start date.
    expect(plan.close!.startDate).toBe('2026-01-01');
    expect(plan.close!.aquariumId).toBe('tank_75g');
  });
});

describe('badges (FR-T06)', () => {
  it('marks a stocked holding in an open tank as Current', () => {
    expect(deriveBadge(holding(), [], [residency({ id: 'r1' })])).toBe('current');
  });

  it('marks a holding that reached zero as Past kept, without deleting records', () => {
    const events = [event({ id: 'e1', type: 'deceased', quantityDelta: -6 })];
    const rs = [residency({ id: 'r1', endDate: '2026-08-01' })];
    expect(deriveBadge(holding(), events, rs)).toBe('past-kept');
  });

  it('marks a rehomed but still-living holding as Past kept', () => {
    const events = [event({ id: 'e1', type: 'rehomed', quantityDelta: -6 })];
    const rs = [residency({ id: 'r1', endDate: '2026-08-01' })];
    expect(deriveBadge(holding(), events, rs)).toBe('past-kept');
  });

  it('gives no badge to a holding that was never actually kept', () => {
    expect(deriveBadge(holding(), [], [])).toBeUndefined();
  });
});

describe('home tankmates (FR-T08)', () => {
  it('finds holdings whose residency overlapped in the same tank', () => {
    const rs = [
      residency({ id: 'r1', holdingId: 'h1', startDate: '2026-01-01' }),
      residency({ id: 'r2', holdingId: 'h2', startDate: '2026-02-01' }),
    ];
    expect(homeTankmates('h1', rs)).toEqual([{ holdingId: 'h2', aquariumId: 'tank_75g' }]);
  });

  it('excludes a holding that left before this one arrived', () => {
    const rs = [
      residency({ id: 'r1', holdingId: 'h1', startDate: '2026-06-01' }),
      residency({ id: 'r2', holdingId: 'h2', startDate: '2026-01-01', endDate: '2026-03-01' }),
    ];
    expect(homeTankmates('h1', rs)).toEqual([]);
  });

  it('excludes a holding in a different tank over the same period', () => {
    const rs = [
      residency({ id: 'r1', holdingId: 'h1' }),
      residency({ id: 'r2', holdingId: 'h2', aquariumId: 'tank_tote' }),
    ];
    expect(homeTankmates('h1', rs)).toEqual([]);
  });

  it('does not list a holding twice when it shared a tank across two stays', () => {
    const rs = [
      residency({ id: 'r1', holdingId: 'h1', startDate: '2026-01-01' }),
      residency({ id: 'r2', holdingId: 'h2', startDate: '2026-01-01', endDate: '2026-03-01' }),
      residency({ id: 'r3', holdingId: 'h2', startDate: '2026-05-01' }),
    ];
    expect(homeTankmates('h1', rs)).toHaveLength(1);
  });
});

describe('timeline', () => {
  it('orders a holding history oldest first', () => {
    const events = [
      event({ id: 'e2', type: 'moved', occurredOn: '2026-05-01' }),
      event({ id: 'e1', type: 'acquired', occurredOn: '2026-01-01' }),
      event({ id: 'e3', type: 'deceased', occurredOn: '2026-08-01' }),
    ];
    expect(timeline('h1', events).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });
});

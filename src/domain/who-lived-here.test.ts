import { describe, expect, it } from 'vitest';
import { whoLivedHere } from './who-lived-here';
import type { Aquarium, Holding, Memorial, Residency, Specimen } from './types';

/**
 * Spec 048. The rules a tank's "Who lived here" section is allowed to claim.
 *
 * The one that matters most is `diedHere`: a fish that left this tank and died
 * somewhere else later must never be filed as having died here. That would
 * attribute a death to a tank the fish had already left - a plausible-looking
 * claim nobody made, which is precisely what P6 forbids.
 */

const TANKS: Aquarium[] = [
  { id: 'aq_75', name: 'Peaceful Garden', kind: 'display', status: 'active', createdAt: '2024-01-01T00:00:00.000Z' },
  { id: 'aq_q', name: 'Quarantine', kind: 'display', status: 'active', createdAt: '2024-01-01T00:00:00.000Z' },
  { id: 'aq_40', name: 'The 40', kind: 'display', status: 'active', createdAt: '2024-01-01T00:00:00.000Z' },
];

function holding(id: string, over: Partial<Holding> = {}): Holding {
  return {
    id, kind: 'individual', openingQuantity: 1, openingBalance: true,
    rawLabel: 'Cardinal Tetra', createdAt: '2024-01-01T00:00:00.000Z', ...over,
  };
}

function residency(id: string, holdingId: string, aquariumId: string,
  startDate: string, endDate?: string): Residency {
  return { id, holdingId, aquariumId, startDate, endDate };
}

function memorial(id: string, holdingId: string, occurredOn: string): Memorial {
  return {
    id, holdingId, occurredOn, quantity: 1, suspectedContributors: [],
    causeConfidence: 'unknown', createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function run(over: {
  residencies?: Residency[]; holdings?: Holding[]; memorials?: Memorial[];
  specimens?: Specimen[];
} = {}) {
  return whoLivedHere({
    aquariumId: 'aq_75',
    residencies: over.residencies ?? [],
    holdings: over.holdings ?? [],
    memorials: over.memorials ?? [],
    specimens: over.specimens ?? [],
    aquariums: TANKS,
  });
}

describe('whoLivedHere (spec 048)', () => {
  it('A CURRENT RESIDENT NEVER APPEARS', () => {
    // The tank lists it above. Printing it here would say it has gone.
    const out = run({
      holdings: [holding('h1')],
      residencies: [residency('r1', 'h1', 'aq_75', '2024-03-01')],
    });

    expect(out).toEqual([]);
  });

  it('shows a fish that moved out, and names where it went', () => {
    const out = run({
      holdings: [holding('h1')],
      residencies: [
        residency('r1', 'h1', 'aq_75', '2024-03-01', '2025-06-01'),
        residency('r2', 'h1', 'aq_40', '2025-06-01'),
      ],
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.movedTo).toEqual({ id: 'aq_40', name: 'The 40' });
    expect(out[0]!.diedHere).toBe(false);
    expect(out[0]!.memorial).toBeUndefined();
  });

  it('names the tank they went to FROM HERE, not the one they are in now', () => {
    // A fish that moved twice went to the second tank from here. Naming the
    // third would describe a journey nobody took.
    const out = run({
      holdings: [holding('h1')],
      residencies: [
        residency('r1', 'h1', 'aq_75', '2024-03-01', '2025-06-01'),
        residency('r2', 'h1', 'aq_q', '2025-06-01', '2025-07-01'),
        residency('r3', 'h1', 'aq_40', '2025-07-01'),
      ],
    });

    expect(out[0]!.movedTo!.name).toBe('Quarantine');
  });

  it('marks a fish that DIED HERE, and carries the memorial', () => {
    // recordDeath closes the residency ON the death date, so the ordinary case
    // lands exactly on the boundary - which is why `within` is inclusive.
    const out = run({
      holdings: [holding('h1')],
      residencies: [residency('r1', 'h1', 'aq_75', '2024-03-01', '2026-02-20')],
      memorials: [memorial('m1', 'h1', '2026-02-20')],
    });

    expect(out[0]!.diedHere).toBe(true);
    expect(out[0]!.memorial!.id).toBe('m1');
  });

  it('DOES NOT CLAIM A DEATH THAT HAPPENED SOMEWHERE ELSE LATER', () => {
    // The whole point. This fish lived here, left, and died in another tank a
    // year on. It belongs under "moved on", still linking to the memorial.
    const out = run({
      holdings: [holding('h1')],
      residencies: [
        residency('r1', 'h1', 'aq_75', '2024-03-01', '2025-06-01'),
        residency('r2', 'h1', 'aq_40', '2025-06-01', '2026-02-20'),
      ],
      memorials: [memorial('m1', 'h1', '2026-02-20')],
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.diedHere).toBe(false);
    // Still reachable - the keeper should be able to get to the memorial.
    expect(out[0]!.memorial!.id).toBe('m1');
    expect(out[0]!.movedTo!.name).toBe('The 40');
  });

  it('does not claim a death that happened BEFORE they arrived', () => {
    const out = run({
      holdings: [holding('h1')],
      residencies: [residency('r1', 'h1', 'aq_75', '2026-03-01', '2026-04-01')],
      memorials: [memorial('m1', 'h1', '2026-01-05')],
    });

    expect(out[0]!.diedHere).toBe(false);
  });

  it('KEEPS A STILL-RESIDENT GROUP THAT LOST SOME', () => {
    // Six severums, two died, four still here. The residency is open because
    // the last animal has not gone - keying on "the residency ended" alone
    // would lose the two that did.
    const out = run({
      holdings: [holding('h1', { kind: 'group', openingQuantity: 6 })],
      residencies: [residency('r1', 'h1', 'aq_75', '2024-03-01')],
      memorials: [memorial('m1', 'h1', '2026-02-20')],
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.diedHere).toBe(true);
    expect(out[0]!.to).toBeUndefined();
    // So the row can say "some of them are still here" rather than "still
    // here", which beside "Remembered" would read as a contradiction.
    expect(out[0]!.isGroup).toBe(true);
  });

  it('gives a holding that lived here twice one entry per stay', () => {
    const out = run({
      holdings: [holding('h1')],
      residencies: [
        residency('r1', 'h1', 'aq_75', '2024-03-01', '2024-06-01'),
        residency('r2', 'h1', 'aq_q', '2024-06-01', '2024-09-01'),
        residency('r3', 'h1', 'aq_75', '2024-09-01', '2025-01-01'),
      ],
    });

    expect(out.map((r) => r.id)).toEqual(['r3', 'r1']);
  });

  it('ignores other tanks entirely', () => {
    const out = run({
      holdings: [holding('h1')],
      residencies: [residency('r1', 'h1', 'aq_40', '2024-03-01', '2025-01-01')],
    });

    expect(out).toEqual([]);
  });

  it('sorts most recently gone first', () => {
    const out = run({
      holdings: [holding('h1'), holding('h2'), holding('h3')],
      residencies: [
        residency('r1', 'h1', 'aq_75', '2024-01-01', '2024-05-01'),
        residency('r2', 'h2', 'aq_75', '2024-01-01', '2026-05-01'),
        residency('r3', 'h3', 'aq_75', '2024-01-01', '2025-05-01'),
      ],
    });

    expect(out.map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
  });

  it('prefers a nickname, then the label, and never renders an empty name', () => {
    const out = run({
      holdings: [holding('h1', { specimenId: 's1' }), holding('h2', { rawLabel: undefined })],
      residencies: [
        residency('r1', 'h1', 'aq_75', '2024-01-01', '2025-01-01'),
        residency('r2', 'h2', 'aq_75', '2024-01-01', '2025-01-01'),
      ],
      specimens: [{
        id: 's1', nickname: 'Comet', kind: 'individual', identityStatus: 'unknown',
        status: 'encountered', createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      } as Specimen],
    });

    expect(out.find((r) => r.id === 'r1')!.name).toBe('Comet');
    expect(out.find((r) => r.id === 'r2')!.name).toBe('A fish');
  });

  it('survives a holding whose tank record is gone', () => {
    // A deleted tank leaves residencies behind (spec 013 keeps them).
    const out = run({
      holdings: [holding('h1')],
      residencies: [
        residency('r1', 'h1', 'aq_75', '2024-03-01', '2025-06-01'),
        residency('r2', 'h1', 'aq_gone', '2025-06-01'),
      ],
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.movedTo).toBeUndefined();
  });
});

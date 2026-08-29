import { describe, expect, it } from 'vitest';
import { forDisplay, summariseTank, type TankResident } from './tank-stats';

const r = (over: Partial<TankResident> & { commonName: string; quantity: number }): TankResident => ({
  holding: { id: 'h', createdAt: '', openingBalance: false, openingQuantity: 0 } as never,
  speciesId: `sp_${over.commonName.toLowerCase()}`,
  ...over,
});

describe('summariseTank', () => {
  it('counts fish by quantity, not by row', () => {
    const s = summariseTank([r({ commonName: 'Cory', quantity: 6 }), r({ commonName: 'Oscar', quantity: 1 })]);
    expect(s.fish).toBe(7);
    expect(s.species).toBe(2);
  });

  it('reports the part of the tank it cannot speak for', () => {
    // Twelve of the sixty-one seeded holdings never resolved to a species. A
    // dashboard that quietly averaged the other 80% and called it "the tank"
    // would be the most confident kind of lie.
    const s = summariseTank([
      r({ commonName: 'Cory', quantity: 4 }),
      r({ commonName: 'Severum (unspecified)', quantity: 3, speciesId: undefined }),
    ]);
    expect(s.fish).toBe(7);
    expect(s.species).toBe(1);
    expect(s.unidentifiedFish).toBe(3);
  });

  it('values only the fish it can price, and says how many that is', () => {
    const s = summariseTank([
      r({ commonName: 'Cory', quantity: 4, unitPrice: 5.5 }),
      r({ commonName: 'Oscar', quantity: 1, unitPrice: 20 }),
      r({ commonName: 'Mystery', quantity: 2 }),
    ]);
    expect(s.estimatedValue).toBe(42);
    expect(s.valuedFish).toBe(5);
    expect(s.unvaluedFish).toBe(2);
  });

  it('has no estimate at all when nothing can be priced', () => {
    // Not zero. Zero is a claim that the tank is worthless.
    const s = summariseTank([r({ commonName: 'Mystery', quantity: 2 })]);
    expect(s.estimatedValue).toBeUndefined();
    expect(s.valuedFish).toBe(0);
  });

  it('keeps the water column in top-to-bottom order, with the unknown slice last', () => {
    const s = summariseTank([
      r({ commonName: 'Pleco', quantity: 1, waterZone: 'bottom' }),
      r({ commonName: 'Hatchet', quantity: 3, waterZone: 'top' }),
      r({ commonName: 'Tetra', quantity: 6, waterZone: 'mid' }),
      r({ commonName: 'Mystery', quantity: 2 }),
    ]);
    expect(s.byZone.map((z) => z.key)).toEqual(['top', 'mid', 'bottom', 'unknown']);
    expect(s.byZone.map((z) => z.fish)).toEqual([3, 6, 1, 2]);
    expect(s.zonedFish).toBe(10);
  });

  it('omits a zone nobody occupies rather than drawing an empty band', () => {
    const s = summariseTank([r({ commonName: 'Tetra', quantity: 6, waterZone: 'mid' })]);
    expect(s.byZone.map((z) => z.key)).toEqual(['mid']);
  });

  it('shares add up to 100 across the slices', () => {
    const s = summariseTank([
      r({ commonName: 'A', quantity: 1, aggression: 'peaceful' }),
      r({ commonName: 'B', quantity: 3, aggression: 'aggressive' }),
    ]);
    expect(s.byAggression.reduce((n, x) => n + x.share, 0)).toBeCloseTo(100, 5);
  });

  it('orders temperament from peaceful to highly aggressive', () => {
    const s = summariseTank([
      r({ commonName: 'A', quantity: 1, aggression: 'highly-aggressive' }),
      r({ commonName: 'B', quantity: 1, aggression: 'peaceful' }),
      r({ commonName: 'C', quantity: 1, aggression: 'semi-aggressive' }),
    ]);
    expect(s.byAggression.map((a) => a.key)).toEqual(['peaceful', 'semi-aggressive', 'highly-aggressive']);
  });

  it('names the biggest fish and the most demanding one separately', () => {
    // They are usually but not always the same animal, and a guest asking
    // "which one needs the most room?" is asking the second question.
    const s = summariseTank([
      r({ commonName: 'Jaguar Cichlid', quantity: 1, adultSizeIn: 14, minVolumeGal: 125 }),
      r({ commonName: 'Wolf Fish', quantity: 1, adultSizeIn: 12, minVolumeGal: 180 }),
    ]);
    expect(s.largest).toEqual({ name: 'Jaguar Cichlid', adultSizeIn: 14 });
    expect(s.mostDemanding).toEqual({ name: 'Wolf Fish', minVolumeGal: 180 });
  });

  it('an empty tank is empty, not broken', () => {
    const s = summariseTank([]);
    expect(s).toMatchObject({ fish: 0, species: 0, byZone: [], byAggression: [] });
    expect(s.estimatedValue).toBeUndefined();
  });
});

describe('forDisplay', () => {
  it('leads with the biggest and sends the unidentified to the end', () => {
    const out = forDisplay([
      r({ commonName: 'Mystery', quantity: 1, speciesId: undefined }),
      r({ commonName: 'Tetra', quantity: 6, adultSizeIn: 1.5 }),
      r({ commonName: 'Oscar', quantity: 1, adultSizeIn: 12 }),
    ]);
    expect(out.map((x) => x.commonName)).toEqual(['Oscar', 'Tetra', 'Mystery']);
  });
});

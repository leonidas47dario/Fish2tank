import { describe, expect, it } from 'vitest';
import {
  computeDiscoveryTier,
  DEFAULT_TIER_CONFIG,
  LOCAL_RARITY_UNAVAILABLE,
  scarcityPoints,
  tierForScore,
  type DiscoveryTierInput,
} from './discovery-tier';

const ENCOUNTER = '2026-08-27T15:00:00.000Z';
const BEFORE = '2026-01-01T00:00:00.000Z';
const AFTER = '2026-09-01T00:00:00.000Z';

function input(over: Partial<DiscoveryTierInput> = {}): DiscoveryTierInput {
  return {
    specimenId: 'spec_1',
    speciesId: 'sp_1',
    isFirstConfirmedSpecies: false,
    encounterAt: ENCOUNTER,
    priorConfirmedCatches: 0,
    priorCatchesOfSpecies: 0,
    isExceptionalSpecimen: false,
    ...over,
  };
}

const reveal = (over: Partial<DiscoveryTierInput> = {}) =>
  computeDiscoveryTier(input(over), DEFAULT_TIER_CONFIG, {
    snapshotId: 'rar_test',
    revealedAt: ENCOUNTER,
  });

describe('components (PRD 5.3)', () => {
  it('awards 45 for a first confirmed species', () => {
    expect(reveal({ isFirstConfirmedSpecies: true }).components.firstConfirmedSpecies).toBe(45);
  });

  it('awards nothing for a species already in the collection', () => {
    expect(reveal({ isFirstConfirmedSpecies: false }).components.firstConfirmedSpecies).toBe(0);
  });

  it('awards 30 when the species was on the Dream List before the encounter', () => {
    expect(reveal({ dreamListAddedAt: BEFORE }).components.dreamListHit).toBe(30);
  });

  it('awards nothing when the Dream List entry came after the encounter (FR-R08)', () => {
    expect(reveal({ dreamListAddedAt: AFTER }).components.dreamListHit).toBe(0);
  });

  it('awards nothing when the species was never on the Dream List', () => {
    expect(reveal().components.dreamListHit).toBe(0);
  });

  it('awards 10 for a user-marked exceptional specimen', () => {
    expect(reveal({ isExceptionalSpecimen: true }).components.exceptionalSpecimen).toBe(10);
  });
});

describe('personal encounter scarcity', () => {
  const cfg = DEFAULT_TIER_CONFIG;

  it('scores zero on a cold-start collection with no history', () => {
    expect(scarcityPoints(0, 0, cfg)).toBe(0);
  });

  it('scores full marks for a never-seen species in a well-established history', () => {
    expect(scarcityPoints(40, 0, cfg)).toBe(15);
  });

  it('scales down when there is too little history to judge scarcity', () => {
    // 5 prior catches is a quarter of the sample floor.
    expect(scarcityPoints(5, 0, cfg)).toBe(4);
  });

  it('drops as the species becomes a routine sighting', () => {
    expect(scarcityPoints(40, 20, cfg)).toBe(8);
    expect(scarcityPoints(40, 40, cfg)).toBe(0);
  });

  it('is monotonic: more sightings of a species never raise its scarcity', () => {
    let previous = Infinity;
    for (let seen = 0; seen <= 30; seen += 1) {
      const points = scarcityPoints(30, seen, cfg);
      expect(points).toBeLessThanOrEqual(previous);
      previous = points;
    }
  });

  it('never exceeds the configured maximum', () => {
    expect(scarcityPoints(1000, 0, cfg)).toBe(cfg.points.personalEncounterScarcityMax);
  });
});

describe('tier bands (PRD 5.3)', () => {
  const cases: Array<[number, string]> = [
    [0, 'familiar'], [19, 'familiar'],
    [20, 'uncommon'], [39, 'uncommon'],
    [40, 'rare'], [59, 'rare'],
    [60, 'epic'], [79, 'epic'],
    [80, 'legendary'], [100, 'legendary'],
  ];
  it.each(cases)('maps score %i to %s', (score, tier) => {
    expect(tierForScore(score, DEFAULT_TIER_CONFIG)).toBe(tier);
  });
});

describe('total score', () => {
  it('sums the four components', () => {
    const r = reveal({
      isFirstConfirmedSpecies: true,
      dreamListAddedAt: BEFORE,
      priorConfirmedCatches: 40,
      priorCatchesOfSpecies: 0,
      isExceptionalSpecimen: true,
    });
    expect(r.components).toEqual({
      firstConfirmedSpecies: 45,
      dreamListHit: 30,
      personalEncounterScarcity: 15,
      exceptionalSpecimen: 10,
    });
    expect(r.totalScore).toBe(100);
    expect(r.tier).toBe('legendary');
  });

  it('clamps to the 0-100 range even if weights are retuned upward', () => {
    const generous = {
      ...DEFAULT_TIER_CONFIG,
      points: { firstConfirmedSpecies: 90, dreamListHit: 90, personalEncounterScarcityMax: 90, exceptionalSpecimen: 90 },
    };
    const r = computeDiscoveryTier(
      input({ isFirstConfirmedSpecies: true, dreamListAddedAt: BEFORE, isExceptionalSpecimen: true }),
      generous,
      { snapshotId: 'r', revealedAt: ENCOUNTER },
    );
    expect(r.totalScore).toBe(100);
  });

  it('gives a plain repeat sighting a Familiar tier', () => {
    const r = reveal({ priorConfirmedCatches: 30, priorCatchesOfSpecies: 25 });
    expect(r.totalScore).toBeLessThan(20);
    expect(r.tier).toBe('familiar');
  });
});

describe('snapshot integrity (FR-R05, 5.3)', () => {
  it('stamps the formula version so retuning cannot rewrite history', () => {
    expect(reveal().formulaVersion).toBe(DEFAULT_TIER_CONFIG.formulaVersion);
  });

  it('stores the component breakdown, not just the total', () => {
    const r = reveal({ isFirstConfirmedSpecies: true });
    expect(Object.keys(r.components).sort()).toEqual([
      'dreamListHit', 'exceptionalSpecimen', 'firstConfirmedSpecies', 'personalEncounterScarcity',
    ]);
  });

  it('retuning weights produces a different NEW snapshot and leaves the old one untouched', () => {
    const original = reveal({ isFirstConfirmedSpecies: true });
    const retuned = computeDiscoveryTier(
      input({ isFirstConfirmedSpecies: true }),
      { ...DEFAULT_TIER_CONFIG, formulaVersion: 'discovery-tier-v0.2.0', points: { ...DEFAULT_TIER_CONFIG.points, firstConfirmedSpecies: 10 } },
      { snapshotId: 'rar_test_2', revealedAt: ENCOUNTER },
    );
    expect(original.totalScore).toBe(45);
    expect(retuned.totalScore).toBe(10);
    expect(retuned.formulaVersion).not.toBe(original.formulaVersion);
  });

  it('treats Golden as an overlay that does not move the score (FR-R06)', () => {
    const plain = reveal({ isFirstConfirmedSpecies: true });
    const golden = reveal({ isFirstConfirmedSpecies: true, golden: true });
    expect(golden.totalScore).toBe(plain.totalScore);
    expect(golden.tier).toBe(plain.tier);
    expect(golden.golden).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    expect(reveal({ isFirstConfirmedSpecies: true })).toEqual(reveal({ isFirstConfirmedSpecies: true }));
  });
});

describe('local rarity (FR-R07)', () => {
  it('refuses to claim objective local rarity in the MVP', () => {
    expect(LOCAL_RARITY_UNAVAILABLE.available).toBe(false);
    expect(LOCAL_RARITY_UNAVAILABLE.message).toBe('Local rarity unavailable');
    expect(LOCAL_RARITY_UNAVAILABLE.explanation).toMatch(/minimum sample/i);
  });

  it('keeps local rarity out of the score entirely', () => {
    const r = reveal({ isFirstConfirmedSpecies: true });
    expect(Object.keys(r.components)).not.toContain('localRarity');
  });
});

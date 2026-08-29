import { describe, expect, it } from 'vitest';
import {
  computeDiscoveryTier,
  DEFAULT_TIER_CONFIG,
  COMPONENT_LABELS,
  LOCAL_RARITY_UNAVAILABLE,
  tierForScore,
  type DiscoveryTierInput,
} from './discovery-tier';
import type { RaritySnapshot } from '@/domain/types';

const REVEALED = '2026-08-27T15:00:00.000Z';

function input(over: Partial<DiscoveryTierInput> = {}): DiscoveryTierInput {
  return { specimenId: 'spec_1', speciesId: 'sp_1', marketScarcityScore: 0, ...over };
}

const reveal = (over: Partial<DiscoveryTierInput> = {}) =>
  computeDiscoveryTier(input(over), DEFAULT_TIER_CONFIG, {
    snapshotId: 'rar_test',
    revealedAt: REVEALED,
  });

describe('the score is the market scarcity score (v0.3.0)', () => {
  it.each([0, 21, 37, 64, 100])('passes %i through unchanged', (score) => {
    expect(reveal({ marketScarcityScore: score }).totalScore).toBe(score);
  });

  it('clamps a score above the range rather than trusting it', () => {
    expect(reveal({ marketScarcityScore: 140 }).totalScore).toBe(100);
  });

  it('clamps a negative score to zero', () => {
    expect(reveal({ marketScarcityScore: -20 }).totalScore).toBe(0);
  });

  /**
   * The whole point of v0.3.0. Personal history used to carry 85 of the 100
   * points, so these inputs moved the score; now nothing but the market does.
   */
  it('ignores personal history entirely', () => {
    const snap = reveal({ marketScarcityScore: 30 });
    expect(snap.totalScore).toBe(30);
    expect(snap.components).toEqual({ marketScarcity: 30 });
  });
});

describe('retired components (v0.2.0 -> v0.3.0)', () => {
  it('emits only marketScarcity on a new snapshot', () => {
    expect(Object.keys(reveal({ marketScarcityScore: 55 }).components)).toEqual(['marketScarcity']);
  });

  it.each([
    'firstConfirmedSpecies',
    'dreamListHit',
    'personalEncounterScarcity',
    'exceptionalSpecimen',
  ])('keeps a label for retired component %s, so old snapshots still render', (key) => {
    expect(COMPONENT_LABELS[key as keyof typeof COMPONENT_LABELS]).toBeTruthy();
  });

  /**
   * FR-R05 and PRD 5.3: "tuning never rewrites a historical reveal snapshot."
   * A stored v0.2.0 snapshot carries five components and must keep rendering
   * all five - which is why the retired keys became optional rather than gone.
   */
  it('a stored v0.2.0 snapshot still exposes its full breakdown', () => {
    const stored: RaritySnapshot = {
      id: 'rar_old',
      specimenId: 'spec_old',
      speciesId: 'sp_1',
      components: {
        firstConfirmedSpecies: 35,
        dreamListHit: 0,
        personalEncounterScarcity: 2,
        exceptionalSpecimen: 0,
        marketScarcity: 0,
      },
      totalScore: 37,
      tier: 'uncommon',
      formulaVersion: 'discovery-tier-v0.2.0',
      golden: false,
      revealedAt: REVEALED,
    };
    const rendered = Object.keys(stored.components).map(
      (k) => COMPONENT_LABELS[k as keyof typeof COMPONENT_LABELS],
    );
    expect(rendered).toHaveLength(5);
    expect(rendered.every(Boolean)).toBe(true);
    expect(stored.totalScore).toBe(37);
  });
});

describe('tier bands', () => {
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

  /**
   * The measured distribution, from the shipped index at three witness stores.
   * Breadth can only take N values for N witnesses, so the reachable scores
   * are 0, 21-29 and 55-64 - see market-scarcity.ts. Legendary needs 80 and is
   * therefore unreachable until a fourth store clears the witness gate. That
   * is a property of the sample, not a bug, and it is asserted so that a
   * future change to the bands has to confront it deliberately.
   */
  it.each([
    [0, 'familiar'], [21, 'uncommon'], [29, 'uncommon'],
    [55, 'rare'], [59, 'rare'], [60, 'epic'], [64, 'epic'],
  ])('a reachable market score of %i lands on %s', (score, tier) => {
    expect(reveal({ marketScarcityScore: score }).tier).toBe(tier);
  });

  it('no reachable score at three witnesses reaches legendary', () => {
    const reachable = [0, 21, 22, 23, 24, 25, 26, 27, 29, 55, 56, 57, 58, 59, 60, 61, 63, 64];
    expect(reachable.some((s) => reveal({ marketScarcityScore: s }).tier === 'legendary')).toBe(false);
  });
});

describe('snapshot integrity (FR-R05)', () => {
  it('stamps the new formula version', () => {
    expect(reveal().formulaVersion).toBe('discovery-tier-v0.3.0');
  });

  it('carries the golden overlay without letting it touch the score', () => {
    const plain = reveal({ marketScarcityScore: 64 });
    const gold = reveal({ marketScarcityScore: 64, golden: true });
    expect(gold.golden).toBe(true);
    expect(gold.totalScore).toBe(plain.totalScore);
    expect(gold.tier).toBe(plain.tier);
  });

  it('stores the breakdown, not just the total', () => {
    expect(reveal({ marketScarcityScore: 42 }).components.marketScarcity).toBe(42);
  });

  it('is a pure function of its inputs, so a snapshot is reproducible', () => {
    expect(reveal({ marketScarcityScore: 61 })).toEqual(reveal({ marketScarcityScore: 61 }));
  });
});

describe('FR-R07', () => {
  it('still refuses to claim local rarity', () => {
    expect(LOCAL_RARITY_UNAVAILABLE.available).toBe(false);
    expect(LOCAL_RARITY_UNAVAILABLE.message).toMatch(/local rarity unavailable/i);
  });
});

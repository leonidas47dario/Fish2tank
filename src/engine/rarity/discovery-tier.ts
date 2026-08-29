/**
 * Discovery Tier - PRD 5.3, rewritten in v0.3.0.
 *
 * PRD status note, still true: "This formula is a testable MVP hypothesis.
 * Weights live in configuration, the breakdown is shown to the user, and
 * tuning never rewrites a historical reveal snapshot."
 *
 * WHAT v0.3.0 IS. The tier is the market scarcity score and nothing else, at
 * the product owner's direction: "the rating score is solely relying on market
 * reference for the tagging." Personal history - first sighting, Dream List,
 * encounter scarcity, exceptional - no longer scores.
 *
 * HOW THIS FORMULA GOT HERE, because the direction has now reversed twice and
 * the next reader deserves the whole arc:
 *
 *   v0.1.0  Personal history only. Market data lived in a separate rating,
 *           because FR-P05 says "online availability never increases
 *           collecting rarity in the MVP".
 *   v0.2.0  Market folded in as one component of five, worth 15 of 100. The
 *           docstring recorded the cost: the score now mixed "how novel is
 *           this to me" with "how hard is this to mail-order", and those can
 *           disagree sharply.
 *   v0.3.0  That disagreement resolved by keeping only the second. The score
 *           is now a claim about shelves, not about the collector.
 *
 * FR-P05 is therefore superseded rather than honoured, and this is the third
 * spec to say so. See docs/specs/005-catch-journey-and-backfill.md.
 *
 * WHAT THIS FORMULA CANNOT DO, and must not pretend to. Absence of market
 * evidence is not a score of zero. 1,703 of 2,178 catalog species have no
 * shelf evidence at all, and a zero would read as "widely available" - the
 * opposite of what the silence means. So there is no "unrated" tier here and
 * no zero standing in for one: computeDiscoveryTier REQUIRES a real score, and
 * the decision not to rate is made before it is called. See revealSpecimen.
 *
 * FR-R07 still holds: no claim about LOCAL (Chicago) rarity is made anywhere,
 * because that needs a community dataset this product does not have.
 */
import type {
  DiscoveryTier,
  Id,
  Instant,
  RarityComponentBreakdown,
  RaritySnapshot,
} from '@/domain/types';

export interface DiscoveryTierConfig {
  formulaVersion: string;
  /** Lower bound of each tier, highest first. */
  tiers: Array<{ tier: DiscoveryTier; minScore: number }>;
}

export const DEFAULT_TIER_CONFIG: DiscoveryTierConfig = {
  formulaVersion: 'discovery-tier-v0.3.0',
  /**
   * Unchanged from v0.2.0, deliberately.
   *
   * At three witness stores the market score can only take the values 0, 21-29
   * and 55-64 (market-scarcity.ts explains why: N witnesses give exactly N
   * breadth values). So legendary is unreachable today, and epic holds 52% of
   * rated species. Both are properties of the sample, and both correct
   * themselves as stores clear the witness gate - at four witnesses the top
   * breadth value is 75, at five it is 80.
   *
   * Do not re-cut these bands to flatter the current distribution. That would
   * bake a temporary sample size into the meaning of the word "legendary".
   */
  tiers: [
    { tier: 'legendary', minScore: 80 },
    { tier: 'epic', minScore: 60 },
    { tier: 'rare', minScore: 40 },
    { tier: 'uncommon', minScore: 20 },
    { tier: 'familiar', minScore: 0 },
  ],
};

export interface DiscoveryTierInput {
  specimenId: Id;
  speciesId?: Id;
  /**
   * Market scarcity score, 0-100, from the market index.
   *
   * Required, and not optional as it was in v0.2.0. A species with no market
   * evidence does not get a snapshot at all, so there is no caller with
   * nothing to pass - and making it optional would invite exactly the zero
   * this formula must never award.
   */
  marketScarcityScore: number;
  /** Personal foil overlay. An overlay only - it does not change the score. */
  golden?: boolean;
}

export function tierForScore(score: number, cfg: DiscoveryTierConfig): DiscoveryTier {
  for (const band of cfg.tiers) {
    if (score >= band.minScore) return band.tier;
  }
  // Config always ends at minScore 0, but keep the fallback total.
  return 'familiar';
}

export function computeComponents(input: DiscoveryTierInput): RarityComponentBreakdown {
  return { marketScarcity: Math.max(0, Math.min(100, Math.round(input.marketScarcityScore))) };
}

/**
 * Produce the immutable reveal-day snapshot (FR-R05).
 *
 * The snapshot stores component values AND the formula version, so retuning
 * weights later leaves every historical reveal exactly as the user saw it.
 */
export function computeDiscoveryTier(
  input: DiscoveryTierInput,
  cfg: DiscoveryTierConfig = DEFAULT_TIER_CONFIG,
  options: { snapshotId?: Id; revealedAt?: Instant } = {},
): RaritySnapshot {
  const components = computeComponents(input);
  const total = components.marketScarcity ?? 0;
  const revealedAt = options.revealedAt ?? new Date().toISOString();

  return {
    id: options.snapshotId ?? `rarity_${input.specimenId}_${revealedAt}`,
    specimenId: input.specimenId,
    speciesId: input.speciesId,
    components,
    totalScore: total,
    tier: tierForScore(total, cfg),
    formulaVersion: cfg.formulaVersion,
    golden: input.golden ?? false,
    revealedAt,
  };
}

/**
 * Labels for the user-facing breakdown (FR-R05: the breakdown must be shown).
 *
 * The four retired components keep their labels on purpose. A v0.2.0 snapshot
 * stored on the device still carries all five, and the breakdown UI renders
 * whatever keys the snapshot has - so deleting these labels would blank out
 * every reveal the user has already seen.
 */
export const COMPONENT_LABELS: Record<keyof RarityComponentBreakdown, string> = {
  marketScarcity: 'Hard to source from the tracked vendors',
  // Retired in v0.3.0. Present for historical snapshots only.
  firstConfirmedSpecies: 'First time confirming this species',
  dreamListHit: 'Was on your Dream List',
  personalEncounterScarcity: 'Rare in your own catch history',
  exceptionalSpecimen: 'You marked this one exceptional',
};

/**
 * FR-R07: the MVP must not claim objective local rarity. This is the single
 * place that answer lives, so the UI cannot accidentally invent one.
 */
export const LOCAL_RARITY_UNAVAILABLE = {
  available: false as const,
  message: 'Local rarity unavailable',
  explanation:
    'Chicago-area rarity needs a community dataset above a documented minimum sample size, with privacy-safe store and time disclosures. Until then this score reflects the tracked vendors only.',
};

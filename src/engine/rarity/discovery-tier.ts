/**
 * Personal Discovery Tier v0 - PRD 5.3.
 *
 * PRD status note, preserved verbatim in spirit: "This formula is a testable
 * MVP hypothesis. Weights live in configuration, the breakdown is shown to the
 * user, and tuning never rewrites a historical reveal snapshot."
 *
 * The score is deliberately PERSONAL. It makes no claim about global or local
 * market rarity: FR-R07 forbids asserting Chicago rarity without a minimum
 * sample threshold, so no component here consults anything beyond the user's
 * own history and Dream List.
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
  points: {
    firstConfirmedSpecies: number;
    dreamListHit: number;
    /** Maximum awardable for personal encounter scarcity. */
    personalEncounterScarcityMax: number;
    exceptionalSpecimen: number;
  };
  /**
   * How many prior confirmed catches the user needs before the scarcity
   * component carries full weight. Below this the component is scaled down,
   * so a brand-new collection cannot manufacture rarity out of a thin history
   * (PRD 12: "Rarity cold start ... personal novelty/Dream List only in MVP").
   */
  scarcitySampleFloor: number;
  /** Lower bound of each tier, highest first. */
  tiers: Array<{ tier: DiscoveryTier; minScore: number }>;
}

export const DEFAULT_TIER_CONFIG: DiscoveryTierConfig = {
  formulaVersion: 'discovery-tier-v0.1.0',
  points: {
    firstConfirmedSpecies: 45,
    dreamListHit: 30,
    personalEncounterScarcityMax: 15,
    exceptionalSpecimen: 10,
  },
  scarcitySampleFloor: 20,
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
  /** True when this species has never been User Confirmed before (FR-R01). */
  isFirstConfirmedSpecies: boolean;
  /**
   * When the species was added to the Dream List, if ever. FR-R08 requires the
   * Dream List entry to PREDATE the encounter to count.
   */
  dreamListAddedAt?: Instant;
  encounterAt: Instant;
  /** Confirmed catches logged before this one, across all species. */
  priorConfirmedCatches: number;
  /** Confirmed catches of THIS species before this one. */
  priorCatchesOfSpecies: number;
  /** FR-R06 / 5.3: user-selected attribute for an unusually compelling fish. */
  isExceptionalSpecimen: boolean;
  /** Personal foil overlay. An overlay only - it does not change the score. */
  golden?: boolean;
}

/**
 * Personal encounter scarcity, 0..max.
 *
 * "Higher when the user has logged many catches but rarely/never this
 * species" (PRD 5.3). Two factors multiply:
 *   - confidence: how much history exists to judge scarcity at all
 *   - unfamiliarity: how little of that history is this species
 */
export function scarcityPoints(
  priorConfirmedCatches: number,
  priorCatchesOfSpecies: number,
  cfg: DiscoveryTierConfig,
): number {
  if (priorConfirmedCatches <= 0) return 0;
  const confidence = Math.min(1, priorConfirmedCatches / cfg.scarcitySampleFloor);
  const familiarity = Math.min(1, priorCatchesOfSpecies / priorConfirmedCatches);
  const raw = cfg.points.personalEncounterScarcityMax * confidence * (1 - familiarity);
  return Math.round(raw);
}

export function tierForScore(score: number, cfg: DiscoveryTierConfig): DiscoveryTier {
  for (const band of cfg.tiers) {
    if (score >= band.minScore) return band.tier;
  }
  // Config always ends at minScore 0, but keep the fallback total.
  return 'familiar';
}

export function computeComponents(
  input: DiscoveryTierInput,
  cfg: DiscoveryTierConfig = DEFAULT_TIER_CONFIG,
): RarityComponentBreakdown {
  const dreamListCounts =
    input.dreamListAddedAt !== undefined &&
    Date.parse(input.dreamListAddedAt) < Date.parse(input.encounterAt);

  return {
    firstConfirmedSpecies: input.isFirstConfirmedSpecies ? cfg.points.firstConfirmedSpecies : 0,
    dreamListHit: dreamListCounts ? cfg.points.dreamListHit : 0,
    personalEncounterScarcity: scarcityPoints(
      input.priorConfirmedCatches,
      input.priorCatchesOfSpecies,
      cfg,
    ),
    exceptionalSpecimen: input.isExceptionalSpecimen ? cfg.points.exceptionalSpecimen : 0,
  };
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
  const components = computeComponents(input, cfg);
  const total = Math.max(
    0,
    Math.min(
      100,
      components.firstConfirmedSpecies +
        components.dreamListHit +
        components.personalEncounterScarcity +
        components.exceptionalSpecimen,
    ),
  );
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

/** Labels for the user-facing breakdown (FR-R05: the breakdown must be shown). */
export const COMPONENT_LABELS: Record<keyof RarityComponentBreakdown, string> = {
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
    'Chicago-area rarity needs a community dataset above a documented minimum sample size, with privacy-safe store and time disclosures. Until then this score reflects your own history only.',
};

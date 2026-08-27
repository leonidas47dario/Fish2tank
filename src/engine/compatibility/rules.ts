/**
 * Versioned compatibility rule configuration - PRD 5.1.
 *
 * Every threshold lives here rather than inline in the engine so that FR-E06
 * holds: "Each rule can be independently tested and disabled by versioned
 * configuration." Changing any value requires a new `version` string, which is
 * stamped onto every assessment snapshot (FR-E04, NFR-09).
 *
 * PROVENANCE NOTE: the multipliers below are conventional freshwater-aquarist
 * heuristics, not values lifted from a cited authority. They are deliberately
 * conservative and deliberately configurable. Where the PRD requires sourced
 * data (species minimum volume, adult size, aggression) that data lives on the
 * SpeciesProfile with its own `sources` array - not here.
 */
import type { AggressionRating } from '@/domain/types';

export interface RuleToggle {
  enabled: boolean;
  /**
   * When true, missing inputs for this rule force the overall verdict to
   * "Not enough data" rather than allowing a green result (FR-E05).
   */
  blocksSufficiency: boolean;
}

export interface CompatibilityRuleConfig {
  version: string;
  minimumEnclosure: RuleToggle;
  adultSize: RuleToggle & {
    /** Tank length must be at least this multiple of adult body length. */
    minLengthMultiple: number;
    /** Tank width (front-to-back) must allow the fish to turn. */
    minWidthMultiple: number;
    /** Within this multiple of the floor, the fit is tight rather than failing. */
    conditionalLengthMultiple: number;
  };
  aggression: RuleToggle;
  predation: RuleToggle & {
    /**
     * Default largest prey:predator length ratio assumed when a profile does
     * not state its own. 0.4 means "can swallow anything up to 40% of its
     * own length" - a conservative figure for large predatory cichlids.
     */
    defaultPreySizeRatio: number;
    /**
     * Multiplier applied to the predator's own prey ratio to give a harassment
     * band above it. A species that swallows prey up to 40% of its length is
     * assumed to still chase and injure prey up to 40% x 1.5 = 60%.
     *
     * Expressed as a multiple rather than an absolute ratio so that a species
     * with a narrow, curated prey band (say 10%) gets a correspondingly narrow
     * harassment band, instead of having it swamped by a global constant.
     */
    cautionRatioMultiple: number;
  };
  waterOverlap: RuleToggle & {
    /** Degrees C of shared range below which the overlap is called marginal. */
    marginalOverlapC: number;
  };
  socialNeeds: RuleToggle & {
    /** A schooling species needs at least this many conspecifics. */
    minSchoolSize: number;
    /** A shoaling species is happier in groups but tolerates fewer. */
    minShoalSize: number;
  };
  crowding: RuleToggle;
  /**
   * PRD 5.2: "High risk - one serious conflict OR SEVERAL COMPOUNDING
   * WARNINGS". This is how many Conditional factors compound into High risk.
   */
  compoundingWarningThreshold: number;
}

export const AGGRESSION_LEVEL: Record<AggressionRating, number> = {
  peaceful: 0,
  'semi-aggressive': 1,
  aggressive: 2,
  'highly-aggressive': 3,
};

export const DEFAULT_RULES: CompatibilityRuleConfig = {
  version: 'compat-v0.1.0',
  minimumEnclosure: { enabled: true, blocksSufficiency: true },
  adultSize: {
    enabled: true,
    blocksSufficiency: true,
    minLengthMultiple: 4,
    minWidthMultiple: 1.5,
    conditionalLengthMultiple: 5,
  },
  aggression: { enabled: true, blocksSufficiency: true },
  predation: {
    enabled: true,
    blocksSufficiency: true,
    defaultPreySizeRatio: 0.4,
    cautionRatioMultiple: 1.5,
  },
  // PRD 5.1: water is "unassessed if data is absent" - the one factor whose
  // absence does not by itself block a green verdict.
  waterOverlap: { enabled: true, blocksSufficiency: false, marginalOverlapC: 2 },
  socialNeeds: { enabled: true, blocksSufficiency: true, minSchoolSize: 6, minShoalSize: 3 },
  crowding: { enabled: true, blocksSufficiency: false },
  compoundingWarningThreshold: 3,
};

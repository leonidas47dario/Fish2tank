/**
 * Local-shelf scarcity - would you see this fish in a normal shop?
 *
 * A second, separate rating alongside the Personal Discovery Tier, and
 * deliberately not folded into it:
 *
 *   - Discovery Tier (PRD 5.3) answers "how novel is this to ME" from Ryan's
 *     own catch history and Dream List.
 *   - This answers "how likely am I to find one on a shelf" from the stores
 *     that resemble a shelf.
 *
 * FR-P05 ("online availability never increases collecting rarity") is what
 * keeps them apart.
 *
 * WHAT CHANGED IN v1.0.0, AND WHY. The v0.1.0 formula summed four signals and
 * called Betta "uncommon", Fancy Guppy "scarce", and nothing at all widely
 * available - 89% of the catalogue sat in the bottom two bands. Three of the
 * four signals were measuring something other than scarcity:
 *
 *   - Stock pressure tracked Shopify leaving sold-out products published. 84%
 *     of the dataset is dead back catalogue and 180 of 299 species had zero in
 *     stock, so it handed 25 points to nearly everyone. DELETED.
 *   - Price level tracked a consequence of rarity rather than evidence of it,
 *     and let a big adult oscar read as rare for being expensive. DELETED.
 *     (This also retires the `!stats.price` refusal the previous version
 *     needed. A species the vendors never sized can now be rated on breadth,
 *     which is what the note there asked a version bump to do.)
 *   - Store breadth tracked which vendors write binomials in their titles
 *     rather than who stocks the fish, so 275 of 299 species came from
 *     Predatory Fins and 198 were sole-source there. REBUILT on community
 *     stores only.
 *
 * THE WITNESS GATE. A store's silence is evidence only if that store can
 * speak. A community store joins the denominator only once its resolve rate
 * clears `witnessMinResolveRate`; below that its absence is discarded rather
 * than counted against the fish. This is what makes absence usable at all,
 * and it is self-repairing - as ETL matching improves, stores rejoin and the
 * scale gains rungs.
 *
 * THE CEILING RISES WITH THE SAMPLE. A sole-witness species scores
 * 100 * (1 - 1/N). On two witnesses that is 50, so the app *cannot* call
 * anything rarely listed; on five it is 80 and sole-source lands in the top
 * band, which is the whole point of the rating. The formula has to earn its
 * strongest word. Do not "fix" thin coverage by lowering the threshold - the
 * ceiling test exists to make that trade visible rather than quiet.
 *
 * See docs/specs/004-local-shelf-scarcity.md.
 */
import type { MarketSpeciesStats } from '@/data/market';

export type MarketScarcityBand =
  | 'widely-available'
  | 'available'
  | 'uncommon'
  | 'scarce'
  | 'rarely-listed';

/** A community store, and how much of its own catalogue it resolves. */
export interface ScarcityWitness {
  storeId: string;
  /**
   * Published listings over livestock listings fetched. Derived in
   * data/market.ts from the index itself, never hardcoded.
   */
  resolveRate: number;
}

export interface MarketScarcityComponents {
  /** The rating. Fewer witnesses carrying it means harder to find. */
  storeBreadth: number;
  /** Always <= 0: a deep catalogue makes a fish more findable, never less. */
  listingDepth: number;
}

export interface MarketScarcityConfig {
  formulaVersion: string;
  /** A community store below this resolve rate is not a witness. */
  witnessMinResolveRate: number;
  /**
   * Fewest witnesses that can produce a rating at all.
   *
   * Two, because breadth is a comparison and one store cannot make one. With a
   * single witness, every species it carries scores 0 and every species it
   * does not is unrated - the badge would have exactly one value while
   * implying it had consulted a market.
   */
  minimumWitnesses: number;
  /** Largest discount a deep catalogue can earn. */
  depthNudgeMax: number;
  /** Multiplier on ln(1 + listings). */
  depthNudgeScale: number;
  bands: Array<{ band: MarketScarcityBand; minScore: number }>;
}

export const DEFAULT_SCARCITY_CONFIG: MarketScarcityConfig = {
  formulaVersion: 'market-scarcity-v1.0.0',
  witnessMinResolveRate: 0.1,
  minimumWitnesses: 2,
  depthNudgeMax: 12,
  depthNudgeScale: 4,
  bands: [
    // 75, not 80. The depth nudge subtracts up to 12, so at an 80 cut a
    // sole-source fish would never reach the top band even on six witnesses -
    // the nudge pushes it back into "scarce" - which would quietly defeat the
    // one thing this rating exists to say.
    { band: 'rarely-listed', minScore: 75 },
    { band: 'scarce', minScore: 60 },
    { band: 'uncommon', minScore: 40 },
    { band: 'available', minScore: 20 },
    { band: 'widely-available', minScore: 0 },
  ],
};

export interface MarketScarcityResult {
  available: true;
  score: number;
  band: MarketScarcityBand;
  components: MarketScarcityComponents;
  formulaVersion: string;
  /** What the rating rests on, so the UI can show its working. */
  basis: {
    witnessesCarrying: number;
    witnessesTracked: number;
    witnessListings: number;
    carriedBy: string[];
  };
}

export interface MarketScarcityUnavailable {
  available: false;
  reason: string;
  explanation: string;
}

export type MarketScarcity = MarketScarcityResult | MarketScarcityUnavailable;

export function bandForScore(score: number, cfg: MarketScarcityConfig): MarketScarcityBand {
  for (const b of cfg.bands) if (score >= b.minScore) return b.band;
  return 'widely-available';
}

/**
 * Rate a species against the community stores.
 *
 * `community` is every community-channel store in the index paired with its
 * resolve rate; this function applies the gate itself, so a caller cannot
 * forget to.
 */
export function computeMarketScarcity(
  stats: MarketSpeciesStats | undefined,
  community: ScarcityWitness[],
  cfg: MarketScarcityConfig = DEFAULT_SCARCITY_CONFIG,
): MarketScarcity {
  if (!stats) {
    return {
      available: false,
      reason: 'Not enough data',
      explanation:
        'This species does not appear in the tracked stores. That most likely means its listing title did not match the catalog, not that it is rare - only a share of listings resolve to a known species. Absence is not evidence of scarcity.',
    };
  }

  const witnesses = community.filter((w) => w.resolveRate >= cfg.witnessMinResolveRate);
  if (witnesses.length < cfg.minimumWitnesses) {
    return {
      available: false,
      reason: 'No local-shelf sample',
      explanation:
        `Rating a shelf takes at least ${cfg.minimumWitnesses} general stores that resolve enough of their own catalog to be worth believing, and there ${witnesses.length === 1 ? 'is 1' : `are ${witnesses.length}`}. Nothing is rated rather than guessed.`,
    };
  }

  const witnessIds = new Set(witnesses.map((w) => w.storeId));
  const carrying = stats.stores.filter((s) => witnessIds.has(s.storeId));

  // The single refusal rule. With no witness carrying it, every scrap of
  // evidence we hold comes from a store that cannot resolve its own catalog,
  // and "rare" is indistinguishable from "the matcher missed it".
  if (carrying.length === 0) {
    const others = stats.stores.map((s) => s.storeId);
    return {
      available: false,
      reason: 'Not enough data',
      explanation: others.length
        ? `Listed only by ${others.join(', ')}, none of which is a qualifying local-shelf store. A fish only specialist importers carry may well be rare locally, but against ${witnesses.length} witness stores that is not yet distinguishable from an unmatched title.`
        : 'No tracked store lists this species.',
    };
  }

  const witnessListings = carrying.reduce((n, s) => n + s.listings, 0);

  const storeBreadth = Math.round(100 * (1 - carrying.length / witnesses.length));
  const listingDepth = -Math.round(
    Math.min(cfg.depthNudgeMax, cfg.depthNudgeScale * Math.log1p(witnessListings)),
  );

  const components: MarketScarcityComponents = { storeBreadth, listingDepth };
  const score = Math.max(0, Math.min(100, storeBreadth + listingDepth));

  return {
    available: true,
    score,
    band: bandForScore(score, cfg),
    components,
    formulaVersion: cfg.formulaVersion,
    basis: {
      witnessesCarrying: carrying.length,
      witnessesTracked: witnesses.length,
      witnessListings,
      carriedBy: carrying.map((s) => s.storeId),
    },
  };
}

export const SCARCITY_LABELS: Record<MarketScarcityBand, string> = {
  'widely-available': 'Widely available',
  available: 'Available',
  uncommon: 'Uncommon',
  scarce: 'Scarce',
  'rarely-listed': 'Rarely listed',
};

export const SCARCITY_COMPONENT_LABELS: Record<keyof MarketScarcityComponents, string> = {
  storeBreadth: 'Carried by few local-shelf stores',
  listingDepth: 'Offered often where it is carried',
};

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
 * THE WITNESS GATE, which has two halves and needs both. A store's silence is
 * evidence only if that store can speak AND has something to say.
 *
 *   - `witnessMinResolveRate` - can we read it? A store whose titles we cannot
 *     match contributes absence that is really our own failure.
 *   - `witnessMinCoverage` - does it stock enough to have an opinion? Aquarium
 *     Co-Op resolves 11% of its listings cleanly and publishes 35 species out
 *     of 2,176. Legible, and almost entirely silent. Counting that silence as
 *     absence is what rated Betta and Molly "rarely listed".
 *
 * Self-repairing: as ETL matching and coverage improve, stores rejoin the
 * denominator and the scale gains rungs.
 *
 * THE BAND COMES FROM BREADTH ALONE. Depth orders fish within a band and must
 * never move one across a boundary - see the note at the return below. One
 * consequence worth knowing before you read a distribution: N witnesses give
 * exactly N rateable values, and which bands they land in is fixed by N.
 *
 *   N=3 -> 0, 33, 67          widely-available, available, scarce
 *   N=4 -> 0, 25, 50, 75      adds uncommon and rarely-listed, drops scarce
 *   N=5 -> 0, 20, 40, 60, 80  all five, one per rung
 *
 * So an empty band is usually a property of the sample size rather than a bug.
 * Do not "fix" it by loosening a gate; grow the sample.
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

/** A community store, and whether it is in a position to testify. */
export interface ScarcityWitness {
  storeId: string;
  /**
   * Published listings over livestock listings fetched. Derived in
   * data/market.ts from the index itself, never hardcoded.
   */
  resolveRate: number;
  /**
   * Share of the published catalog this store carries.
   *
   * Separate from resolveRate, and both are needed. Resolve rate says whether
   * we can READ a store; coverage says whether it holds enough of a catalogue
   * to be worth asking. Aquarium Co-Op resolves 11% of its listings cleanly
   * but publishes 35 species out of 2,176 - legible and almost entirely
   * silent. Counting that silence as absence is what rated Betta and Molly
   * "rarely listed".
   */
  coverage: number;
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
   * A community store carrying less than this share of the catalog is not a
   * witness either. See ScarcityWitness.coverage.
   */
  witnessMinCoverage: number;
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
  witnessMinCoverage: 0.05,
  minimumWitnesses: 2,
  depthNudgeMax: 12,
  depthNudgeScale: 4,
  bands: [
    // 75 rather than 80, so a sole-witness fish reaches the top band at four
    // witnesses instead of needing five. Four is what the community store
    // list can realistically produce; five was aspirational.
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
  /** Display names for the ids in `basis` and the refusal text. */
  storeName: (id: string) => string = (id) => id,
): MarketScarcity {
  if (!stats) {
    return {
      available: false,
      reason: 'Not enough data',
      explanation:
        'This species does not appear in the tracked stores. That most likely means its listing title did not match the catalog, not that it is rare - only a share of listings resolve to a known species. Absence is not evidence of scarcity.',
    };
  }

  const witnesses = community.filter(
    (w) => w.resolveRate >= cfg.witnessMinResolveRate && w.coverage >= cfg.witnessMinCoverage,
  );
  if (witnesses.length < cfg.minimumWitnesses) {
    return {
      available: false,
      reason: 'No local-shelf sample',
      explanation:
        `Rating a shelf takes at least ${cfg.minimumWitnesses} general stores that both resolve enough of their own catalog to be readable and carry enough of it to have an opinion, and there ${witnesses.length === 1 ? 'is 1' : `are ${witnesses.length}`}. Nothing is rated rather than guessed.`,
    };
  }

  const witnessIds = new Set(witnesses.map((w) => w.storeId));
  const carrying = stats.stores.filter((s) => witnessIds.has(s.storeId));

  // The single refusal rule. With no witness carrying it, every scrap of
  // evidence we hold comes from a store that cannot resolve its own catalog,
  // and "rare" is indistinguishable from "the matcher missed it".
  if (carrying.length === 0) {
    const others = stats.stores.map((s) => storeName(s.storeId));
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
    // THE BAND COMES FROM BREADTH ALONE, not from the score. Depth orders
    // fish within a band; it must never move one across a boundary. Two
    // reasons, and both bit this formula before the rule was explicit:
    //
    //   - `listings` counts Shopify VARIANT rows, so a vendor splitting one
    //     product into 20 sizes could promote a fish a whole band. That is
    //     the same catalogue artifact stock pressure was deleted for.
    //   - With the nudge in play the top band became unreachable: a
    //     sole-witness fish at four witnesses scored 75-3=72 against a cut of
    //     75, so "rarely listed" could never render at any witness count the
    //     store list can actually produce.
    band: bandForScore(storeBreadth, cfg),
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

# Local-shelf scarcity (spec 003, Phase A) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the market scarcity formula with a breadth-first rating computed only over "community" stores that demonstrably resolve their own catalog, so the badge answers "would I see this on a local shelf" instead of dumping the Predatory Fins catalog.

**Architecture:** One new module (`src/data/store-channels.ts`) classifies every vendor as `community` or `specialist` and is imported by both the ETL and the app, so the classification cannot drift. `src/data/market.ts` derives each store's *resolve rate* from the shipped index itself and hands the qualifying community stores to the engine as witnesses. `src/engine/rarity/market-scarcity.ts` becomes a two-signal function of witness breadth, refusing to rate whenever no witness carries the species.

**No ETL re-run is required.** Resolve rate is `published listings / livestock listings`, and both numbers are already in `market-index.json` — `listingsFetched` per source, and per-store listing counts inside each species entry. Phase A therefore ships against the currently committed index with no network access. (Phase B adds the true ETL-side match rate, which will be slightly higher: the runtime figure excludes species dropped by `minimumSampleCount`. Conservative in the right direction for a gate, and documented as such.)

**Tech Stack:** TypeScript, Vitest, React. `npm test` runs the suite; `npm run typecheck` runs `tsc -b --noEmit`.

**Reference:** [docs/specs/003-local-shelf-scarcity.md](../specs/003-local-shelf-scarcity.md)

**Branch:** work on `feat/local-shelf-scarcity`, then push to `uat` for Ryan to review on the deployed build before anything reaches `main`.

---

### Ground truth for every expected value in this plan

Computed from the committed `src/data/seed/marts/market-index.json`. Do not re-derive these by hand; if a test disagrees, the implementation is wrong.

Resolve rates for the four community stores present in the index:

| Store | Published | Livestock | Rate |
|---|---:|---:|---:|
| `aquatic-arts` | 902 | 5,127 | 0.1759 |
| `imperial-tropicals` | 497 | 4,133 | 0.1203 |
| `aquahuna` | 12 | 704 | 0.0170 |
| `aquarium-coop` | 1 | 375 | 0.0027 |

At `witnessMinResolveRate: 0.10`, witnesses are **`aquatic-arts` and `imperial-tropicals`**, so `N = 2`.

Resulting distribution over all 299 species: **24 widely-available, 7 available, 63 uncommon, 0 scarce, 0 rarely-listed, 205 not rated.** 94 of 299 rated.

---

## File Structure

- **Create** `src/data/store-channels.ts` — vendor → channel map. Single source of truth, no logic.
- **Create** `src/data/store-channels.test.ts` — completeness guard: every store in `STORES` and every source in the shipped index has a channel.
- **Rewrite** `src/engine/rarity/market-scarcity.ts` — the formula. Pure, no imports from `data/market` except the stats type.
- **Rewrite** `src/engine/rarity/market-scarcity.test.ts` — unit tests on synthetic fixtures.
- **Create** `src/engine/rarity/market-scarcity.calibration.test.ts` — distribution guard over the real shipped index. Separate file because it is a data test, not a logic test, and it should fail loudly for a different reason.
- **Modify** `src/data/market.ts` — derive resolve rates and witnesses; rewire `scarcityFor`.
- **Modify** `src/ui/components/MarketPanel.tsx` — component labels, signed rendering, copy.

Three files that look like they should change but must not:

- `src/data/catalog.ts:169` (`marketAndScarcity`) and `src/ui/screens/SpecimenDetail.tsx` consume only `.band` behind an `available` check.
- `src/ui/components/Badges.tsx` imports `SCARCITY_LABELS` and `MarketScarcityBand`, both unchanged. (Spec 003's Files list names it; that is stale and Task 6 corrects it.)

---

## Task 1: Store channel tiering

**Files:**
- Create: `src/data/store-channels.ts`
- Create: `src/data/store-channels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/store-channels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STORE_CHANNELS, type StoreChannel } from './store-channels';
import { MARKET_INDEX } from './market';
import { STORES } from '../../etl/types';

describe('every tracked vendor is classified', () => {
  it('covers every store the ETL declares', () => {
    const unclassified = STORES.filter((s) => !STORE_CHANNELS[s.id]).map((s) => s.id);
    expect(unclassified).toEqual([]);
  });

  it('covers every source in the shipped index', () => {
    const unclassified = MARKET_INDEX.sources.filter((s) => !STORE_CHANNELS[s.id]).map((s) => s.id);
    expect(unclassified).toEqual([]);
  });

  it('has no entry for a store that does not exist', () => {
    const known = new Set(STORES.map((s) => s.id));
    expect(Object.keys(STORE_CHANNELS).filter((id) => !known.has(id))).toEqual([]);
  });
});

describe('the classification the rating depends on', () => {
  it('excludes the big specialty importers from the local-shelf sample', () => {
    const specialists: StoreChannel = 'specialist';
    expect(STORE_CHANNELS['predatory-fins']).toBe(specialists);
    expect(STORE_CHANNELS['global-exoticquatics']).toBe(specialists);
    expect(STORE_CHANNELS['j4-flowerhorns']).toBe(specialists);
    // A shrimp and invert boutique, not a general shop.
    expect(STORE_CHANNELS['flip-aquatics']).toBe(specialists);
  });

  it('counts the generalist shops and the big-box brand as shelves', () => {
    for (const id of ['imperial-tropicals', 'aquatic-arts', 'aquahuna', 'aquarium-coop', 'nu-aqua', 'liveaquaria']) {
      expect(STORE_CHANNELS[id]).toBe('community');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/store-channels.test.ts`
Expected: FAIL — `Failed to resolve import "./store-channels"`.

- [ ] **Step 3: Write the implementation**

Create `src/data/store-channels.ts`:

```ts
/**
 * What kind of buyer each tracked store serves.
 *
 * ONE map, imported by both the app and the ETL, because this is the second
 * place a vendor list could silently drift out of sync - the same failure
 * TRACKED_STORES exists to prevent. store-channels.test.ts fails the build if
 * a store is added without being classified.
 *
 * WHY THIS DECIDES THE RATING. Market scarcity asks "would I see this on a
 * local shelf", so the sample has to be stores that resemble a local shelf.
 * Predatory Fins resolves 74.6% of its catalogue against ours while Aquarium
 * Co-Op resolves 0.3%, so weighting every vendor equally turned the rating
 * into a Predatory Fins catalogue dump: 275 of 299 species came from PF and
 * 198 were sole-source there. See docs/specs/003-local-shelf-scarcity.md.
 */
export type StoreChannel = 'community' | 'specialist';

export const STORE_CHANNELS: Record<string, StoreChannel> = {
  // --- community: generalist shops whose catalogue approximates a local shelf.
  'imperial-tropicals': 'community',
  'aquatic-arts': 'community',
  'aquahuna': 'community',
  'aquarium-coop': 'community',
  // The one vendor the owner can physically walk into (Orland Park, IL).
  'nu-aqua': 'community',
  // Petco's aquatics brand. A big-box chain stocking a fish is the strongest
  // evidence available that it is not rare, so it counts as a shelf. Its
  // marine skew means it rarely fires for freshwater species, which is
  // correct behaviour rather than a defect.
  'liveaquaria': 'community',

  // --- specialist: importers and single-niche boutiques. They prove an animal
  // exists in trade and they price it. They are never evidence about a shelf.
  'predatory-fins': 'specialist',
  'global-exoticquatics': 'specialist',
  'j4-flowerhorns': 'specialist',
  // A shrimp and invert boutique. Its not carrying a cichlid says nothing
  // about cichlids, so its silence must not count against one.
  'flip-aquatics': 'specialist',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/store-channels.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/store-channels.ts src/data/store-channels.test.ts
git commit -m "feat: classify each tracked vendor as community or specialist"
```

---

## Task 2: The breadth-first formula

**Files:**
- Rewrite: `src/engine/rarity/market-scarcity.ts`
- Rewrite: `src/engine/rarity/market-scarcity.test.ts`

The old file's four-signal formula, `MarketScarcityConfig.points`, `trackedStores`, `depthSaturation`, `priceCeiling` and `minimumListings` all go. `minimumListings` is dead config either way: `buildMarketIndex` already drops species below `minimumSampleCount`, so no entry reaching this function can be under it.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `src/engine/rarity/market-scarcity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  bandForScore, computeMarketScarcity, DEFAULT_SCARCITY_CONFIG,
  type MarketScarcityResult, type ScarcityWitness,
} from './market-scarcity';
import type { MarketSpeciesStats } from '@/data/market';

/** Witnesses well clear of the gate, so tests opt in to the gate deliberately. */
const witnesses = (n: number): ScarcityWitness[] =>
  Array.from({ length: n }, (_, i) => ({ storeId: `w${i}`, resolveRate: 0.5 }));

function stats(storeIds: string[], listingsEach = 2): MarketSpeciesStats {
  return {
    speciesId: 'sp_x',
    comparableCount: storeIds.length * listingsEach,
    totalListings: storeIds.length * listingsEach,
    inStock: 1, soldOut: 1,
    price: { median: 50, min: 10, max: 100, currency: 'USD' },
    priceBySize: [],
    stores: storeIds.map((storeId) => ({
      storeId, listings: listingsEach, inStock: 1, medianPrice: 50,
    })),
  };
}

const rate = (ids: string[], n = 4, each = 2) =>
  computeMarketScarcity(stats(ids, each), witnesses(n)) as MarketScarcityResult;

describe('breadth is the rating', () => {
  it('scores zero when every witness carries it', () => {
    expect(rate(['w0', 'w1', 'w2', 'w3']).components.storeBreadth).toBe(0);
  });

  it('scores highest when exactly one witness carries it', () => {
    // 100 * (1 - 1/4) = 75
    expect(rate(['w0']).components.storeBreadth).toBe(75);
  });

  it('falls monotonically as more witnesses carry it', () => {
    let previous = Infinity;
    for (let n = 1; n <= 4; n += 1) {
      const points = rate(['w0', 'w1', 'w2', 'w3'].slice(0, n)).components.storeBreadth;
      expect(points).toBeLessThanOrEqual(previous);
      previous = points;
    }
  });

  it('ignores specialist stores entirely: they are not witnesses', () => {
    const withPf = rate(['w0', 'predatory-fins']);
    const without = rate(['w0']);
    expect(withPf.score).toBe(without.score);
    expect(withPf.basis.carriedBy).toEqual(['w0']);
  });
});

describe('depth is a nudge, not a signal', () => {
  it('is negative: a deep catalogue makes a fish more findable, never less', () => {
    expect(rate(['w0'], 4, 40).components.listingDepth).toBeLessThan(0);
  });

  it('caps at the configured maximum', () => {
    const deep = rate(['w0'], 4, 10_000).components.listingDepth;
    expect(deep).toBe(-DEFAULT_SCARCITY_CONFIG.depthNudgeMax);
  });

  it('never outweighs breadth', () => {
    // One witness with a huge catalogue still outranks two witnesses.
    expect(rate(['w0'], 4, 10_000).score).toBeGreaterThan(rate(['w0', 'w1'], 4, 2).score);
  });
});

describe('the witness gate', () => {
  it('refuses when no community store resolves enough of its catalogue', () => {
    const weak: ScarcityWitness[] = [{ storeId: 'w0', resolveRate: 0.02 }];
    const r = computeMarketScarcity(stats(['w0']), weak);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe('No local-shelf sample');
  });

  it('rates the same species once that store clears the threshold', () => {
    const strong: ScarcityWitness[] = [{ storeId: 'w0', resolveRate: 0.5 }];
    expect(computeMarketScarcity(stats(['w0']), strong).available).toBe(true);
  });

  it('uses the configured threshold, not a hardcoded one', () => {
    const store: ScarcityWitness[] = [{ storeId: 'w0', resolveRate: 0.05 }];
    const lenient = { ...DEFAULT_SCARCITY_CONFIG, witnessMinResolveRate: 0.01 };
    expect(computeMarketScarcity(stats(['w0']), store, lenient).available).toBe(true);
  });
});

describe('refusing to rate is a single rule: no witness carries it', () => {
  it('refuses for a species with no index entry', () => {
    const r = computeMarketScarcity(undefined, witnesses(4));
    expect(r.available).toBe(false);
    if (!r.available) {
      expect(r.reason).toBe('Not enough data');
      // A missing species is an unmatched title, not a rare fish.
      expect(r.explanation).toMatch(/not that it is rare/i);
    }
  });

  it('refuses for a species only specialists carry, rather than calling it rare', () => {
    const r = computeMarketScarcity(stats(['predatory-fins']), witnesses(4));
    expect(r.available).toBe(false);
    expect(r).not.toHaveProperty('band');
    expect(r).not.toHaveProperty('score');
  });

  it('names the stores that do carry it, so the refusal is diagnosable', () => {
    const r = computeMarketScarcity(stats(['predatory-fins']), witnesses(4));
    if (!r.available) expect(r.explanation).toMatch(/predatory-fins/);
  });
});

describe('the ceiling rises with the witness count', () => {
  // The guard against "fixing" low coverage by loosening the gate: doing that
  // has to move visible bands. Score is 100 * (1 - 1/N) minus the depth nudge
  // for two listings, round(4 * ln 3) = 4.
  const soleWitness = (n: number) => rate(['w0'], n);

  it('cannot call anything rarely listed on two witnesses', () => {
    expect(soleWitness(2).score).toBe(46);
    expect(soleWitness(2).band).toBe('uncommon');
  });

  it('reaches scarce at three', () => {
    expect(soleWitness(3).score).toBe(63);
    expect(soleWitness(3).band).toBe('scarce');
  });

  it('reaches rarely listed at five, which is the sole-source case Ryan asked for', () => {
    expect(soleWitness(5).score).toBe(76);
    expect(soleWitness(5).band).toBe('rarely-listed');
  });

  it('stays there as more witnesses join', () => {
    expect(soleWitness(6).band).toBe('rarely-listed');
  });
});

describe('the deleted signals stay deleted', () => {
  it('exposes only breadth and depth', () => {
    expect(Object.keys(rate(['w0']).components).sort()).toEqual(['listingDepth', 'storeBreadth']);
  });

  it('ignores stock: 84% of the dataset is sold-out back catalogue', () => {
    const base = stats(['w0', 'w1']);
    const soldOut = computeMarketScarcity({ ...base, inStock: 0, soldOut: 4 }, witnesses(4)) as MarketScarcityResult;
    const stocked = computeMarketScarcity({ ...base, inStock: 4, soldOut: 0 }, witnesses(4)) as MarketScarcityResult;
    expect(soldOut.score).toBe(stocked.score);
  });

  it('ignores price: it is a consequence of rarity, not evidence of it', () => {
    const base = stats(['w0', 'w1']);
    const dear = computeMarketScarcity(
      { ...base, price: { median: 5000, min: 1000, max: 9000, currency: 'USD' } }, witnesses(4),
    ) as MarketScarcityResult;
    expect(dear.score).toBe(rate(['w0', 'w1']).score);
  });
});

describe('bands', () => {
  const cases: Array<[number, string]> = [
    [0, 'widely-available'], [19, 'widely-available'],
    [20, 'available'], [39, 'available'],
    [40, 'uncommon'], [59, 'uncommon'],
    [60, 'scarce'], [74, 'scarce'],
    [75, 'rarely-listed'], [100, 'rarely-listed'],
  ];
  it.each(cases)('maps %i to %s', (score, band) => {
    expect(bandForScore(score, DEFAULT_SCARCITY_CONFIG)).toBe(band);
  });
});

describe('transparency and determinism', () => {
  it('reports the basis the rating rests on', () => {
    expect(rate(['w0', 'w1'], 4).basis).toMatchObject({
      witnessesCarrying: 2, witnessesTracked: 4, witnessListings: 4,
    });
  });

  it('stamps the formula version', () => {
    expect(rate(['w0']).formulaVersion).toBe('market-scarcity-v1.0.0');
  });

  it('is deterministic', () => {
    expect(rate(['w0', 'w1'])).toEqual(rate(['w0', 'w1']));
  });

  it('clamps to 0-100', () => {
    const r = rate(['w0', 'w1', 'w2', 'w3'], 4, 10_000);
    expect(r.score).toBe(0);
  });
});

describe('separation from the Discovery Tier (FR-P05)', () => {
  it('produces no field that the personal tier consumes', () => {
    const json = JSON.stringify(rate(['w0']));
    expect(json).not.toMatch(/discoveryTier|personalEncounterScarcity|dreamList|firstConfirmed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/rarity/market-scarcity.test.ts`
Expected: FAIL — `ScarcityWitness` is not exported, and `computeMarketScarcity` takes a config as its second argument.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/engine/rarity/market-scarcity.ts`:

```ts
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
 * four signals were measuring something else:
 *
 *   - Stock pressure tracked Shopify leaving sold-out products published. 84%
 *     of the dataset is dead back catalogue and 180 of 299 species had zero in
 *     stock, so it handed 25 points to nearly everyone. DELETED.
 *   - Price level tracked a consequence of rarity rather than evidence of it,
 *     and let a big adult oscar read as rare for being expensive. DELETED.
 *   - Store breadth tracked which vendors write binomials in their product
 *     titles. Predatory Fins resolves 74.6% of its catalogue against ours;
 *     Aquarium Co-Op resolves 0.3%. So 275 of 299 species came from PF, 198
 *     sole-source, and the "rarest" fish in the app were simply PF's stock
 *     list. REBUILT on community stores only.
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
 * band. The formula has to earn its strongest word. Do not "fix" thin
 * coverage by lowering the threshold - that trade is exactly what the
 * calibration test refuses.
 *
 * See docs/specs/003-local-shelf-scarcity.md.
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
  /** Largest discount a deep catalogue can earn. */
  depthNudgeMax: number;
  /** Multiplier on ln(1 + listings). */
  depthNudgeScale: number;
  bands: Array<{ band: MarketScarcityBand; minScore: number }>;
}

export const DEFAULT_SCARCITY_CONFIG: MarketScarcityConfig = {
  formulaVersion: 'market-scarcity-v1.0.0',
  witnessMinResolveRate: 0.1,
  depthNudgeMax: 12,
  depthNudgeScale: 4,
  bands: [
    // 75, not 80. The depth nudge subtracts up to 12, so at an 80 cut a
    // sole-source fish never reaches the top band even on six witnesses -
    // which would quietly defeat the whole metric. Changes nothing today,
    // where the highest achievable score is 47.
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
 * `community` is every community-channel store in the index with its resolve
 * rate; this function applies the gate itself, so callers cannot forget to.
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
        'This species does not appear in the tracked stores. That most likely means its listing title did not match the catalog, not that it is rare - only a small share of listings resolve to a known species. Absence is not evidence of scarcity.',
    };
  }

  const witnesses = community.filter((w) => w.resolveRate >= cfg.witnessMinResolveRate);
  if (witnesses.length === 0) {
    return {
      available: false,
      reason: 'No local-shelf sample',
      explanation:
        'None of the tracked general stores resolves enough of its own catalog to be a reliable witness, so there is no shelf to measure against. Nothing is rated rather than guessed.',
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
        ? `Listed only by ${others.join(', ')}, none of which is a qualifying local-shelf store. A fish that only specialist importers carry may well be rare locally, but against ${witnesses.length} witness store${witnesses.length === 1 ? '' : 's'} that is not yet distinguishable from an unmatched title.`
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/rarity/market-scarcity.test.ts`
Expected: PASS. The two other suites (`src/data/market.ts` consumers) will still fail — Task 3 fixes them.

- [ ] **Step 5: Commit**

```bash
git add src/engine/rarity/market-scarcity.ts src/engine/rarity/market-scarcity.test.ts
git commit -m "feat: rate scarcity on community-store breadth behind a witness gate"
```

---

## Task 3: Derive witnesses from the shipped index

**Files:**
- Modify: `src/data/market.ts:60-88` (the `marketFor` / `TRACKED_STORES` / `scarcityFor` block)

- [ ] **Step 1: Write the failing test**

Create `src/data/market.test.ts`. These are wiring tests for the reading layer; the distribution test over the real index is separate and comes in Task 4.

```ts
import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_WITNESSES, MARKET_INDEX, STORE_RESOLVE_RATES, WITNESS_STORES, scarcityFor,
} from './market';
import { STORE_CHANNELS } from './store-channels';

describe('resolve rates are derived from the index, never hardcoded', () => {
  it('matches published listings over livestock listings', () => {
    // Ground truth from the committed index. See docs/plans/003.
    expect(STORE_RESOLVE_RATES['aquatic-arts']).toBeCloseTo(902 / 5127, 4);
    expect(STORE_RESOLVE_RATES['imperial-tropicals']).toBeCloseTo(497 / 4133, 4);
    expect(STORE_RESOLVE_RATES['aquarium-coop']).toBeCloseTo(1 / 375, 4);
  });

  it('covers every source in the index', () => {
    for (const s of MARKET_INDEX.sources) {
      expect(STORE_RESOLVE_RATES[s.id]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('only community stores are offered as witnesses', () => {
  it('excludes every specialist', () => {
    const ids = COMMUNITY_WITNESSES.map((w) => w.storeId);
    expect(ids).not.toContain('predatory-fins');
    for (const id of ids) expect(STORE_CHANNELS[id]).toBe('community');
  });

  it('admits only the stores that clear the gate', () => {
    // aquahuna (1.7%) and aquarium-coop (0.3%) are present but below 10%.
    expect(WITNESS_STORES.map((w) => w.storeId).sort()).toEqual(['aquatic-arts', 'imperial-tropicals']);
  });
});

describe('the entry point cannot be bypassed', () => {
  it('returns not-enough-data for an unknown species', () => {
    expect(scarcityFor('sp_does_not_exist').available).toBe(false);
    expect(scarcityFor(undefined).available).toBe(false);
  });

  it('refuses for a Predatory Fins exclusive rather than calling it rare', () => {
    // Every store carrying this one is a specialist.
    const pfOnly = Object.values(MARKET_INDEX.species).find(
      (s) => s.stores.every((x) => STORE_CHANNELS[x.storeId] === 'specialist'),
    );
    expect(pfOnly).toBeDefined();
    expect(scarcityFor(pfOnly!.speciesId).available).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/market.test.ts`
Expected: FAIL — `STORE_RESOLVE_RATES`, `COMMUNITY_WITNESSES` and `WITNESS_STORES` are not exported.

- [ ] **Step 3: Write the implementation**

In `src/data/market.ts`, add to the imports at the top:

```ts
import { computeMarketScarcity, DEFAULT_SCARCITY_CONFIG, type ScarcityWitness } from '@/engine/rarity/market-scarcity';
import { STORE_CHANNELS } from './store-channels';
```

(replacing the existing `computeMarketScarcity` import line).

Then replace the `TRACKED_STORES` and `scarcityFor` block (currently `src/data/market.ts:65-88`) with:

```ts
/**
 * How many vendors produced this index.
 *
 * Read from the data rather than configured. Still exported because the UI
 * quotes it, but it no longer drives the rating - see WITNESS_STORES.
 */
export const TRACKED_STORES = MARKET_INDEX.sources.length;

/**
 * Listings each store actually contributed to the published index.
 *
 * Note this counts *published* listings, so it excludes species that
 * buildMarketIndex dropped for thin sampling. That makes it slightly lower
 * than the ETL's true match rate, which is the conservative direction for a
 * gate: a store whose match got dropped genuinely cannot testify about that
 * species either.
 */
function publishedListingsByStore(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stats of Object.values(MARKET_INDEX.species)) {
    for (const s of stats.stores) counts[s.storeId] = (counts[s.storeId] ?? 0) + s.listings;
  }
  return counts;
}

/**
 * What share of each store's catalogue we can actually read.
 *
 * This is the number the witness gate turns on, and it is derived rather than
 * declared so it can never disagree with the index it describes. Today:
 * Predatory Fins 0.75, Aquatic Arts 0.18, Imperial Tropicals 0.12, AquaHuna
 * 0.02, Aquarium Co-Op 0.003.
 */
export const STORE_RESOLVE_RATES: Record<string, number> = (() => {
  const published = publishedListingsByStore();
  return Object.fromEntries(
    MARKET_INDEX.sources.map((s) => [
      s.id,
      s.listingsFetched > 0 ? (published[s.id] ?? 0) / s.listingsFetched : 0,
    ]),
  );
})();

/** Every community-channel store in the index, gate not yet applied. */
export const COMMUNITY_WITNESSES: ScarcityWitness[] = MARKET_INDEX.sources
  .filter((s) => STORE_CHANNELS[s.id] === 'community')
  .map((s) => ({ storeId: s.id, resolveRate: STORE_RESOLVE_RATES[s.id] ?? 0 }));

/**
 * The community stores that clear the gate - the actual denominator.
 *
 * Exported so the UI can say how many shelves the rating rests on, rather
 * than implying it consulted all ten vendors.
 */
export const WITNESS_STORES: ScarcityWitness[] = COMMUNITY_WITNESSES.filter(
  (w) => w.resolveRate >= DEFAULT_SCARCITY_CONFIG.witnessMinResolveRate,
);

/**
 * Rate a species' local-shelf scarcity.
 *
 * The single entry point the UI should use. Calling computeMarketScarcity
 * directly works but risks passing a stale witness list; this cannot.
 */
export function scarcityFor(speciesId: string | undefined) {
  return computeMarketScarcity(marketFor(speciesId), COMMUNITY_WITNESSES);
}
```

Also update the file's header comment: the line "Nothing exported here is read by the Discovery Tier" stays true and needs no change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/market.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. If `src/data/repositories.test.ts` references the removed `trackedStores` config key, fix those references to use `WITNESS_STORES`; do not re-add the key.

- [ ] **Step 6: Commit**

```bash
git add src/data/market.ts src/data/market.test.ts
git commit -m "feat: derive witness stores and resolve rates from the shipped index"
```

---

## Task 4: The calibration guard

This is the test whose absence let the original bug ship. It asserts against the real committed index, so a future ETL run that collapses the bands fails CI.

**Files:**
- Create: `src/engine/rarity/market-scarcity.calibration.test.ts`

- [ ] **Step 1: Write the test (it should pass immediately if Tasks 2-3 are right)**

```ts
/**
 * Calibration over the real shipped index.
 *
 * A distribution test, not a logic test. The v0.1.0 formula put 89% of the
 * catalogue in the bottom two bands and called Betta "uncommon"; nothing in
 * the unit tests noticed, because every one of them passed. This is the check
 * that would have caught it.
 *
 * Expected values come from the committed market-index.json and are listed in
 * docs/plans/003-local-shelf-scarcity.md. If an ETL refresh moves them, look
 * at the new distribution before editing the numbers.
 */
import { describe, expect, it } from 'vitest';
import { MARKET_INDEX, scarcityFor } from '@/data/market';
import catalogJson from '@/data/seed/marts/catalog.json';

const ids = Object.keys(MARKET_INDEX.species);

const catalog = catalogJson as unknown as {
  species: Array<{ speciesId: string; commonName: string }>;
};

/** First species id for a common name, so fixtures read like fish. */
const BY_COMMON_NAME: Record<string, string> = {};
for (const e of catalog.species) {
  if (!BY_COMMON_NAME[e.commonName]) BY_COMMON_NAME[e.commonName] = e.speciesId;
}

function idFor(commonName: string): string {
  const hit = BY_COMMON_NAME[commonName];
  if (!hit) throw new Error(`no catalog species named ${commonName}`);
  return hit;
}

function distribution(): Record<string, number> {
  const counts: Record<string, number> = { 'not-rated': 0 };
  for (const id of ids) {
    const r = scarcityFor(id);
    const key: string = r.available ? r.band : 'not-rated';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe('common fish read as common', () => {
  // The headline bug: every one of these was "uncommon" or "scarce" in v0.1.0.
  it.each(['Betta', 'Fancy Guppy', 'Bristlenose Pleco', 'Oscar', 'Jack Dempsey'])(
    '%s is widely available',
    (name) => {
      const r = scarcityFor(idFor(name));
      expect(r.available).toBe(true);
      if (r.available) expect(r.band).toBe('widely-available');
    },
  );
});

describe('the distribution is usable', () => {
  const counts = distribution();

  it('rates 94 of 299 species', () => {
    expect(ids.length).toBe(299);
    expect(counts['not-rated']).toBe(205);
  });

  it('matches the expected band spread', () => {
    expect(counts['widely-available']).toBe(24);
    expect(counts['available']).toBe(7);
    expect(counts['uncommon']).toBe(63);
  });

  it('claims nothing is rare, because two witnesses cannot support that claim', () => {
    expect(counts['scarce'] ?? 0).toBe(0);
    expect(counts['rarely-listed'] ?? 0).toBe(0);
  });

  it('never lands most of the rated catalogue in one band', () => {
    const rated = ids.length - counts['not-rated']!;
    const biggest = Math.max(...Object.entries(counts).filter(([k]) => k !== 'not-rated').map(([, v]) => v));
    // v0.1.0 put 54.5% in "rarely listed" alone. Anything over 80% of the
    // rated set in a single band means the scale has stopped discriminating.
    expect(biggest / rated).toBeLessThan(0.8);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/engine/rarity/market-scarcity.calibration.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 3: Commit**

```bash
git add src/engine/rarity/market-scarcity.calibration.test.ts
git commit -m "test: pin the scarcity band distribution against the shipped index"
```

---

## Task 5: Update the market panel

`SCARCITY_COMPONENT_LABELS` now has two keys and `listingDepth` is negative, so the hardcoded `+` in the panel would render "+-12".

**Files:**
- Modify: `src/ui/components/MarketPanel.tsx:69-79`

- [ ] **Step 1: Change the component rendering and copy**

In `src/ui/components/MarketPanel.tsx`, add `WITNESS_STORES` to the existing import from `@/data/market`.

Replace the `<dd>` line so the sign comes from the value:

```tsx
                <dd>{scarcity.components[k] >= 0 ? '+' : ''}{scarcity.components[k]}</dd>
```

Replace the explanatory paragraph (currently "How hard this is to buy from {MARKET_INDEX.sources.length} mail-order stores...") with:

```tsx
          <p className="xs muted" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
            How likely you are to find this on a shelf, measured across {WITNESS_STORES.length} general
            {' '}{WITNESS_STORES.length === 1 ? 'store' : 'stores'}. Specialist importers are excluded on
            purpose: they stock rarities as a matter of course, so their carrying a fish says nothing
            about whether you will see one locally.
          </p>
```

- [ ] **Step 2: Verify the app builds and the suite is green**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Look at it**

Run: `npm run dev`, open a species with a rating (Betta, Oscar, Bristlenose Pleco) and one without (any Predatory Fins exclusive). Confirm the rated one shows two components with correct signs, and the unrated one shows the market panel without a scarcity block rather than an empty box.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/MarketPanel.tsx
git commit -m "feat: show scarcity as local-shelf breadth over the witness stores"
```

---

## Task 6: Update the docs the change invalidates

**Files:**
- Modify: `docs/MARKET_ETL.md`
- Modify: `README.md`

(The spec's own Files section was already corrected when this plan was written.)

- [ ] **Step 1: Update any prose describing the old formula**

Run: `grep -rn "stockPressure\|priceLevel\|depthSaturation\|trackedStores\|mail-order stores" README.md docs/ --include="*.md"`

Rewrite each hit to describe the two-signal, community-store formula. Do not leave a document claiming the rating uses price or stock.

- [ ] **Step 2: Commit**

```bash
git add README.md docs/
git commit -m "docs: describe the local-shelf scarcity formula"
```

---

## Done when

- [ ] `npm test` green, `npm run typecheck` clean.
- [ ] `grep -rn "stockPressure\|priceLevel" src/` returns nothing.
- [ ] Betta, Fancy Guppy, Bristlenose Pleco, Oscar and Jack Dempsey all read **Widely available** in the running app.
- [ ] A Predatory Fins exclusive shows **no** scarcity block, not "rarely listed".
- [ ] Pushed to `uat`, and Ryan has reviewed the deployed build. Do not merge to `main` without his explicit sign-off.

## Explicitly out of scope (Phase B)

Improving community-store title matching, adding Nu Aqua and LiveAquaria snapshots, and emitting the true match rate from the ETL. Phase A deliberately ships with 94 of 299 species rated and no fish called rare; Phase B is what raises both. Do not compensate by lowering `witnessMinResolveRate` — the ceiling test in Task 2 exists to make that trade visible.

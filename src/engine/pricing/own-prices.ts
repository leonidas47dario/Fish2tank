/**
 * Counting a keeper's own logged prices toward the market estimate.
 *
 * WHAT WAS WRONG. Prices you record in a shop were stored, shown back on that
 * one catch, and counted for nothing else. The market estimate on a card, a
 * species page or a tank's total value came only from the vendor index - so
 * the fish you actually priced with your own eyes, standing in front of it,
 * had no effect on what the app said it was worth. For the 1,703 species the
 * vendor index cannot price at all, your own record was the only evidence
 * anywhere in the app and it counted for nothing.
 *
 * WHAT THIS CANNOT DO, AND WHY IT MATTERS. The shipped index publishes
 * AGGREGATES - a median per store, a median per size band - not the raw
 * listing prices they were computed from. A true pooled median over vendor
 * listings plus your observations is therefore not computable on the device.
 * Pretending otherwise would be inventing a number.
 *
 * So the pool is reconstructed from what IS published: each vendor store
 * contributes its own median, repeated once per listing it holds, which is the
 * only weighting the published data supports. Your observations contribute
 * their real per-fish prices, one point each. `basis` records which of the two
 * produced the figure, so nothing has to guess later, and `approximated` is
 * true whenever a vendor aggregate stood in for its listings.
 *
 * WHAT IT REFUSES. The minimum sample count is the vendor index's own
 * (`minimumSampleCount`), applied unchanged: three points before any median is
 * published. A species with two of your prices and no vendor data still says
 * "not enough data", because two is what the rest of the app already calls not
 * enough. Currency mismatches are excluded rather than converted - there are
 * no rates here, and a silent conversion is a wrong number wearing a right
 * one's clothes.
 */
import type { CurrencyCode, Id, PriceObservation } from '@/domain/types';
import type { MarketSpeciesStats } from '@/data/market';
import { median, unitPriceOf } from './price-fit';

export interface OwnPriceConfig {
  version: string;
  /** Observations older than this no longer describe today's market. */
  dateWindowDays: number;
}

export const DEFAULT_OWN_PRICE_CONFIG: OwnPriceConfig = {
  version: 'own-prices-v0.1.0',
  // The same window price-fit uses to decide two observations are comparable.
  dateWindowDays: 365,
};

export type OwnExclusionReason =
  | 'different-species'
  | 'different-currency'
  | 'no-price-recorded'
  | 'missing-package-quantity'
  | 'outside-date-window';

export interface OwnPricePoint {
  observationId: Id;
  unitPrice: number;
  observedAt: string;
  sizeIn?: number;
}

export interface OwnPriceSummary {
  /** Observations that counted. */
  points: OwnPricePoint[];
  /** And the ones that did not, each with the reason (NFR-05). */
  excluded: Array<{ observationId: Id; reason: OwnExclusionReason }>;
  /** Median of the counted points, absent when none counted. */
  median?: number;
  currency: CurrencyCode;
}

const inchesOf = (o: PriceObservation): number | undefined => {
  const s = o.observedSize;
  if (!s) return undefined;
  return s.unit === 'cm' ? s.value / 2.54 : s.value;
};

/**
 * Which of a keeper's observations may speak about this species' price.
 *
 * Separated from the blend so the reasons survive: a panel can say "2 of your
 * 5 records counted" and name what happened to the other three, rather than
 * a number appearing to come from nowhere.
 */
export function summariseOwnPrices(
  observations: PriceObservation[],
  opts: { speciesId: string; currency: CurrencyCode; now?: Date; config?: OwnPriceConfig },
): OwnPriceSummary {
  const config = opts.config ?? DEFAULT_OWN_PRICE_CONFIG;
  const now = opts.now ?? new Date();
  const points: OwnPricePoint[] = [];
  const excluded: OwnPriceSummary['excluded'] = [];

  for (const o of observations) {
    if (o.speciesId !== opts.speciesId) {
      excluded.push({ observationId: o.id, reason: 'different-species' });
      continue;
    }
    if (o.currency !== opts.currency) {
      excluded.push({ observationId: o.id, reason: 'different-currency' });
      continue;
    }
    const ageDays = Math.abs(now.getTime() - Date.parse(o.observedAt)) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays > config.dateWindowDays) {
      excluded.push({ observationId: o.id, reason: 'outside-date-window' });
      continue;
    }
    if ((o.memberPrice ?? o.askingPrice ?? o.paidPrice) === undefined) {
      excluded.push({ observationId: o.id, reason: 'no-price-recorded' });
      continue;
    }
    const unit = unitPriceOf(o);
    if (unit === undefined) {
      // A price with no package quantity cannot be made per-fish, and
      // "$41.99 for 3 Fish" must never read as $41.99 a fish.
      excluded.push({ observationId: o.id, reason: 'missing-package-quantity' });
      continue;
    }
    points.push({
      observationId: o.id,
      unitPrice: unit,
      observedAt: o.observedAt,
      sizeIn: inchesOf(o),
    });
  }

  return {
    points,
    excluded,
    ...(points.length ? { median: round2(median(points.map((p) => p.unitPrice))) } : {}),
    currency: opts.currency,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The synthetic store id a keeper's own records appear under. */
export const OWN_RECORDS_STORE_ID = 'your-records';

export interface BlendedMarket extends MarketSpeciesStats {
  /** What the keeper's own records contributed, and what was left out. */
  own: OwnPriceSummary & {
    /** True when a vendor per-store median stood in for its raw listings. */
    approximated: boolean;
    /** Where the published figure came from. */
    basis: 'vendor-only' | 'own-only' | 'blended';
  };
}

/** Whether a market figure carries the keeper's own contribution alongside it. */
export function isBlended(
  stats: MarketSpeciesStats | BlendedMarket | undefined,
): stats is BlendedMarket {
  return Boolean(stats && 'own' in stats);
}

/**
 * Fold a keeper's own prices into a species' market stats.
 *
 * Returns undefined only when there is nothing at all to say - no vendor row
 * and no usable observation. A vendor row with no own prices comes back
 * unchanged apart from the `own` block, so callers can render one shape.
 */
export function blendOwnPrices(
  stats: MarketSpeciesStats | undefined,
  observations: PriceObservation[],
  opts: {
    speciesId: string;
    currency: CurrencyCode;
    minimumSampleCount: number;
    now?: Date;
    config?: OwnPriceConfig;
  },
): BlendedMarket | undefined {
  const own = summariseOwnPrices(observations, opts);
  if (!stats && own.points.length === 0) return undefined;

  const base: MarketSpeciesStats = stats ?? {
    speciesId: opts.speciesId,
    comparableCount: 0,
    totalListings: 0,
    inStock: 0,
    soldOut: 0,
    priceBySize: [],
    stores: [],
  };

  // A vendor price in another currency cannot be pooled with these, and the
  // vendor figure is the one with the larger sample, so it stands alone.
  const currencyClash = Boolean(base.price && base.price.currency !== opts.currency);
  const usable = currencyClash ? [] : own.points;

  if (usable.length === 0) {
    return {
      ...base,
      own: {
        ...own,
        approximated: false,
        basis: 'vendor-only',
      },
    };
  }

  /*
   * The reconstructed pool.
   *
   * Each vendor store contributes its published median once per listing it
   * holds - the only weighting the shipped aggregates support - and each of
   * your observations contributes its real per-fish price once. Stores with a
   * zero median are skipped: the builder writes 0 for "no priced listing here",
   * which is an absence, not a free fish.
   */
  const vendorPoints: number[] = [];
  for (const s of base.stores) {
    if (s.medianPrice > 0 && s.listings > 0) {
      for (let i = 0; i < s.listings; i++) vendorPoints.push(s.medianPrice);
    }
  }
  const approximated = vendorPoints.length > 0;
  const pool = [...vendorPoints, ...usable.map((p) => p.unitPrice)];

  // The vendor index's own floor, applied unchanged: three points before any
  // median is published, whoever supplied them.
  const enough = pool.length >= opts.minimumSampleCount;

  const ownStore = {
    storeId: OWN_RECORDS_STORE_ID,
    listings: usable.length,
    inStock: 0,
    medianPrice: round2(median(usable.map((p) => p.unitPrice))),
  };

  return {
    ...base,
    comparableCount: base.comparableCount + usable.length,
    totalListings: base.totalListings + usable.length,
    stores: [...base.stores.filter((s) => s.storeId !== OWN_RECORDS_STORE_ID), ownStore],
    priceBySize: mergeSizeBands(base.priceBySize, usable),
    ...(enough
      ? {
          price: {
            median: round2(median(pool)),
            min: round2(Math.min(...pool)),
            max: round2(Math.max(...pool)),
            currency: opts.currency,
          },
        }
      : {}),
    own: {
      ...own,
      approximated,
      basis: approximated ? 'blended' : 'own-only',
    },
  };
}

/**
 * Put each sized observation in the whole-inch band a buyer would call it.
 *
 * Floor, not round, matching the index builder exactly - a 4.25in fish is in
 * the 4in band in both places or the two disagree about the same fish.
 */
function mergeSizeBands(
  bands: MarketSpeciesStats['priceBySize'],
  points: OwnPricePoint[],
): MarketSpeciesStats['priceBySize'] {
  const sized = points.filter((p) => p.sizeIn !== undefined);
  if (sized.length === 0) return bands;

  /*
   * Grouped first, then merged once per band.
   *
   * Folding observations in one at a time and re-taking the median each step
   * is wrong, and quietly: $180, $200 and $240 in an empty band come out at
   * $190 rather than $200, because step two's median becomes step three's
   * input. The keeper's own values are all in hand, so nothing here needs to
   * approximate - only the vendor side does.
   */
  const mine = new Map<number, number[]>();
  for (const p of sized) {
    const band = Math.max(0, Math.floor(p.sizeIn!));
    const list = mine.get(band);
    if (list) list.push(p.unitPrice);
    else mine.set(band, [p.unitPrice]);
  }

  const byBand = new Map(bands.map((b) => [b.sizeIn, { ...b }]));
  for (const [band, prices] of mine) {
    const existing = byBand.get(band);
    if (!existing) {
      byBand.set(band, { sizeIn: band, medianPrice: round2(median(prices)), listings: prices.length });
      continue;
    }
    // Same reconstruction as the headline: the band's published median stands
    // in for its listings, then every observation of yours joins them at once.
    const pool = [
      ...Array.from({ length: existing.listings }, () => existing.medianPrice),
      ...prices,
    ];
    existing.medianPrice = round2(median(pool));
    existing.listings += prices.length;
  }
  return [...byBand.values()].sort((a, b) => a.sizeIn - b.sizeIn);
}

/**
 * Market availability and price reference - PRD 4.5, FR-P05/FR-P06.
 *
 * Deliberately a separate panel from Discovery. FR-P05: "Online availability
 * never increases collecting rarity in the MVP." A fish that three mail-order
 * shops always stock may still be one Ryan has never seen in a Chicago
 * store - those are different facts and the UI keeps them apart.
 *
 * The redesign's one change here is that every drawn number says how much it
 * is standing on. The price ladder used to be eight smooth bars scaled to the
 * maximum, which reads as a distribution; seven of those eight bands routinely
 * hold a single listing. Each band now prints its own n, and a band under the
 * index's own minimum sample count is drawn thin, so the chart cannot assert a
 * comparison the engine itself declines to make.
 */
import type { LengthMeasurement } from '@/domain/types';
import { formatLength } from '@/domain/units';
import {
  bandForSize, hasPriceEstimate, isStale, marketAgeDays, marketFor, MARKET_INDEX,
  STORE_NAMES, scarcityFor,
} from '@/data/market';
import { SCARCITY_COMPONENT_LABELS } from '@/engine/rarity/market-scarcity';
import { ScarcityBadge } from './Badges';
import { ArrowSquareOutIcon, ClockIcon } from './Icons';

interface Props {
  speciesId?: string;
  /** The size of the fish in front of you, used to pick the comparable band. */
  observedSize?: LengthMeasurement;
  /** What the store is asking, for a like-for-like comparison. */
  yourPrice?: number;
}

export function MarketPanel({ speciesId, observedSize, yourPrice }: Props) {
  const stats = marketFor(speciesId);
  if (!stats) {
    return (
      <section className="panel">
        <h2 className="sec-head">Market reference</h2>
        <div className="state">
          <p className="state__head">Nothing listed</p>
          <p className="state__body">
            No listing for this species matched across the {MARKET_INDEX.sources.length} tracked stores.
            That is not a scarcity signal: most listing titles do not resolve to a known species, so
            absence here almost always means the title did not match, not that the fish is rare.
          </p>
        </div>
      </section>
    );
  }

  const band = bandForSize(stats, observedSize);
  const scarcity = scarcityFor(speciesId);
  const stale = isStale(stats);
  const ageDays = marketAgeDays(stats);
  const maxPrice = Math.max(...stats.priceBySize.map((b) => b.medianPrice), 1);
  /**
   * Whether we can say what it is worth, which is a separate question from
   * whether anyone sells it. Below the sample floor the references below are
   * still real - they are the whole reason the species is here - so the panel
   * renders them and simply declines to put a number at the top.
   */
  const estimated = hasPriceEstimate(stats);

  return (
    <section className="panel">
      <div className="spread" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 className="sec-head" style={{ margin: 0 }}>Market reference</h2>
        <span className="xs faint data">
          {stats.totalListings} listing{stats.totalListings === 1 ? '' : 's'} · {stats.stores.length} store
          {stats.stores.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* The size-matched comparison is the headline, not the pooled median. */}
      {estimated && band && (
        <>
          <p className="xs faint" style={{ marginBottom: 'var(--space-1)' }}>
            At {formatLength(observedSize)}, these stores listed it around
          </p>
          <p className="figure">
            ${band.medianPrice.toFixed(2)}
            <small>
              n={band.listings} in the {band.sizeIn}″ band
              {yourPrice !== undefined && (
                <> · you recorded ${yourPrice.toFixed(2)}
                  {yourPrice > band.medianPrice
                    ? ` (${Math.round(((yourPrice - band.medianPrice) / band.medianPrice) * 100)}% higher)`
                    : yourPrice < band.medianPrice
                      ? ` (${Math.round(((band.medianPrice - yourPrice) / band.medianPrice) * 100)}% lower)`
                      : ' (the same)'}
                </>
              )}
            </small>
          </p>
        </>
      )}

      {/* Below the sample floor there is no headline number, and the panel says
          why in the same breath rather than leaving a blank where a price
          should be. The stores are listed regardless. */}
      {!estimated && (
        <div className="state">
          <p className="state__head">No price estimate for this one</p>
          <p className="state__body">
            {stats.comparableCount === 0
              ? `None of the ${stats.totalListings} listing${stats.totalListings === 1 ? '' : 's'} below states a size, and a price without a size compares a juvenile against an adult.`
              : `Only ${stats.comparableCount} of the ${stats.totalListings} listings state a size, below the ${MARKET_INDEX.minimumSampleCount} needed to estimate from.`}
            {' '}What the stores are asking is shown below, unaveraged.
          </p>
        </div>
      )}

      {estimated && !band && (
        <p className="panel__note" style={{ marginTop: 0 }}>
          {observedSize
            ? `No listings in the ${Math.floor(Number(formatLength(observedSize).replace(/[^\d.]/g, '')))}″ band, so no size-matched comparison.`
            : 'Record an approximate size to compare against the right price band.'}
        </p>
      )}

      {/* The ladder. Every band carries its own n, and a band that is only one
          listing is drawn as the hairline it is. */}
      {estimated && stats.priceBySize.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <p className="sec-head">Price by size</p>
          <div className="pbs">
            {stats.priceBySize.map((b) => {
              const thin = b.listings < MARKET_INDEX.minimumSampleCount;
              const you = b.sizeIn === band?.sizeIn;
              return (
                <div key={b.sizeIn} style={{ display: 'contents' }}>
                  <span className="pbs__label">{b.sizeIn}″</span>
                  <span
                    aria-hidden="true"
                    className={`pbs__bar${you ? ' pbs__bar--you' : thin ? ' pbs__bar--thin' : ''}`}
                    style={{ width: `${Math.max(4, (b.medianPrice / maxPrice) * 100)}%` }}
                  />
                  <span className={`pbs__val${you ? ' pbs__val--you' : ''}`}>${b.medianPrice.toFixed(0)}</span>
                  <span className="pbs__n">n={b.listings}</span>
                </div>
              );
            })}
          </div>
          <p className="panel__note panel__note--tight">
            Bands under n={MARKET_INDEX.minimumSampleCount} are drawn thin: one listing is a price, not a market.
          </p>
        </div>
      )}

      {/* Auto-populated scarcity. Deliberately its own rating, not folded into
          the Discovery Tier - see market-scarcity.ts for why. */}
      {scarcity.available && (
        <details style={{ marginTop: 'var(--space-4)' }}>
          <summary className="spread" style={{ cursor: 'pointer', listStyle: 'none', minHeight: 'var(--tap-min)' }}>
            <span>
              <span className="xs faint" style={{ display: 'block' }}>Local-shelf scarcity</span>
              <ScarcityBadge band={scarcity.band} />
            </span>
            <span className="data">{scarcity.score} / 100</span>
          </summary>
          <dl className="kv" style={{ marginTop: 'var(--space-3)' }}>
            {(Object.keys(scarcity.components) as Array<keyof typeof scarcity.components>).map((k) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{SCARCITY_COMPONENT_LABELS[k]}</dt>
                {/* The depth nudge is negative. Never render "+-5". */}
                <dd>{scarcity.components[k] >= 0 ? '+' : ''}{scarcity.components[k]}</dd>
              </div>
            ))}
          </dl>
          <p className="panel__note panel__note--tight">
            How likely you are to find this on a shelf, measured across{' '}
            {scarcity.basis.witnessesTracked} general{' '}
            {scarcity.basis.witnessesTracked === 1 ? 'store' : 'stores'}
            {' '}({scarcity.basis.carriedBy.map((id) => STORE_NAMES[id] ?? id).join(', ')} carr
            {scarcity.basis.witnessesCarrying === 1 ? 'ies' : 'y'} it). Specialist importers are left out
            on purpose: they stock rarities as a matter of course, so their having one tells you nothing
            about whether you will see it locally.
          </p>
          <p className="xs faint data">Formula {scarcity.formulaVersion}</p>
        </details>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <p className="sec-head">{estimated ? 'Stores' : 'Stores carrying it'}</p>
        {stats.stores.map((s) => {
          const name = STORE_NAMES[s.storeId] ?? s.storeId;
          return (
            <div key={s.storeId} className="store">
              {/* Link out only when there is a real URL. The label says whether
                  the page is buyable, because most of this dataset is sold-out
                  back catalogue and a link that silently leads to an
                  unavailable listing is worse than no link. */}
              {s.productUrl ? (
                <a href={s.productUrl} target="_blank" rel="noopener noreferrer" className="store__name">
                  {name}
                  <ArrowSquareOutIcon size={12} aria-hidden="true" style={{ marginLeft: 4, verticalAlign: -1 }} />
                  <span className="visually-hidden">
                    {s.productInStock ? ' (opens the store listing, in stock)' : ' (opens the store listing, sold out)'}
                  </span>
                </a>
              ) : (
                <span>{name}</span>
              )}
              <span className={`store__flag${s.inStock > 0 ? '' : ' store__flag--out'}`}>
                {s.inStock > 0 ? `${s.inStock} in stock` : 'sold out'}
              </span>
              {/* A median where one is earned, otherwise the asking price of the
                  exact listing linked above, with the option it buys. "3 Fish ·
                  $41.99" must never be read as $41.99 a fish. */}
              <span className="store__price">
                {estimated && s.medianPrice > 0
                  ? `median $${s.medianPrice.toFixed(0)}`
                  : s.productPrice !== undefined
                    ? `$${s.productPrice.toFixed(2)}${s.productSizeLabel && s.productSizeLabel !== 'Default Title' ? ` (${s.productSizeLabel})` : ''}`
                    : `${s.listings} listing${s.listings === 1 ? '' : 's'}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Staleness is load-bearing: most of this dataset is sold-out back
          catalogue, and some of it is years old. Stale is not broken, so it
          reads calm rather than red. */}
      {stale && ageDays !== undefined && (
        <div className="state state--stale" style={{ marginTop: 'var(--space-4)', marginLeft: 0, marginRight: 0 }}>
          <p className="state__head">
            <ClockIcon size={16} aria-hidden="true" />
            About {Math.floor(ageDays / 365)} year{Math.floor(ageDays / 365) === 1 ? '' : 's'} old
          </p>
          <p className="state__body">
            These are listing prices from {stats.listedBetween!.latest}. Most are sold-out listings frozen
            at the price they were published at, so treat them as a historical reference, not today&apos;s market.
          </p>
        </div>
      )}

      <p className="panel__note panel__note--tight">
        Listed prices from {MARKET_INDEX.sources.map((s) => s.name).join(', ')}, collected{' '}
        {MARKET_INDEX.builtAt.slice(0, 10)}. Shipping and livestock guarantees are not included, and online
        availability deliberately does not affect your Discovery tier.
      </p>
    </section>
  );
}

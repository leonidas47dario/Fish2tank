/**
 * Market availability and price reference - PRD 4.5, FR-P05/FR-P06.
 *
 * Deliberately a separate panel from Discovery. FR-P05: "Online availability
 * never increases collecting rarity in the MVP." A fish that three mail-order
 * shops always stock may still be one Ryan has never seen in a Chicago
 * store - those are different facts and the UI keeps them apart.
 */
import type { LengthMeasurement } from '@/domain/types';
import { formatLength } from '@/domain/units';
import {
  bandForSize, hasPriceEstimate, isStale, marketAgeDays, marketFor, MARKET_INDEX,
  STORE_NAMES, scarcityFor,
} from '@/data/market';
import { SCARCITY_COMPONENT_LABELS } from '@/engine/rarity/market-scarcity';
import { ScarcityBadge } from './Badges';

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
      <section className="card stack">
        <h2>Market reference</h2>
        <p className="muted small">
          No listing for this species matched across the {MARKET_INDEX.sources.length} tracked stores.
        </p>
        <p className="xs muted" style={{ marginBottom: 0 }}>
          That is not a scarcity signal. Most listing titles do not resolve to a known species, so absence
          here almost always means the title did not match — not that the fish is rare.
        </p>
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
    <section className="card stack">
      <div className="spread">
        <h2 style={{ marginBottom: 0 }}>Market reference</h2>
        <span className="xs muted data">
          {stats.totalListings} listing{stats.totalListings === 1 ? '' : 's'} · {stats.stores.length} store
          {stats.stores.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Auto-populated scarcity. Deliberately its own rating, not folded into
          the Discovery Tier - see market-scarcity.ts for why. */}
      {scarcity.available && (
        <details className="card card--raised">
          <summary className="spread" style={{ cursor: 'pointer', listStyle: 'none' }}>
            <span>
              <span className="xs muted">Market scarcity</span><br />
              <ScarcityBadge band={scarcity.band} />
            </span>
            <span className="data">{scarcity.score} / 100</span>
          </summary>
          <dl className="kv" style={{ marginTop: 'var(--space-3)' }}>
            {(Object.keys(scarcity.components) as Array<keyof typeof scarcity.components>).map((k) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{SCARCITY_COMPONENT_LABELS[k]}</dt>
                <dd>+{scarcity.components[k]}</dd>
              </div>
            ))}
          </dl>
          <p className="xs muted" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
            How hard this is to buy from {MARKET_INDEX.sources.length} mail-order stores. That is a different
            question from how rarely you run into one locally, so it is kept out of your Discovery tier.
          </p>
          <p className="xs muted data" style={{ marginBottom: 0 }}>Formula {scarcity.formulaVersion}</p>
        </details>
      )}

      {/* Below the sample floor there is no headline number, and the panel
          says why in the same breath rather than leaving a blank where a
          price should be. The stores are listed regardless. */}
      {!estimated && (
        <div className="card card--raised">
          <p className="small" style={{ marginBottom: 'var(--space-1)' }}>
            No price estimate for this one.
          </p>
          <p className="xs muted" style={{ marginBottom: 0 }}>
            {stats.comparableCount === 0
              ? `None of the ${stats.totalListings} listing${stats.totalListings === 1 ? '' : 's'} below states a size, and a price without a size compares a juvenile against an adult.`
              : `Only ${stats.comparableCount} of the ${stats.totalListings} listings state a size, below the ${MARKET_INDEX.minimumSampleCount} needed to estimate from.`}
            {' '}What the stores are asking is shown below, unaveraged.
          </p>
        </div>
      )}

      {/* The size-matched comparison is the headline, not the pooled median. */}
      {!estimated ? null : band ? (
        <div className="card card--raised">
          <p className="xs muted" style={{ marginBottom: 'var(--space-1)' }}>
            At {formatLength(observedSize)}, these stores listed it around
          </p>
          <p className="data" style={{ fontSize: 'var(--size-xl)', marginBottom: 'var(--space-1)' }}>
            ${band.medianPrice.toFixed(2)}
          </p>
          <p className="xs muted" style={{ marginBottom: 0 }}>
            from {band.listings} listing{band.listings === 1 ? '' : 's'} in the {band.sizeIn}″ band
            {yourPrice !== undefined && (
              <> · you recorded ${yourPrice.toFixed(2)}
                {yourPrice > band.medianPrice
                  ? ` (${Math.round(((yourPrice - band.medianPrice) / band.medianPrice) * 100)}% higher)`
                  : yourPrice < band.medianPrice
                    ? ` (${Math.round(((band.medianPrice - yourPrice) / band.medianPrice) * 100)}% lower)`
                    : ' (the same)'}
              </>
            )}
          </p>
        </div>
      ) : (
        <p className="small muted">
          {observedSize
            ? `No listings in the ${Math.floor(Number(formatLength(observedSize).replace(/[^\d.]/g, '')))}″ band, so no size-matched comparison.`
            : 'Record an approximate size to compare against the right price band.'}
        </p>
      )}

      {/* The ladder. This is the part that is actually worth reading. */}
      {estimated && (
      <div>
        <p className="xs muted" style={{ marginBottom: 'var(--space-2)' }}>Price by size</p>
        <ul className="list">
          {stats.priceBySize.map((b) => (
            <li key={b.sizeIn} className="row" style={{ gap: 'var(--space-3)' }}>
              <span className="data xs" style={{ minWidth: '3.5em' }}>{b.sizeIn}″</span>
              <span
                aria-hidden="true"
                style={{
                  height: 6,
                  borderRadius: 'var(--radius-pill)',
                  background: b.sizeIn === band?.sizeIn ? 'var(--color-accent)' : 'var(--color-primary)',
                  opacity: b.sizeIn === band?.sizeIn ? 1 : 0.45,
                  width: `${Math.max(4, (b.medianPrice / maxPrice) * 100)}%`,
                }}
              />
              <span className="data xs">${b.medianPrice.toFixed(0)}</span>
            </li>
          ))}
        </ul>
      </div>
      )}

      <dl className="kv">
        <dt>Currently in stock</dt>
        <dd>{stats.inStock} of {stats.totalListings}</dd>
        <dt>Sold-out listings</dt>
        <dd>{stats.soldOut}</dd>
        {stats.sizeRangeIn && (<><dt>Sizes seen</dt><dd>{stats.sizeRangeIn.min}″–{stats.sizeRangeIn.max}″</dd></>)}
      </dl>

      <div>
        <p className="xs muted" style={{ marginBottom: 'var(--space-2)' }}>
          {estimated ? 'Stores' : 'Stores carrying it'}
        </p>
        <ul className="list">
          {stats.stores.map((s) => {
            const name = STORE_NAMES[s.storeId] ?? s.storeId;
            return (
              <li key={s.storeId} className="spread xs">
                {/* Link out only when there is a real URL. The label says
                    whether the page is buyable, because most of this dataset
                    is sold-out back catalogue and a link that silently leads
                    to an unavailable listing is worse than no link. */}
                {s.productUrl ? (
                  <a
                    href={s.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="store-link"
                  >
                    {name}
                    <span aria-hidden="true"> ↗</span>
                    <span className="visually-hidden">
                      {s.productInStock ? ' (opens the store listing, in stock)' : ' (opens the store listing, sold out)'}
                    </span>
                  </a>
                ) : (
                  <span>{name}</span>
                )}
                {/* A median where one is earned, otherwise the asking price of
                    the exact listing linked above, with the option it buys.
                    "3 Fish · $41.99" must never be read as $41.99 a fish. */}
                <span className="data">
                  {s.listings} listing{s.listings === 1 ? '' : 's'}
                  {estimated && s.medianPrice > 0
                    ? ` · median $${s.medianPrice.toFixed(0)}`
                    : s.productPrice !== undefined
                      ? ` · $${s.productPrice.toFixed(2)}${s.productSizeLabel ? ` (${s.productSizeLabel})` : ''}`
                      : ''}
                  {s.inStock > 0 && ` · ${s.inStock} in stock`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Staleness is load-bearing: most of this dataset is sold-out back
          catalogue, and some of it is years old. */}
      {stale && ageDays !== undefined && (
        <p className="warn">
          These are listing prices from {stats.listedBetween!.latest}, about {Math.floor(ageDays / 365)} year
          {Math.floor(ageDays / 365) === 1 ? '' : 's'} old. Most are sold-out listings frozen at the price they
          were published at, so treat them as a historical reference, not today's market.
        </p>
      )}

      <p className="xs muted" style={{ marginBottom: 0 }}>
        Listed prices from {MARKET_INDEX.sources.map((s) => s.name).join(', ')}, collected{' '}
        {MARKET_INDEX.builtAt.slice(0, 10)}. Shipping and livestock guarantees are not included, and online
        availability deliberately does not affect your Discovery tier.
      </p>
    </section>
  );
}

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
  bandForSize, isStale, marketAgeDays, marketFor, MARKET_INDEX, STORE_NAMES,
} from '@/data/market';

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
        <p className="muted small" style={{ marginBottom: 0 }}>
          No listings for this species across the {MARKET_INDEX.sources.length} tracked stores, or too few
          to compare ({MARKET_INDEX.minimumSampleCount} needed). Nothing is estimated from an empty sample.
        </p>
      </section>
    );
  }

  const band = bandForSize(stats, observedSize);
  const stale = isStale(stats);
  const ageDays = marketAgeDays(stats);
  const maxPrice = Math.max(...stats.priceBySize.map((b) => b.medianPrice), 1);

  return (
    <section className="card stack">
      <div className="spread">
        <h2 style={{ marginBottom: 0 }}>Market reference</h2>
        <span className="xs muted data">{stats.comparableCount} listings</span>
      </div>

      {/* The size-matched comparison is the headline, not the pooled median. */}
      {band ? (
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

      <dl className="kv">
        <dt>Currently in stock</dt>
        <dd>{stats.inStock} of {stats.totalListings}</dd>
        <dt>Sold-out listings</dt>
        <dd>{stats.soldOut}</dd>
        {stats.sizeRangeIn && (<><dt>Sizes seen</dt><dd>{stats.sizeRangeIn.min}″–{stats.sizeRangeIn.max}″</dd></>)}
      </dl>

      <div>
        <p className="xs muted" style={{ marginBottom: 'var(--space-2)' }}>Stores</p>
        <ul className="list">
          {stats.stores.map((s) => (
            <li key={s.storeId} className="spread xs">
              <span>{STORE_NAMES[s.storeId] ?? s.storeId}</span>
              <span className="data">
                {s.listings} listing{s.listings === 1 ? '' : 's'} · median ${s.medianPrice.toFixed(0)}
                {s.inStock > 0 && ` · ${s.inStock} in stock`}
              </span>
            </li>
          ))}
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

/**
 * A tank, drawn from what it contains. Nothing here reads a database.
 *
 * Lifted out of `TankDetail.tsx` (spec 023) so that two callers can render the
 * same tank the same way: the keeper's live screen, and the public page a
 * stranger opens. A copy would have been faster and would have drifted within
 * a month - the guest's version quietly losing whatever the owner's gained.
 *
 * PROPS ONLY, DELIBERATELY. A guest has no Dexie, no catalog lookups for the
 * fish in somebody else's tank, and no account. Everything these components
 * need therefore has to arrive as data, which is also what makes them the only
 * part of the tank screen that can be reasoned about without a database.
 *
 * Everything that WRITES stayed behind in `TankDetail.tsx`. That separation is
 * the original point of the viewer, and it is now enforced by the module
 * boundary rather than by a docstring.
 */
import { Fragment, useState, type ReactNode } from 'react';
import { AGGRESSION_LABEL, forDisplay, type TankResident, type TankStats } from '@/domain/tank-stats';
import { TileArt } from '../TileArt';
import type { Id } from '@/domain/types';

/**
 * A resident as a SCREEN draws it - spec 053.
 *
 * `ownMediaId` is the keeper's own photograph of this exact fish, which the
 * owner's hook supplies and the shared page never does: `TankResident` is what
 * a projection publishes, and spec 023 keeps private photos out of it.
 */
export type ViewerResident = TankResident & { ownMediaId?: Id };
import {
  applyTankFilter, countFish, isEmptyFilter, toggleFilter,
  type TankFilter, type TankFilterDimension,
} from '@/domain/tank-filter';

/**
 * What a chart needs to be tappable - spec 049.
 *
 * Absent means the chart is static, which is what the shared page's
 * server-rendered snapshot and any future read-only surface get. A static
 * chart keeps the `role="img"` summary it has always had; an interactive one
 * MUST NOT have it, because `role="img"` collapses its whole subtree and a
 * button inside one is unreachable to a screen reader.
 */
interface Selectable {
  selected?: string;
  onSelect?: (dimension: TankFilterDimension, value: string) => void;
}

export interface TankViewerProps {
  tankName: string;
  residents: ViewerResident[];
  stats: TankStats;
  /**
   * What a resident tile does when tapped, or nothing for a plain tile.
   *
   * The owner's screen links to the species page or opens the editor; the
   * shared page intercepts the tap to offer an account. Neither behaviour
   * belongs in here.
   */
  renderTile?: (resident: ViewerResident, content: ReactNode) => ReactNode;
  /**
   * One more tile at the end of the grid. This is the owner's "Add a fish",
   * which has to sit *inside* the grid rather than under it - "add a fish"
   * belongs where the fish are, and it is the only thing in an empty tank.
   */
  extraTile?: ReactNode;
  /** Slotted under the grid: the editor panel, or the guest's sign-up prompt. */
  children?: ReactNode;
}

export function TankViewer({
  tankName, residents, stats, renderTile, extraTile, children,
}: TankViewerProps) {
  /*
   * Spec 049. A filter is a question you are asking right now, not a setting,
   * so it lives in component state and clears on leaving. Nothing is
   * persisted, and nothing about the tank is written.
   */
  const [filter, setFilter] = useState<TankFilter>({});
  const select = (dimension: TankFilterDimension, value: string) =>
    setFilter((f) => toggleFilter(f, dimension, value));

  // An empty tank still needs its way in, or a new tank is a dead end.
  if (stats.fish === 0) {
    return (
      <div className="stack">
        <p className="empty">Nothing lives in {tankName} yet.</p>
        {extraTile && <div className="tank-grid">{extraTile}</div>}
        {children}
      </div>
    );
  }

  const shown = applyTankFilter(residents, filter);
  const filtering = !isEmptyFilter(filter);

  return (
    <div className="stack">
      <StatRow stats={stats} />
      {/*
        THE CHARTS KEEP THEIR WHOLE-TANK NUMBERS while a filter is on. Redrawing
        them for the filtered set was the tempting version and is worse on a
        phone: the bar you meant to press next would move or vanish under your
        finger, and clearing back out would mean hunting for a control whose
        position had changed. Stable bars, a highlighted selection, and a count
        on the grid answer the same question without the ground moving.
      */}
      <WaterColumn stats={stats} selected={filter.zone} onSelect={select} />
      <Temperament stats={stats} selected={filter.aggression} onSelect={select} />
      <GrowsInto residents={residents} selected={filter.speciesId} onSelect={select} />
      <ResidentGrid
        residents={shown}
        renderTile={renderTile}
        // Hidden while filtering: "add a fish" inside a filtered grid would
        // add one that the filter may immediately hide again.
        extraTile={filtering ? undefined : extraTile}
        filterSummary={filtering ? (
          <FilterSummary
            filter={filter}
            stats={stats}
            // The name comes from the matched fish rather than from a second
            // catalog lookup: the viewer takes props only, and the residents
            // already carry the name the grid draws.
            speciesName={shown.find((r) => r.speciesId === filter.speciesId)?.commonName}
            shownFish={countFish(shown)}
            totalFish={stats.fish}
            onClear={() => setFilter({})}
          />
        ) : undefined}
      />
      {children}
    </div>
  );
}

/**
 * What is being shown, and the one way out.
 *
 * There is never a filtered grid without a visible reason for it: a grid
 * showing three of twenty-four fish with nothing saying why is indistinguishable
 * from a tank that lost twenty-one.
 */
function FilterSummary({ filter, stats, speciesName, shownFish, totalFish, onClear }: {
  filter: TankFilter;
  stats: TankStats;
  speciesName?: string;
  shownFish: number;
  totalFish: number;
  onClear: () => void;
}) {
  const labels = [
    stats.byZone.find((z) => z.key === filter.zone)?.label,
    filter.aggression
      && (filter.aggression === 'unknown'
        ? 'Not rated'
        : AGGRESSION_LABEL[filter.aggression as keyof typeof AGGRESSION_LABEL]),
    /*
     * Named, not "one species". The grid below is often scrolled out of view
     * on a phone by the time this line is read, and a summary that will not
     * say what it is filtering to is not a summary. Falls back only when the
     * selection matches nothing, where there is no name to give.
     */
    filter.speciesId && (speciesName ?? 'one species'),
  ].filter(Boolean) as string[];

  return (
    <div className="tankfilter" role="status">
      <span className="tankfilter__what">
        Showing <span className="data">{shownFish}</span> of{' '}
        <span className="data">{totalFish}</span>
        {labels.length > 0 && <> — {labels.join(' · ')}</>}
      </span>
      <button type="button" className="chip" onClick={onClear}>Clear</button>
    </div>
  );
}

/**
 * The headline numbers.
 *
 * Stat tiles rather than a chart: four unrelated single values have no shared
 * scale, so a bar chart of them would invite comparisons that mean nothing.
 */
export function StatRow({ stats }: { stats: TankStats }) {
  return (
    <div className="stat-row">
      <div className="stat">
        <span className="stat__value data">{stats.fish}</span>
        <span className="stat__label">fish</span>
      </div>
      <div className="stat">
        <span className="stat__value data">{stats.species}</span>
        <span className="stat__label">species</span>
      </div>
      <div className="stat">
        <span className="stat__value data">
          {stats.estimatedValue === undefined ? '—' : `$${Math.round(stats.estimatedValue).toLocaleString()}`}
        </span>
        <span className="stat__label">
          {stats.estimatedValue === undefined ? 'no market data' : 'est. value'}
        </span>
        {/*
          Spec 051. THE CAVEAT BELONGS ON THE NUMBER IT QUALIFIES.

          This used to live in a "What this leaves out" section at the foot of
          the page, which is gone. Its other note - that unidentified fish sit
          outside every chart - was redundant with the "Not recorded" bar each
          chart already draws, and tappable since spec 049. This one was not:
          nothing else on the page says the estimate covers only part of the
          tank, so dropping it would leave a money figure presented as the
          tank's value while covering nineteen of twenty-four fish. That is a
          plausible number standing in as fact, which P6 forbids.

          Silent when it covers everything - a caveat that is always there is
          one nobody reads.
        */}
        {stats.estimatedValue !== undefined && stats.unvaluedFish > 0 && (
          <span className="stat__note data">
            covers {stats.valuedFish} of {stats.fish}
          </span>
        )}
      </div>
      {stats.largest && (
        <div className="stat">
          <span className="stat__value data">{Math.round(stats.largest.adultSizeIn)}″</span>
          <span className="stat__label">biggest, grown</span>
        </div>
      )}
    </div>
  );
}

/**
 * Where everyone actually swims, drawn as the tank rather than as a bar chart.
 *
 * WHY NO COLOUR RAMP. The bands are stacked top-to-bottom in the order the
 * fish occupy them, so the geometry already encodes the ordering. Colouring
 * them as well would spend the identity channel re-encoding what position
 * shows - and it is the one chart here whose meaning a guest gets instantly
 * without reading a legend, because it is shaped like the thing on the wall.
 */
export function WaterColumn({ stats, selected, onSelect }: { stats: TankStats } & Selectable) {
  const max = Math.max(...stats.byZone.map((z) => z.fish));

  /*
   * Spec 049. `role="img"` COLLAPSES ITS SUBTREE, so a button inside one is
   * never announced. An interactive chart therefore drops it and each band
   * carries its own label and pressed state; a static one keeps the summary it
   * has always had, so the shared page loses nothing.
   */
  const interactive = Boolean(onSelect);
  const wrap = interactive
    ? {}
    : { role: 'img', 'aria-label': stats.byZone.map((z) => `${z.label}: ${z.fish} fish`).join(', ') };

  return (
    <section className="card stack">
      <h2>Where they swim</h2>
      <div className="watercolumn" {...wrap}>
        {stats.byZone.map((z) => {
          const on = selected === z.key;
          const body = (
            <>
              <span className="watercolumn__label">{z.label}</span>
              <span className="watercolumn__track">
                <span className="watercolumn__fill" style={{ width: `${(z.fish / max) * 100}%` }} />
              </span>
              <span className="watercolumn__value data">{z.fish}</span>
            </>
          );
          if (!interactive) {
            return <div key={z.key} className="watercolumn__band">{body}</div>;
          }
          return (
            <button
              key={z.key}
              type="button"
              className={`watercolumn__band watercolumn__band--tappable${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={`${z.label}, ${z.fish} fish`}
              onClick={() => onSelect!('zone', z.key)}
            >
              {body}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Temperament mix.
 *
 * Reuses the app's existing severity vocabulary (the badge tones), because a
 * second visual language for the same idea is how a design system rots. Every
 * segment carries its label, so colour is never the only cue (NFR-06).
 */
const AGGRESSION_TONE: Record<string, string> = {
  peaceful: 'suitable',
  'semi-aggressive': 'conditional',
  aggressive: 'high-risk',
  'highly-aggressive': 'extreme-risk',
  unknown: 'insufficient-data',
};

export function Temperament({ stats, selected, onSelect }: { stats: TankStats } & Selectable) {
  if (stats.byAggression.length === 0) return null;
  const interactive = Boolean(onSelect);
  const nameOf = (key: string) => (key === 'unknown'
    ? 'Not rated'
    : AGGRESSION_LABEL[key as keyof typeof AGGRESSION_LABEL]);

  return (
    <section className="card stack">
      <h2>Temperament</h2>

      {/* The stacked bar stays decorative even when interactive: a 6px sliver
          is not a tap target anybody can hit, and the legend row beneath it
          carries the same selection at a size a thumb can land on. */}
      <div className="segbar" role="img"
        aria-label={stats.byAggression.map((a) => `${a.label}: ${a.fish} fish`).join(', ')}>
        {stats.byAggression.map((a) => (
          <span
            key={a.key}
            className={`segbar__seg segbar__seg--${AGGRESSION_TONE[a.key]}${selected === a.key ? ' is-on' : ''}`}
            style={{ flexGrow: a.fish }}
          />
        ))}
      </div>

      <ul className="legend">
        {stats.byAggression.map((a) => {
          const on = selected === a.key;
          const body = (
            <>
              <span className={`legend__swatch legend__swatch--${AGGRESSION_TONE[a.key]}`} aria-hidden="true" />
              {nameOf(a.key)}
              <span className="muted data"> {a.fish}</span>
            </>
          );
          return (
            <li key={a.key}>
              {interactive ? (
                <button
                  type="button"
                  className={`legend__btn${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  aria-label={`${nameOf(a.key)}, ${a.fish} fish`}
                  onClick={() => onSelect!('aggression', a.key)}
                >
                  {body}
                </button>
              ) : body}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * What the tank becomes.
 *
 * Magnitude, low to high, so one hue and a length - and the single most
 * useful thing a keeper can show a guest, because the two-inch fish in front
 * of them is a fourteen-inch fish later.
 */
export function GrowsInto({ residents, selected, onSelect }: {
  residents: TankResident[];
} & Selectable) {
  const withSize = residents.filter((r) => r.adultSizeIn !== undefined)
    .sort((a, b) => b.adultSizeIn! - a.adultSizeIn!);
  const sized = withSize.slice(0, 8);
  if (sized.length === 0) return null;
  const max = Math.max(...sized.map((r) => r.adultSizeIn!));

  return (
    <section className="card stack">
      <h2>Grown up</h2>
      <p className="xs muted" style={{ marginBottom: 0 }}>
        {withSize.length > sized.length
          ? `The ${sized.length} that grow biggest, at adult size.`
          : 'Adult size each of these reaches.'}
      </p>
      <div className="bars">
        {sized.map((r) => {
          const body = (
            <>
              <span className="bars__label">{r.commonName}</span>
              <span className="bars__track">
                <span className="bars__fill" style={{ width: `${(r.adultSizeIn! / max) * 100}%` }} />
              </span>
              <span className="bars__value data">{Math.round(r.adultSizeIn!)}″</span>
            </>
          );
          // A row with no species has nothing to filter TO: the grid keys on
          // speciesId, so an unresolved label would select nothing at all.
          if (!onSelect || !r.speciesId) {
            return <div key={r.holding.id} className="bars__row">{body}</div>;
          }
          const on = selected === r.speciesId;
          return (
            <button
              key={r.holding.id}
              type="button"
              className={`bars__row bars__row--tappable${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={`${r.commonName}, ${Math.round(r.adultSizeIn!)} inches grown`}
              onClick={() => onSelect('speciesId', r.speciesId!)}
            >
              {body}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** What one fish looks like on the grid. Shared so both callers agree. */
export function ResidentTileContent({ resident }: { resident: ViewerResident }) {
  return (
    <>
      {/*
        Spec 053. The keeper's own photograph loads through `TileArt`, which
        owns one media at one size and paints the box before the picture
        arrives - so the grid appears at once rather than after every blob has
        been read. `artUrl` is the bundled portrait, or on the shared page an
        ordinary http URL, and both are already instant.
      */}
      {resident.ownMediaId
        ? <TileArt mediaId={resident.ownMediaId} className="tank-tile__art" />
        : resident.artUrl
          ? <img className="tank-tile__art" src={resident.artUrl} alt="" loading="lazy" />
          : <span className="tank-tile__art tank-tile__art--empty" aria-hidden="true">◍</span>}
      <span className="tank-tile__body">
        <strong>{resident.commonName}</strong>
        {resident.quantity > 1 && <span className="muted data"> ×{resident.quantity}</span>}
        {resident.scientificName && (
          <><br /><span className="sci xs">{resident.scientificName}</span></>
        )}
      </span>
    </>
  );
}

/**
 * The fish themselves - the part anybody looking at a tank actually wants.
 *
 * `renderTile` decides what a tap does. Without one the tiles are plain, which
 * is the honest default: a dead link in front of a guest is worse than no
 * link at all.
 */
export function ResidentGrid({ residents, renderTile, extraTile, filterSummary }: {
  residents: ViewerResident[];
  renderTile?: TankViewerProps['renderTile'];
  extraTile?: ReactNode;
  /** Spec 049. What the filter is showing, and the way out of it. */
  filterSummary?: ReactNode;
}) {
  const shown = forDisplay(residents);
  return (
    <section className="stack">
      <h2>Who lives here</h2>
      {filterSummary}
      {/* A combination that matches nothing says so. An empty grid under a
          heading reads as an empty tank. */}
      {filterSummary && shown.length === 0 && (
        <p className="empty muted">No fish match that. Clear the filter to see them all.</p>
      )}
      <div className="tank-grid">
        {/* A Fragment, not a wrapper element: `.tank-grid` lays out its DIRECT
            children, so anything in between would collapse the grid. */}
        {shown.map((r) => {
          const content = <ResidentTileContent resident={r} />;
          return (
            <Fragment key={r.holding.id}>
              {renderTile
                ? renderTile(r, content)
                : <div className="tank-tile tank-tile--plain">{content}</div>}
            </Fragment>
          );
        })}
        {extraTile}
      </div>
    </section>
  );
}


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
import { Fragment, type ReactNode } from 'react';
import { AGGRESSION_LABEL, forDisplay, type TankResident, type TankStats } from '@/domain/tank-stats';

export interface TankViewerProps {
  tankName: string;
  residents: TankResident[];
  stats: TankStats;
  /**
   * What a resident tile does when tapped, or nothing for a plain tile.
   *
   * The owner's screen links to the species page or opens the editor; the
   * shared page intercepts the tap to offer an account. Neither behaviour
   * belongs in here.
   */
  renderTile?: (resident: TankResident, content: ReactNode) => ReactNode;
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

  return (
    <div className="stack">
      <StatRow stats={stats} />
      <WaterColumn stats={stats} />
      <Temperament stats={stats} />
      <GrowsInto residents={residents} />
      <ResidentGrid residents={residents} renderTile={renderTile} extraTile={extraTile} />
      {children}
      <Coverage stats={stats} />
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
export function WaterColumn({ stats }: { stats: TankStats }) {
  const max = Math.max(...stats.byZone.map((z) => z.fish));
  return (
    <section className="card stack">
      <h2>Where they swim</h2>
      <div className="watercolumn" role="img"
        aria-label={stats.byZone.map((z) => `${z.label}: ${z.fish} fish`).join(', ')}>
        {stats.byZone.map((z) => (
          <div key={z.key} className="watercolumn__band">
            <span className="watercolumn__label">{z.label}</span>
            <span className="watercolumn__track">
              <span className="watercolumn__fill" style={{ width: `${(z.fish / max) * 100}%` }} />
            </span>
            <span className="watercolumn__value data">{z.fish}</span>
          </div>
        ))}
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

export function Temperament({ stats }: { stats: TankStats }) {
  if (stats.byAggression.length === 0) return null;
  return (
    <section className="card stack">
      <h2>Temperament</h2>
      <div className="segbar" role="img"
        aria-label={stats.byAggression.map((a) => `${a.label}: ${a.fish} fish`).join(', ')}>
        {stats.byAggression.map((a) => (
          <span key={a.key} className={`segbar__seg segbar__seg--${AGGRESSION_TONE[a.key]}`}
            style={{ flexGrow: a.fish }} />
        ))}
      </div>
      <ul className="legend">
        {stats.byAggression.map((a) => (
          <li key={a.key}>
            <span className={`legend__swatch legend__swatch--${AGGRESSION_TONE[a.key]}`} aria-hidden="true" />
            {a.key === 'unknown' ? 'Not rated' : AGGRESSION_LABEL[a.key as keyof typeof AGGRESSION_LABEL]}
            <span className="muted data"> {a.fish}</span>
          </li>
        ))}
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
export function GrowsInto({ residents }: { residents: TankResident[] }) {
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
        {sized.map((r) => (
          <div key={r.holding.id} className="bars__row">
            <span className="bars__label">{r.commonName}</span>
            <span className="bars__track">
              <span className="bars__fill" style={{ width: `${(r.adultSizeIn! / max) * 100}%` }} />
            </span>
            <span className="bars__value data">{Math.round(r.adultSizeIn!)}″</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** What one fish looks like on the grid. Shared so both callers agree. */
export function ResidentTileContent({ resident }: { resident: TankResident }) {
  return (
    <>
      {resident.artUrl
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
export function ResidentGrid({ residents, renderTile, extraTile }: {
  residents: TankResident[];
  renderTile?: TankViewerProps['renderTile'];
  extraTile?: ReactNode;
}) {
  const shown = forDisplay(residents);
  return (
    <section className="stack">
      <h2>Who lives here</h2>
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

/** What the dashboard could not speak for. Always shown when it is not zero. */
export function Coverage({ stats }: { stats: TankStats }) {
  const notes = [
    stats.unidentifiedFish > 0
      && `${stats.unidentifiedFish} of ${stats.fish} fish are recorded by name only and could not be matched to a species, so they are outside every chart above.`,
    stats.estimatedValue !== undefined && stats.unvaluedFish > 0
      && `The estimate covers ${stats.valuedFish} of ${stats.fish} fish; the rest have no market listing to price them from.`,
  ].filter(Boolean) as string[];
  if (notes.length === 0) return null;
  return (
    <section className="card stack">
      <h2 className="h3">What this leaves out</h2>
      {notes.map((n) => <p key={n} className="xs muted" style={{ marginBottom: 0 }}>{n}</p>)}
    </section>
  );
}

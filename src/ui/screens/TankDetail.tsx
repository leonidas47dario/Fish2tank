/**
 * One tank, two jobs.
 *
 * VIEW is the tank as you would show it to somebody standing in your living
 * room: what lives here, what it will grow into, what it is worth, and where
 * in the water each fish actually sits. Nothing on it changes a record.
 *
 * MANAGE is the keeping: move a fish, record a loss. Everything that writes.
 *
 * They are separate because they are used by different people at different
 * moments, and mixing them means a guest tapping around your tank can retire
 * a fish by accident.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data/db';
import { clearTankPhoto, moveHolding, recordDeath } from '@/data/repositories';
import { formatVolume } from '@/domain/units';
import type { Aquarium, StockingState } from '@/domain/types';
import {
  AGGRESSION_LABEL, forDisplay, summariseTank,
  type TankResident, type TankStats,
} from '@/domain/tank-stats';
import { useTankResidents } from '../hooks';

type Mode = 'view' | 'manage';

export default function TankDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('view');
  const data = useTankResidents(id);
  const allTanks = useLiveQuery(() => db.aquariums.toArray(), []);

  if (data === undefined) return <p className="muted">Loading…</p>;
  if (!data) return <p className="empty">No such tank.</p>;

  const { aquarium, residents } = data;
  const stats = summariseTank(residents);

  return (
    <div className="stack">
      <button type="button" className="btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/tanks')}>
        ← All tanks
      </button>

      <header className="stack">
        <h1 style={{ marginBottom: 0 }}>{aquarium.name}</h1>
        <p className="muted small data" style={{ marginBottom: 0 }}>
          {aquarium.volume ? formatVolume(aquarium.volume) : 'volume unrecorded'}
          {' · '}{stats.fish} fish · {stats.species} species
        </p>
      </header>

      <div className="filters" role="group" aria-label="Tank mode">
        <button type="button" className="chip" aria-pressed={mode === 'view'} onClick={() => setMode('view')}>
          Viewer
        </button>
        <button type="button" className="chip" aria-pressed={mode === 'manage'} onClick={() => setMode('manage')}>
          Manage
        </button>
      </div>

      {mode === 'view'
        ? <TankViewer aquarium={aquarium} residents={residents} stats={stats} />
        : <TankManage aquarium={aquarium} residents={residents} allTanks={allTanks ?? []} />}
    </div>
  );
}

// ── Viewer ───────────────────────────────────────────────────────────────

function TankViewer({ aquarium, residents, stats }: {
  aquarium: { name: string; volume?: { value: number; unit: string } };
  residents: TankResident[];
  stats: TankStats;
}) {
  if (stats.fish === 0) {
    return <p className="empty">Nothing lives in {aquarium.name} yet.</p>;
  }

  return (
    <div className="stack">
      <StatRow stats={stats} />
      <WaterColumn stats={stats} />
      <Temperament stats={stats} />
      <GrowsInto residents={residents} />
      <ResidentGrid residents={residents} />
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
function StatRow({ stats }: { stats: TankStats }) {
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
function WaterColumn({ stats }: { stats: TankStats }) {
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

function Temperament({ stats }: { stats: TankStats }) {
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
function GrowsInto({ residents }: { residents: TankResident[] }) {
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

/** The fish themselves — the part a guest actually wants to tap. */
function ResidentGrid({ residents }: { residents: TankResident[] }) {
  return (
    <section className="stack">
      <h2>Who lives here</h2>
      <div className="tank-grid">
        {forDisplay(residents).map((r) => {
          const inner = (
            <>
              {r.portraitUrl
                ? <img className="tank-tile__art" src={r.portraitUrl} alt="" loading="lazy" />
                : <span className="tank-tile__art tank-tile__art--empty" aria-hidden="true">◍</span>}
              <span className="tank-tile__body">
                <strong>{r.commonName}</strong>
                {r.quantity > 1 && <span className="muted data"> ×{r.quantity}</span>}
                {r.scientificName && <><br /><span className="sci xs">{r.scientificName}</span></>}
              </span>
            </>
          );
          return r.speciesId ? (
            <Link key={r.holding.id} to={`/species/${r.speciesId}`} className="tank-tile">{inner}</Link>
          ) : (
            // Not a link: there is nothing to open, and a dead link in front of
            // a guest is worse than an honest plain tile.
            <div key={r.holding.id} className="tank-tile tank-tile--plain">{inner}</div>
          );
        })}
      </div>
    </section>
  );
}

/** What the dashboard could not speak for. Always shown when it is not zero. */
function Coverage({ stats }: { stats: TankStats }) {
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

// ── Manage ───────────────────────────────────────────────────────────────

function TankManage({ aquarium, residents, allTanks }: {
  aquarium: Aquarium;
  residents: TankResident[];
  allTanks: Array<{ id: string; name: string }>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="stack">
      <section className="card stack">
        <div className="spread">
          <strong>Measurements</strong>
          <button type="button" className="btn--ghost" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
        {editing && <TankForm aquarium={aquarium} onDone={() => setEditing(false)} />}
        {aquarium.photoMediaId && (
          <button type="button" className="btn--ghost" onClick={() => void clearTankPhoto(aquarium.id)}>
            Remove tank photo
          </button>
        )}
      </section>

      {!aquarium.volume && (
        <p className="warn">
          Without a volume and footprint this tank can only ever return “Not enough data”. Measuring it
          once is what makes every future check real.
        </p>
      )}
      {residents.length === 0 && <p className="muted small">Empty.</p>}
      <ul className="list">
        {residents.map((r) => (
          <li key={r.holding.id} className="card card--raised stack">
            <div className="spread">
              <span>
                <strong>{r.holding.rawLabel ?? r.commonName}</strong>
                <span className="muted data"> ×{r.quantity}</span>
              </span>
            </div>
            <div className="row">
              <select
                defaultValue=""
                aria-label={`Move ${r.holding.rawLabel ?? r.commonName} to another tank`}
                onChange={(e) => { if (e.target.value) void moveHolding(r.holding.id, e.target.value); }}
              >
                <option value="" disabled>Move to…</option>
                {allTanks.filter((t) => t.id !== aquarium.id).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn--ghost"
                onClick={() => void recordDeath({ holdingId: r.holding.id, quantity: 1 })}
              >
                Record a loss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TankForm({ aquarium, onDone }: { aquarium: Aquarium; onDone: () => void }) {
  const [gallons, setGallons] = useState(aquarium.volume ? String(aquarium.volume.value) : '');
  const [l, setL] = useState(aquarium.dimensions ? String(aquarium.dimensions.length.value) : '');
  const [w, setW] = useState(aquarium.dimensions ? String(aquarium.dimensions.width.value) : '');
  const [h, setH] = useState(aquarium.dimensions ? String(aquarium.dimensions.height.value) : '');
  const [stocking, setStocking] = useState<StockingState | ''>(aquarium.stockingState ?? '');

  async function save() {
    const dims = l && w && h
      ? {
          length: { value: Number(l), unit: 'in' as const },
          width: { value: Number(w), unit: 'in' as const },
          height: { value: Number(h), unit: 'in' as const },
        }
      : undefined;
    await db.aquariums.update(aquarium.id, {
      volume: gallons ? { value: Number(gallons), unit: 'gal' } : undefined,
      dimensions: dims,
      stockingState: stocking || undefined,
    });
    onDone();
  }

  return (
    <div className="stack">
      <div>
        <label htmlFor={`vol-${aquarium.id}`}>Volume (gallons)</label>
        <input id={`vol-${aquarium.id}`} inputMode="decimal" value={gallons} onChange={(e) => setGallons(e.target.value)} />
      </div>
      <div className="row">
        <div className="grow"><label htmlFor={`l-${aquarium.id}`}>Length (in)</label>
          <input id={`l-${aquarium.id}`} inputMode="decimal" value={l} onChange={(e) => setL(e.target.value)} /></div>
        <div className="grow"><label htmlFor={`w-${aquarium.id}`}>Width</label>
          <input id={`w-${aquarium.id}`} inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} /></div>
        <div className="grow"><label htmlFor={`h-${aquarium.id}`}>Height</label>
          <input id={`h-${aquarium.id}`} inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} /></div>
      </div>
      <div>
        <label htmlFor={`stock-${aquarium.id}`}>How full does it feel?</label>
        <select id={`stock-${aquarium.id}`} value={stocking} onChange={(e) => setStocking(e.target.value as StockingState | '')}>
          <option value="">Not saying</option>
          <option value="low">Low</option>
          <option value="moderate">Moderate</option>
          <option value="crowded">Crowded</option>
        </select>
        <p className="xs muted">Your judgement, used as-is. Nothing here is turned into a bioload figure.</p>
      </div>
      <button type="button" className="btn--primary" onClick={() => void save()}>Save</button>
    </div>
  );
}

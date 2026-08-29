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
import {
  adjustHoldingQuantity, clearTankPhoto, deleteTank, moveHolding, planDeleteTank, recordDeath,
  searchSpecies, setAquariumStatus, stockTank,
  type DeleteTankPlan,
} from '@/data/repositories';
import { formatVolume } from '@/domain/units';
import type { Aquarium, Species, StockingState } from '@/domain/types';
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

      <TankLifecycle aquarium={aquarium} />

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
              {/* recordDeath has always written a negative delta and nothing
                  wrote a positive one, so buying three more of a fish you
                  already keep was unrecordable. */}
              <button
                type="button"
                className="btn--ghost"
                onClick={() => void adjustHoldingQuantity({ holdingId: r.holding.id, delta: 1 })}
              >
                Add one
              </button>
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

      <AddFish aquariumId={aquarium.id} tankName={aquarium.name} />
    </div>
  );
}

/**
 * Put a fish in this tank without going through the catch journey.
 *
 * The gap this fills: before spec 005 the only routes into a tank were the
 * inventory import and photographing a fish in a shop. A fish you already keep
 * and never photographed could not be recorded at all.
 *
 * Creates a holding and no specimen, on purpose. Holding.specimenId is
 * optional by design (FR-T02) and the species page mints a specimen the moment
 * you add a photo, so eagerly creating one here would duplicate that path and
 * invent an encounter that never happened.
 */
function AddFish({ aquariumId, tankName }: { aquariumId: string; tankName: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Species[]>([]);
  const [picked, setPicked] = useState<Species | undefined>();
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [added, setAdded] = useState<string | undefined>();

  const n = Number(qty);
  const validQty = Number.isInteger(n) && n >= 1;

  async function onSearch(value: string) {
    setQuery(value);
    setPicked(undefined);
    setMatches(value.trim() ? await searchSpecies(value) : []);
  }

  function reset() {
    setQuery(''); setMatches([]); setPicked(undefined); setQty('1'); setError(undefined);
  }

  async function save() {
    if (!picked) return;
    setBusy(true);
    setError(undefined);
    try {
      await stockTank({ aquariumId, speciesId: picked.id, rawLabel: picked.commonName, quantity: n });
      setAdded(`${picked.commonName} ×${n}`);
      reset();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[stock] add fish failed', { aquariumId, speciesId: picked.id, quantity: n, error: message });
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => { setOpen(true); setAdded(undefined); }}>
        ⊕  Add a fish
      </button>
    );
  }

  return (
    <div className="card stack">
      <div className="spread">
        <strong>Add a fish to {tankName}</strong>
        <button type="button" className="btn--ghost" onClick={() => { setOpen(false); reset(); }}>
          Done
        </button>
      </div>

      {added && <p className="xs muted">Added {added}.</p>}

      <div>
        <label htmlFor={`add-q-${aquariumId}`}>Which fish</label>
        <input
          id={`add-q-${aquariumId}`}
          value={picked ? picked.commonName : query}
          onChange={(e) => void onSearch(e.target.value)}
          placeholder="congo puffer, rocket gar, cory…"
        />
      </div>

      {!picked && matches.slice(0, 8).map((s) => (
        <button
          key={s.id} type="button" className="tankrow"
          onClick={() => { setPicked(s); setMatches([]); }}
        >
          <span className="grow">
            <span className="tankrow__name">{s.commonName}</span>
            {s.scientificName && (
              <span className="tankrow__meta sci" style={{ display: 'block' }}>{s.scientificName}</span>
            )}
          </span>
        </button>
      ))}

      {picked && (
        <>
          <div>
            <label htmlFor={`add-n-${aquariumId}`}>How many</label>
            <input
              id={`add-n-${aquariumId}`} inputMode="numeric" value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <p className="xs muted">
            Recorded as living in {tankName} from today. No photo is needed — add one later from the
            species page and it becomes this fish&apos;s own record.
          </p>
          {error && <p className="warn">{error}</p>}
          <button type="button" className="btn btn--primary" disabled={busy || !validQty} onClick={() => void save()}>
            {busy ? 'Adding…' : `Add ${validQty ? n : ''} ${picked.commonName}`.trim()}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Putting a tank away, in the two ways that are honest.
 *
 * RETIRE is the usual one, and the only one available once a fish has lived
 * here: the tank leaves the active list and every record that names it still
 * reads correctly. It is reversible in one tap.
 *
 * DELETE is for a tank that never held anything - one added by mistake. It asks
 * first, and the confirmation says what actually goes.
 *
 * When delete is refused, the reason from planDeleteTank is shown as-is rather
 * than the button simply being missing, because "why can't I?" is the question
 * a hidden control leaves unanswered.
 */
function TankLifecycle({ aquarium }: { aquarium: Aquarium }) {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<DeleteTankPlan>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const retired = aquarium.status === 'retired';

  async function ask() {
    setPlan(await planDeleteTank(aquarium.id));
    setConfirming(true);
  }

  async function confirm() {
    setBusy(true);
    try {
      const result = await deleteTank(aquarium.id);
      if (result.allowed) navigate('/tanks');
      else setPlan(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <strong>{retired ? 'Retired tank' : 'Putting this tank away'}</strong>

      {retired ? (
        <>
          <p className="small muted">
            Retired. It stays out of your active tanks, and everything that lived here still
            remembers it.
          </p>
          <button
            type="button"
            className="btn--ghost"
            onClick={() => void setAquariumStatus(aquarium.id, 'active')}
          >
            Set up again
          </button>
        </>
      ) : (
        <>
          <p className="small muted">
            Retiring keeps the tank and its history, and takes it out of your active list. You can
            set it up again at any time.
          </p>
          <button
            type="button"
            className="btn--ghost"
            onClick={() => void setAquariumStatus(aquarium.id, 'retired')}
          >
            Retire this tank
          </button>
        </>
      )}

      {!confirming ? (
        <button type="button" className="btn--ghost" onClick={() => void ask()}>
          Delete this tank…
        </button>
      ) : plan && !plan.allowed ? (
        <>
          <p className="warn small">{plan.reason}</p>
          <button type="button" className="btn--ghost" onClick={() => setConfirming(false)}>
            OK
          </button>
        </>
      ) : (
        <>
          <p className="warn small">
            Delete {aquarium.name}? No fish has ever lived here, so nothing but the tank
            {plan?.photo ? ' and its photo' : ''} goes. This cannot be undone.
          </p>
          <div className="row">
            <button type="button" className="btn--danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Deleting…' : 'Yes, delete it'}
            </button>
            <button type="button" className="btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function TankForm({ aquarium, onDone }: { aquarium: Aquarium; onDone: () => void }) {
  const [name, setName] = useState(aquarium.name);
  const [gallons, setGallons] = useState(aquarium.volume ? String(aquarium.volume.value) : '');
  const [l, setL] = useState(aquarium.dimensions ? String(aquarium.dimensions.length.value) : '');
  const [w, setW] = useState(aquarium.dimensions ? String(aquarium.dimensions.width.value) : '');
  const [h, setH] = useState(aquarium.dimensions ? String(aquarium.dimensions.height.value) : '');
  const [stocking, setStocking] = useState<StockingState | ''>(aquarium.stockingState ?? '');

  const trimmed = name.trim();

  async function save() {
    const dims = l && w && h
      ? {
          length: { value: Number(l), unit: 'in' as const },
          width: { value: Number(w), unit: 'in' as const },
          height: { value: Number(h), unit: 'in' as const },
        }
      : undefined;
    await db.aquariums.update(aquarium.id, {
      name: trimmed,
      volume: gallons ? { value: Number(gallons), unit: 'gal' } : undefined,
      dimensions: dims,
      stockingState: stocking || undefined,
    });
    onDone();
  }

  return (
    <div className="stack">
      <div>
        <label htmlFor={`name-${aquarium.id}`}>Name</label>
        <input
          id={`name-${aquarium.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
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
      <button
        type="button"
        className="btn--primary"
        disabled={!trimmed}
        onClick={() => void save()}
      >
        Save
      </button>
      {!trimmed && <p className="xs warn">A tank needs a name.</p>}
    </div>
  );
}

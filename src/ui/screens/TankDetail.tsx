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
 *
 * Since spec 019 the VIEW half lives in `components/tank/TankViewer.tsx`,
 * because the public shared page renders the very same components. This file
 * keeps everything that writes, and supplies what a tap should do.
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data/db';
import {
  adjustHoldingQuantity, clearTankPhoto, deleteTank, moveHolding, planDeleteTank, recordDeath,
  removeHolding, setAquariumStatus, stockTank,
  type DeleteTankPlan,
} from '@/data/repositories';
import { CATALOG, type CatalogSpecies } from '@/data/catalog';
import { identifyFromText } from '@/data/identify';
import { formatVolume } from '@/domain/units';
import type { Aquarium, StockingState } from '@/domain/types';
import { forDisplay, summariseTank, type TankResident, type TankStats } from '@/domain/tank-stats';
import { TankViewer } from '../components/tank/TankViewer';
import { useTankResidents } from '../hooks';

export default function TankDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
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

      {/* One switch, not two tabs.
​
          The tabs made editing a different screen: to add a fish you left the
          dashboard, worked in a list that showed none of it, and came back.
          Everything now happens on the page you are already looking at, and
          the switch decides whether it can be touched.

          Off by default and unlatched by every reload, because the reason it
          exists is the guest holding your phone. */}
      <div className="spread tankedit__bar">
        <span className="xs muted">{editing ? 'Editing — tap a fish to change it' : 'Viewing'}</span>
        <button
          type="button"
          className="chip"
          role="switch"
          aria-checked={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? '✓ Done' : '✎ Edit'}
        </button>
      </div>

      {editing && <TankProfile aquarium={aquarium} />}

      <OwnerTankView
        aquarium={aquarium}
        residents={residents}
        stats={stats}
        editing={editing}
        allTanks={allTanks ?? []}
      />

      {editing && <TankLifecycle aquarium={aquarium} />}
    </div>
  );
}

// ── Viewer ───────────────────────────────────────────────────────────────

/**
 * The dashboard, plus the two things only an owner may do to it.
 *
 * Every chart, the grid and the coverage note come from the shared viewer, so
 * the keeper's screen and the public page cannot drift apart. What is added
 * here is precisely the behaviour a guest must never have: a tile that opens
 * the editor, a tile that adds a fish, and the panels those open.
 */
function OwnerTankView({ aquarium, residents, stats, editing, allTanks }: {
  aquarium: Aquarium;
  residents: TankResident[];
  stats: TankStats;
  editing: boolean;
  allTanks: Array<{ id: string; name: string }>;
}) {
  const [openHolding, setOpenHolding] = useState<string>();
  const [adding, setAdding] = useState(false);

  const open = forDisplay(residents).find((r) => r.holding.id === openHolding);

  return (
    <TankViewer
      tankName={aquarium.name}
      residents={residents}
      stats={stats}
      renderTile={(r, content) => {
        // Editing: the tile edits. Not editing: it opens the species, as before.
        if (editing) {
          return (
            <button
              type="button"
              className={`tank-tile tank-tile--editable${openHolding === r.holding.id ? ' tank-tile--open' : ''}`}
              aria-expanded={openHolding === r.holding.id}
              onClick={() => setOpenHolding(openHolding === r.holding.id ? undefined : r.holding.id)}
            >
              {content}
            </button>
          );
        }
        return r.speciesId
          ? <Link to={`/species/${r.speciesId}`} className="tank-tile">{content}</Link>
          // Not a link: there is nothing to open, and a dead link in front of
          // a guest is worse than an honest plain tile.
          : <div className="tank-tile tank-tile--plain">{content}</div>;
      }}
      /* The plus is a tile in the same grid rather than a button below it,
         because "add a fish" belongs where the fish are - and an empty tank
         then shows a grid containing exactly one thing to do. */
      extraTile={editing ? (
        <button
          type="button"
          className="tank-tile tank-tile--add"
          onClick={() => { setAdding(true); setOpenHolding(undefined); }}
        >
          <span className="tank-tile__art tank-tile__art--empty" aria-hidden="true">＋</span>
          <span className="tank-tile__body"><strong>Add a fish</strong></span>
        </button>
      ) : undefined}
    >
      {/* A tile is small and a phone is smaller, so editing does NOT cram
          controls into every tile. Tapping one opens a panel for that fish
          alone: how many, where it lives, and out. */}
      {editing && open && (
        <ResidentEditor
          key={open.holding.id}
          resident={open}
          aquarium={aquarium}
          allTanks={allTanks}
          onDone={() => setOpenHolding(undefined)}
        />
      )}

      {editing && adding && (
        <AddFish
          aquariumId={aquarium.id}
          tankName={aquarium.name}
          onDone={() => setAdding(false)}
        />
      )}
    </TankViewer>
  );
}

/**
 * One fish, and everything you can do to it.
 *
 * "Take out of the tank" is the control this screen never had. The only way to
 * empty a slot was to record a loss, so a fish you rehomed, sold, or typed in
 * twice had to be filed as dead - which put it in Fish Heaven and then blocked
 * deleting its catch record. Removing and mourning are different acts and are
 * now different buttons, worded so nobody reaches for the wrong one.
 */
function ResidentEditor({ resident, aquarium, allTanks, onDone }: {
  resident: TankResident;
  aquarium: Aquarium;
  allTanks: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  /*
   * The panel sits under the grid, so tapping a fish in the first row of
   * twenty leaves its controls off-screen and the tap looks like it did
   * nothing. Bring it to the reader instead of making them hunt for it.
   */
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [resident.holding.id]);

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const name = resident.holding.rawLabel ?? resident.commonName;

  async function run(what: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      after?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[stock] ${what} failed`, { holdingId: resident.holding.id, error: message });
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" ref={panel}>
      <div className="spread">
        <strong>{name}</strong>
        <button type="button" className="btn--ghost" onClick={onDone}>Close</button>
      </div>

      <div className="spread">
        <span className="muted small">How many</span>
        <span className="row">
          <button
            type="button" className="btn--ghost" disabled={busy}
            aria-label={`One fewer ${name}`}
            onClick={() => void run('decrement', () =>
              adjustHoldingQuantity({ holdingId: resident.holding.id, delta: -1 }))}
          >
            −
          </button>
          <strong className="data" aria-live="polite">{resident.quantity}</strong>
          <button
            type="button" className="btn--ghost" disabled={busy}
            aria-label={`One more ${name}`}
            onClick={() => void run('increment', () =>
              adjustHoldingQuantity({ holdingId: resident.holding.id, delta: 1 }))}
          >
            +
          </button>
        </span>
      </div>

      {allTanks.length > 1 && (
        <div>
          <label htmlFor={`move-${resident.holding.id}`}>Move to another tank</label>
          <select
            id={`move-${resident.holding.id}`}
            defaultValue=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) void run('move', () => moveHolding(resident.holding.id, e.target.value), onDone);
            }}
          >
            <option value="" disabled>Choose a tank…</option>
            {allTanks.filter((t) => t.id !== aquarium.id).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="warn small">{error}</p>}

      {!confirming ? (
        <div className="row">
          <button
            type="button" className="btn--ghost" disabled={busy}
            onClick={() => void run('record a loss', () =>
              recordDeath({ holdingId: resident.holding.id, quantity: 1 }))}
          >
            Record a loss
          </button>
          <button type="button" className="btn--ghost" disabled={busy} onClick={() => setConfirming(true)}>
            Take out of tank…
          </button>
        </div>
      ) : (
        <>
          <p className="warn small">
            Take {name} out of {aquarium.name} entirely? This removes it from the tank and its
            stocking history. It is not recorded as a death, and any catch record and photos are
            kept.
          </p>
          <div className="row">
            <button
              type="button" className="btn--danger" disabled={busy}
              onClick={() => void run('remove', () => removeHolding(resident.holding.id), onDone)}
            >
              {busy ? 'Removing…' : 'Yes, take it out'}
            </button>
            <button type="button" className="btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The tank's own record, editable in place.
 *
 * Was behind the Manage tab with the residents; it is the tank's profile, so
 * it belongs at the top of the tank's page the moment editing is on.
 */
function TankProfile({ aquarium }: { aquarium: Aquarium }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card stack">
      <div className="spread">
        <strong>Tank profile</strong>
        <button type="button" className="btn--ghost" onClick={() => setOpen(!open)}>
          {open ? 'Done' : 'Edit'}
        </button>
      </div>
      {open && <TankForm aquarium={aquarium} onDone={() => setOpen(false)} />}
      {!aquarium.volume && (
        <p className="xs warn" style={{ marginBottom: 0 }}>
          Without a volume and footprint this tank can only ever return “Not enough data”.
        </p>
      )}
      {aquarium.photoMediaId && (
        <button type="button" className="btn--ghost" onClick={() => void clearTankPhoto(aquarium.id)}>
          Remove tank photo
        </button>
      )}
    </section>
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
function AddFish({ aquariumId, tankName, onDone }: {
  aquariumId: string; tankName: string; onDone: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, []);

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<CatalogSpecies[]>([]);
  const [picked, setPicked] = useState<CatalogSpecies | undefined>();
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [added, setAdded] = useState<string | undefined>();

  const n = Number(qty);
  const validQty = Number.isInteger(n) && n >= 1;

  /*
   * Searches the CATALOG, not the species table.
   *
   * The species table holds the 47 curated profiles that ship with care data;
   * the catalog holds 2,176. Searching the former meant "Congo Tetra" returned
   * nothing at all from the one control whose whole job is finding a fish, and
   * "tetra" offered two. stockTank stores the id and the resident list resolves
   * names through the catalog, so nothing downstream needed a species row for
   * this to work - it was only ever the wrong index.
   *
   * identifyFromText rather than a second matcher: it is what the identify
   * screen uses, so searching for a fish behaves the same way in both places.
   */
  function onSearch(value: string) {
    setQuery(value);
    setPicked(undefined);
    setMatches(
      value.trim()
        ? identifyFromText(value, CATALOG.species).slice(0, 8).map((c) => c.species)
        : [],
    );
  }

  function reset() {
    setQuery(''); setMatches([]); setPicked(undefined); setQty('1'); setError(undefined);
  }

  async function save() {
    if (!picked) return;
    setBusy(true);
    setError(undefined);
    try {
      await stockTank({ aquariumId, speciesId: picked.speciesId, rawLabel: picked.commonName, quantity: n });
      setAdded(`${picked.commonName} ×${n}`);
      reset();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[stock] add fish failed', { aquariumId, speciesId: picked.speciesId, quantity: n, error: message });
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" ref={panel}>
      <div className="spread">
        <strong>Add a fish to {tankName}</strong>
        <button type="button" className="btn--ghost" onClick={() => { reset(); onDone(); }}>
          Done
        </button>
      </div>

      {added && <p className="xs muted">Added {added}.</p>}

      <div>
        <label htmlFor={`add-q-${aquariumId}`}>Which fish</label>
        <input
          id={`add-q-${aquariumId}`}
          value={picked ? picked.commonName : query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="congo puffer, rocket gar, cory…"
        />
      </div>

      {!picked && matches.map((s) => (
        <button
          key={s.speciesId} type="button" className="tankrow"
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

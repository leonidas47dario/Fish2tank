/**
 * The tanks index - a way in, not a workspace.
 *
 * This screen used to render every tank's full resident list along with move
 * and record-a-loss controls, which is exactly what the Manage tab inside a
 * tank does. Two places doing the same job drift apart, and the list was the
 * wrong place for it anyway: a list answers "which tank?", not "what do I do
 * with this fish?".
 *
 * So it is a card per tank - a photo, the numbers worth seeing at a glance,
 * and a tap to open. Everything that writes lives one level down.
 */
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '@/data/db';
import { createAquarium, setTankPhoto } from '@/data/repositories';
import { formatVolume } from '@/domain/units';
import type { Aquarium, AquariumKind } from '@/domain/types';
import { useTankSummaries } from '../hooks';
import ShareSheet from '../components/ShareSheet';
import { ShareNetworkIcon } from '../components/Icons';

export default function Tanks() {
  const tanks = useTankSummaries();
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  // By name, because the underlying order is by generated id - which put a tank
  // you just added at an arbitrary point in the list, with nothing to say why.
  const byName = [...(tanks ?? [])].sort((a, b) => a.aquarium.name.localeCompare(b.aquarium.name));
  const active = byName.filter((t) => t.aquarium.status !== 'retired');
  const retired = byName.filter((t) => t.aquarium.status === 'retired');

  return (
    <div className="stack">
      <header>
        <h1>Tanks</h1>
        <p className="muted small">Your real aquariums, and who actually lives in them.</p>
      </header>

      {tanks === undefined && <p className="muted small">Loading…</p>}

      <div className="tanklist">
        {active.map(({ aquarium, stats, photoUrl }) => (
          <TankCard key={aquarium.id} aquarium={aquarium} stats={stats} photoUrl={photoUrl} />
        ))}
      </div>

      {tanks !== undefined && active.length === 0 && (
        <p className="muted small">No active tanks. Add one below.</p>
      )}

      {adding
        ? <NewTankForm onDone={() => setAdding(false)} />
        : (
          <button type="button" className="btn--primary" onClick={() => setAdding(true)}>
            Add a tank
          </button>
        )}

      {/* Retired tanks are still real records - out of the way, never hidden. */}
      {retired.length > 0 && (
        <section className="stack">
          <button type="button" className="btn--ghost" onClick={() => setShowRetired(!showRetired)}>
            {showRetired ? 'Hide' : 'Show'} retired ({retired.length})
          </button>
          {showRetired && (
            <div className="tanklist">
              {retired.map(({ aquarium, stats, photoUrl }) => (
                <TankCard key={aquarium.id} aquarium={aquarium} stats={stats} photoUrl={photoUrl} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const KINDS: Array<{ value: AquariumKind; label: string }> = [
  { value: 'display', label: 'Display tank' },
  { value: 'tote', label: 'Tote' },
  { value: 'quarantine', label: 'Quarantine' },
  { value: 'grow-out', label: 'Grow-out' },
  { value: 'pond', label: 'Pond' },
];

/**
 * Add a tank.
 *
 * Name and kind are all it asks for. Volume is offered but never required, and
 * dimensions are not asked for here at all - a tank you have just set up is
 * usually one you have not measured, and the Manage tab takes the measurements
 * whenever you have them. Screening reports what it is missing in the meantime,
 * which is the point of FR-E05.
 */
function NewTankForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AquariumKind>('display');
  const [gallons, setGallons] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const trimmed = name.trim();
  // Rejected rather than silently stored: a volume of "big" would read as a
  // measurement on every screen that shows it.
  const volumeBad = gallons.trim() !== '' && !(Number(gallons) > 0);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await createAquarium({
        name: trimmed,
        kind,
        volume: gallons.trim() && !volumeBad ? { value: Number(gallons), unit: 'gal' } : undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that tank.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <strong>Add a tank</strong>
      <div>
        <label htmlFor="new-tank-name">Name</label>
        <input
          id="new-tank-name"
          value={name}
          placeholder="Deep Sea Collector"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="new-tank-kind">Kind</label>
        <select
          id="new-tank-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AquariumKind)}
        >
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="new-tank-vol">Volume in gallons (optional)</label>
        <input
          id="new-tank-vol"
          inputMode="decimal"
          value={gallons}
          onChange={(e) => setGallons(e.target.value)}
        />
        <p className="xs muted">
          Leave it blank if you have not measured it. Add the footprint later on the Manage tab -
          screening needs both, and says so until it has them.
        </p>
      </div>
      {volumeBad && <p className="warn xs">Volume needs to be a number of gallons above zero.</p>}
      {error && <p className="warn xs">{error}</p>}
      <div className="row">
        <button
          type="button"
          className="btn--primary"
          disabled={!trimmed || volumeBad || busy}
          onClick={() => void save()}
        >
          {busy ? 'Adding…' : 'Add tank'}
        </button>
        <button type="button" className="btn--ghost" disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function TankCard({ aquarium, stats, photoUrl }: {
  aquarium: Pick<Aquarium, 'id' | 'name' | 'volume' | 'dimensions'>;
  stats: { fish: number; species: number; estimatedValue?: number };
  photoUrl?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sharing, setSharing] = useState(false);
  // Live, so the icon reflects a link revoked from another device.
  const shared = Boolean(useLiveQuery(() => db.shares.get(aquarium.id), [aquarium.id]));

  async function onPick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      await setTankPhoto(aquarium.id, { kind: 'photo', blob: file, mimeType: file.type || 'image/jpeg' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that photo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="tankcard">
      <Link to={`/tanks/${aquarium.id}`} className="tankcard__link">
        <span className="tankcard__art">
          {photoUrl
            ? <img src={photoUrl} alt="" loading="lazy" />
            : <span className="tankcard__art--empty" aria-hidden="true">🐟</span>}
        </span>
        <span className="tankcard__body">
          <strong className="tankcard__name">{aquarium.name}</strong>
          {/* Several tanks are named after their volume ("75G"), so printing
              both would show the same string twice for no extra fact. */}
          {(() => {
            const vol = aquarium.volume ? formatVolume(aquarium.volume) : 'volume unrecorded';
            return vol.toLowerCase() === aquarium.name.toLowerCase()
              ? null
              : <span className="xs muted data">{vol}</span>;
          })()}
          <span className="tankcard__stats data">
            <span>{stats.fish} <span className="muted">fish</span></span>
            <span>{stats.species} <span className="muted">species</span></span>
            {stats.estimatedValue !== undefined && (
              <span>${Math.round(stats.estimatedValue).toLocaleString()} <span className="muted">est.</span></span>
            )}
          </span>
          {/* Volume and dimensions gate different rules: volume alone clears the
              stocking minimum, but the footprint and adult-size checks read
              dimensions separately (engine.ts), so a tank with only a volume is
              still partly unscreenable. Saying "Unmeasured" until both are in
              would understate the 20G and 40G; dropping the badge the moment a
              volume lands would overstate them. So the badge names what is
              actually still missing. */}
          {(() => {
            if (aquarium.volume && aquarium.dimensions) return null;
            const label = aquarium.volume ? 'Needs dimensions' : 'Unmeasured';
            return (
              <span className="badge badge--insufficient-data">
                <span aria-hidden="true">?</span> {label}
              </span>
            );
          })()}
        </span>
      </Link>

      {/* Outside the link, so choosing a photo never navigates away mid-pick.
          The share control follows the same rule for the same reason. */}
      <div className="row tankcard__actions">
        <button
          type="button"
          className="tankcard__photo-btn btn--ghost"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Saving…' : photoUrl ? 'Change photo' : 'Add a photo'}
        </button>
        <button
          type="button"
          className="btn--ghost tankcard__share"
          aria-expanded={sharing}
          aria-label={shared ? `Sharing ${aquarium.name}` : `Share ${aquarium.name}`}
          onClick={() => setSharing(!sharing)}
        >
          <ShareNetworkIcon
            size={18}
            /* Filled while a link is live, so "this tank is public" is legible
               at a glance and in greyscale (NFR-06). */
            weight={shared ? 'fill' : 'regular'}
            aria-hidden="true"
          />
          {shared && <span className="xs"> Shared</span>}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label={`Photo of ${aquarium.name}`}
        onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }}
      />
      {error && <p className="warn xs" style={{ marginBottom: 0 }}>{error}</p>}
      {sharing && <ShareSheet aquarium={aquarium} onClose={() => setSharing(false)} />}
    </article>
  );
}

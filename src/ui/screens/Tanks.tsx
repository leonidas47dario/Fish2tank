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
import { Link } from 'react-router-dom';
import { setTankPhoto } from '@/data/repositories';
import { formatVolume } from '@/domain/units';
import type { Aquarium } from '@/domain/types';
import { useTankSummaries } from '../hooks';

export default function Tanks() {
  const tanks = useTankSummaries();

  return (
    <div className="stack">
      <header>
        <h1>Tanks</h1>
        <p className="muted small">Your real aquariums, and who actually lives in them.</p>
      </header>

      {tanks === undefined && <p className="muted small">Loading…</p>}

      <div className="tanklist">
        {tanks?.map(({ aquarium, stats, photoUrl }) => (
          <TankCard key={aquarium.id} aquarium={aquarium} stats={stats} photoUrl={photoUrl} />
        ))}
      </div>
    </div>
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

      {/* Outside the link, so choosing a photo never navigates away mid-pick. */}
      <button
        type="button"
        className="tankcard__photo-btn btn--ghost"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Saving…' : photoUrl ? 'Change photo' : 'Add a photo'}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label={`Photo of ${aquarium.name}`}
        onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }}
      />
      {error && <p className="warn xs" style={{ marginBottom: 0 }}>{error}</p>}
    </article>
  );
}

/**
 * Recording how big a fish is, and when it came home - ENH-12, spec 037.
 *
 * THE WRITE HALF. The timeline beside this reads four sources, three of which
 * the app already wrote; measurements are the one thing nobody could enter,
 * and "post dated updates (new photos, metrics)" is most of the original ask.
 *
 * A MEASUREMENT MAY NAME THE PHOTO IT WAS READ FROM, which was asked for
 * directly. The select offers only this fish's photographs, by date, because
 * "2.8 in" is usually said ABOUT a picture. The timeline then draws the two as
 * one row - but only when they fall on the same day, since a link to a photo
 * taken months earlier would print a size under a date nobody measured on.
 *
 * BOTH MEASURES ARE OPTIONAL AND ONE IS REQUIRED. `recordMeasurement` refuses
 * an empty observation; this disables the button rather than letting someone
 * find that out by pressing it.
 */
import { useState } from 'react';
import { recordMeasurement, setAcquiredOn } from '@/data/repositories';
import type { Id, LengthUnit, WeightUnit } from '@/domain/types';

/** `2026-02-14` for today, in the reader's own timezone rather than UTC. */
function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function MeasurementForm({ holdingId, photos, acquiredOn, isGroup }: {
  holdingId: Id;
  photos: Array<{ id: Id; on: string }>;
  acquiredOn?: string;
  isGroup: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(todayLocal());
  const [length, setLength] = useState('');
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('in');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('g');
  const [estimate, setEstimate] = useState(false);
  const [mediaId, setMediaId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const [acq, setAcq] = useState(acquiredOn ?? '');
  const [acqBusy, setAcqBusy] = useState(false);

  const lengthValue = Number.parseFloat(length);
  const weightValue = Number.parseFloat(weight);
  const hasLength = length.trim() !== '' && Number.isFinite(lengthValue) && lengthValue > 0;
  const hasWeight = weight.trim() !== '' && Number.isFinite(weightValue) && weightValue > 0;

  async function save() {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await recordMeasurement({
        holdingId,
        observedOn: on,
        length: hasLength ? { value: lengthValue, unit: lengthUnit, estimate: estimate || undefined } : undefined,
        weight: hasWeight ? { value: weightValue, unit: weightUnit, estimate: estimate || undefined } : undefined,
        mediaId: mediaId || undefined,
        note: note.trim() || undefined,
      });
      setLength(''); setWeight(''); setNote(''); setMediaId(''); setEstimate(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that measurement.');
    } finally {
      setBusy(false);
    }
  }

  /** Empty clears it, and the timeline falls back to its evidence ladder. */
  async function saveAcquired() {
    setAcqBusy(true);
    setError(undefined);
    try {
      await setAcquiredOn(holdingId, acq || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that date.');
    } finally {
      setAcqBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="pad">
        <button type="button" className="btn--ghost" onClick={() => setOpen(true)}>
          Record a measurement
        </button>
      </div>
    );
  }

  return (
    <div className="capture" style={{ marginTop: 'var(--space-3)' }}>
      <p className="panel__note" style={{ marginTop: 0, gridColumn: '1 / -1' }}>
        {isGroup
          ? 'A measurement of one of them on that day. Nothing here is averaged across the group.'
          : 'How big this fish was on a given day. A length, a weight, or both.'}
      </p>

      <label htmlFor="meas-on">When you measured</label>
      <input id="meas-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />

      <label htmlFor="meas-length">Length</label>
      <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input id="meas-length" type="number" min="0" step="0.1" inputMode="decimal"
          value={length} onChange={(e) => setLength(e.target.value)} placeholder="2.8" />
        <select aria-label="Length unit" value={lengthUnit}
          onChange={(e) => setLengthUnit(e.target.value as LengthUnit)}>
          <option value="in">in</option>
          <option value="cm">cm</option>
        </select>
      </span>

      <label htmlFor="meas-weight">Weight</label>
      <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input id="meas-weight" type="number" min="0" step="0.1" inputMode="decimal"
          value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="21" />
        <select aria-label="Weight unit" value={weightUnit}
          onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}>
          <option value="g">g</option>
          <option value="oz">oz</option>
        </select>
      </span>

      {/* FR-C05: an eyeballed figure must never pass as a measured one. */}
      <label htmlFor="meas-est">Estimated</label>
      <span>
        <input id="meas-est" type="checkbox" checked={estimate}
          onChange={(e) => setEstimate(e.target.checked)} />
        <span className="xs muted"> I eyeballed it rather than measuring</span>
      </span>

      {photos.length > 0 && (
        <>
          <label htmlFor="meas-photo">Read from</label>
          <select id="meas-photo" value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
            <option value="">No particular photo</option>
            {photos.map((p) => (
              <option key={p.id} value={p.id}>The photo from {p.on}</option>
            ))}
          </select>
        </>
      )}

      <label htmlFor="meas-note">Note</label>
      <textarea id="meas-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />

      <button type="button" className="btn--primary" style={{ gridColumn: '1 / -1' }}
        disabled={busy || (!hasLength && !hasWeight)} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save measurement'}
      </button>
      {!hasLength && !hasWeight && (
        <p className="panel__note panel__note--tight" style={{ gridColumn: '1 / -1' }}>
          Enter a length, a weight, or both.
        </p>
      )}
      {saved && (
        <p className="panel__note panel__note--tight" role="status" style={{ gridColumn: '1 / -1' }}>
          Saved.
        </p>
      )}

      <hr style={{ gridColumn: '1 / -1', border: 0, borderTop: 'var(--border-width) solid var(--color-border)' }} />

      <label htmlFor="meas-acq">Came home on</label>
      <input id="meas-acq" type="date" value={acq} onChange={(e) => setAcq(e.target.value)} />
      <p className="panel__note panel__note--tight" style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        Leaving this empty is a real answer. The history then dates from the earliest
        proof there is rather than from a guess.
      </p>
      <button type="button" className="btn--ghost" style={{ gridColumn: '1 / -1' }}
        disabled={acqBusy} onClick={() => void saveAcquired()}>
        {acqBusy ? 'Saving…' : 'Save the date it came home'}
      </button>

      {error && <p className="warn small" style={{ gridColumn: '1 / -1' }}>{error}</p>}

      <button type="button" className="btn--ghost" style={{ gridColumn: '1 / -1' }}
        onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  );
}

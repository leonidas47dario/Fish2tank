/**
 * A dated note about a fish - FH-5, spec 046.
 *
 * KEYED ON THE HOLDING, NOT THE MEMORIAL, which is what makes this component
 * usable from two places: it sits in the timeline on a living fish's record
 * and on a memorial page, and neither needs a special case. "Moved him because
 * the barbs were nipping" is worth writing down long before anything dies.
 *
 * THE DATE IS THE DAY THE NOTE IS ABOUT, not the day it was typed. That is the
 * backfilling half of the ask: somebody writing up a fish they kept for two
 * years needs to put an entry under 2024, and a `createdAt` timestamp cannot
 * be argued into meaning that. `createdAt` is still stored, separately, so the
 * record of when it was written is not lost either.
 */
import { useState } from 'react';
import { writeNote } from '@/data/repositories';
import type { Id } from '@/domain/types';

/** `2026-02-14` for today, in the reader's own timezone rather than UTC. */
function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function NoteForm({ holdingId }: { holdingId: Id }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(todayLocal());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await writeNote({ holdingId, text, writtenOn: on });
      // Cleared, and the form stays open: notes come in runs when somebody
      // sits down to write a fish up, and closing after each one would make
      // the second note cost as much as the first.
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that note.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="pad">
        <button type="button" className="btn--ghost" onClick={() => setOpen(true)}>
          Write a note
        </button>
      </div>
    );
  }

  return (
    <div className="capture" style={{ marginTop: 'var(--space-3)' }}>
      <label htmlFor="note-on">The day it is about</label>
      <input id="note-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />

      <label htmlFor="note-text">Note</label>
      <textarea
        id="note-text"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Moved him because the barbs were nipping."
      />

      <button
        type="button"
        className="btn--primary"
        style={{ gridColumn: '1 / -1' }}
        // An empty note is refused by `writeNote` too; disabling says so before
        // somebody finds out by pressing it.
        disabled={busy || !text.trim()}
        onClick={() => void save()}
      >
        {busy ? 'Saving…' : 'Save note'}
      </button>

      {error && <p className="warn small" style={{ gridColumn: '1 / -1' }}>{error}</p>}

      <button
        type="button"
        className="btn--ghost"
        style={{ gridColumn: '1 / -1' }}
        onClick={() => setOpen(false)}
      >
        Done
      </button>
    </div>
  );
}

/**
 * A value that edits where it is displayed - spec 039.
 *
 * WHY THIS EXISTS. The record had an "Edit this catch" button, and the keeper's
 * verdict on it was blunt: *"this is the most dump design, everything should be
 * editable and not through the edit this catch button, it's very redundant and
 * not useful"*.
 *
 * They are right, and the reason is worth writing down. A page with an edit
 * button says: WHAT YOU CAN SEE IS NOT WHAT YOU CAN CHANGE, the real version is
 * behind here. So every editable fact exists twice - once rendered, once in a
 * form - and the two drift, because nothing forces them to agree. The label,
 * the date and the shop were each displayed in one place and edited in another.
 *
 * Here there is one copy. Tap the value, change it, it saves on blur or Enter,
 * Escape abandons. No mode, no second form, no button whose only job is to
 * reveal the truth.
 *
 * AN EMPTY ANSWER IS A REAL ANSWER (P6). Clearing a field stores nothing rather
 * than a placeholder, and the display says "not recorded" rather than guessing.
 */
import { useEffect, useRef, useState } from 'react';

interface Common {
  label: string;
  /** Shown when there is no value. Never a guess at what the value might be. */
  empty?: string;
  onSave: (next: string | undefined) => Promise<void> | void;
}

export function InlineField({
  label, value, empty = 'not recorded', type = 'text', options, onSave,
}: Common & {
  value: string | undefined;
  type?: 'text' | 'date' | 'number';
  /** Turns this into a select. `value` is the option id. */
  options?: Array<{ id: string; name: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const box = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);
  useEffect(() => { if (editing) box.current?.focus(); }, [editing]);

  async function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next === (value ?? '')) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(next === '' ? undefined : next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      setDraft(value ?? '');
    } finally {
      setSaving(false);
    }
  }

  const shown = options
    ? options.find((o) => o.id === value)?.name
    : value;

  if (!editing) {
    return (
      <div className="inline-field">
        <dt>{label}</dt>
        <dd>
          <button
            type="button"
            className={`inline-field__value${shown ? '' : ' inline-field__value--empty'}`}
            onClick={() => setEditing(true)}
            aria-label={`${label}: ${shown ?? empty}. Tap to change.`}
          >
            {saving ? 'Saving…' : shown || empty}
          </button>
          {error && <span className="warn xs"> {error}</span>}
        </dd>
      </div>
    );
  }

  return (
    <div className="inline-field">
      <dt>{label}</dt>
      <dd>
        {options ? (
          <select
            ref={box as React.RefObject<HTMLSelectElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
          >
            <option value="">{empty}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : (
          <input
            ref={box as React.RefObject<HTMLInputElement>}
            type={type}
            inputMode={type === 'number' ? 'decimal' : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commit(); }
              // Escape abandons rather than saving, which is what every other
              // text field on every other platform does.
              if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
            }}
          />
        )}
      </dd>
    </div>
  );
}

/** The same, for prose. A note wants room and does not want Enter to submit. */
export function InlineNote({ label, value, empty = 'nothing written yet', onSave }: Common & {
  value: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);
  useEffect(() => { if (editing) box.current?.focus(); }, [editing]);

  async function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next === (value ?? '')) return;
    setSaving(true);
    try {
      await onSave(next === '' ? undefined : next);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button type="button" className={`inline-note${value ? '' : ' inline-note--empty'}`}
        onClick={() => setEditing(true)} aria-label={`${label}. Tap to change.`}>
        {saving ? 'Saving…' : value || empty}
      </button>
    );
  }

  return (
    <textarea
      ref={box}
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); } }}
      aria-label={label}
    />
  );
}

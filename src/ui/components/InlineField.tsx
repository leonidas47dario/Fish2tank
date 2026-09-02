/**
 * A value that edits where it is displayed - spec 041.
 *
 * WHY THIS EXISTS. The record had an "Edit this catch" button, and the verdict
 * on it was blunt: *"everything should be editable and not through the edit
 * this catch button"*. A page with an edit button says WHAT YOU CAN SEE IS NOT
 * WHAT YOU CAN CHANGE, so every editable fact exists twice - once rendered,
 * once in a form - and the two drift.
 *
 * WHY IT NO LONGER SWAPS A BUTTON FOR AN INPUT. The first version rendered the
 * value as a button and replaced it with an input on tap, focusing the input
 * from an effect. On a desktop browser that works, and in Chromium's touch
 * emulation it works, which is why it shipped.
 *
 * ON iOS SAFARI IT CANNOT WORK. WebKit opens the keyboard only when `focus()`
 * happens inside the user gesture that caused it. React state -> re-render ->
 * `useEffect` -> `focus()` is several turns removed from the tap, so the input
 * appears and the keyboard never does. Reported exactly as it would feel:
 * "the system doesn't allow entering any info".
 *
 * So THERE IS NO SWAP. The input is always the input; it is styled to read as
 * a value rather than a form field. A tap lands on a real focusable control
 * and the keyboard opens because the browser decided to, not because we asked
 * it to afterwards. This removes the whole class of bug rather than working
 * around one browser.
 *
 * AN EMPTY ANSWER IS A REAL ANSWER (P6). Clearing a field stores nothing, and
 * the placeholder says "not recorded" rather than guessing at what it was.
 */
import { useEffect, useRef, useState } from 'react';

interface Common {
  label: string;
  /** Shown when there is no value. Never a guess at what the value might be. */
  empty?: string;
  onSave: (next: string | undefined) => Promise<void> | void;
}

/** Only push the prop back into the box when the user is not in it. */
function useSyncedDraft(value: string | undefined, focused: boolean) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { if (!focused) setDraft(value ?? ''); }, [value, focused]);
  return [draft, setDraft] as const;
}

export function InlineField({
  label, value, empty = 'not recorded', type = 'text', options, onSave,
}: Common & {
  value: string | undefined;
  type?: 'text' | 'date' | 'number';
  /** Turns this into a select. `value` is the option id. */
  options?: Array<{ id: string; name: string }>;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useSyncedDraft(value, focused);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const committed = useRef(value ?? '');

  useEffect(() => { if (!focused) committed.current = value ?? ''; }, [value, focused]);

  async function commit(next: string) {
    const trimmed = next.trim();
    if (trimmed === committed.current) return;
    committed.current = trimmed;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(trimmed === '' ? undefined : trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      setDraft(value ?? '');
      committed.current = value ?? '';
    } finally {
      setSaving(false);
    }
  }

  const empty_ = !draft;

  return (
    <div className="inline-field">
      <dt>
        <label htmlFor={`f_${label}`}>{label}</label>
      </dt>
      <dd>
        {options ? (
          <select
            id={`f_${label}`}
            className="inline-input"
            value={draft}
            onFocus={() => setFocused(true)}
            onChange={(e) => { setDraft(e.target.value); void commit(e.target.value); }}
            onBlur={() => setFocused(false)}
          >
            <option value="">{empty}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : (
          <input
            id={`f_${label}`}
            className={`inline-input${empty_ ? ' inline-input--empty' : ''}`}
            type={type}
            inputMode={type === 'number' ? 'decimal' : undefined}
            placeholder={empty}
            value={draft}
            onFocus={() => setFocused(true)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => { setFocused(false); void commit(e.target.value); }}
            // Enter commits and closes the keyboard, which on a phone is the
            // only way to dismiss it without tapping somewhere arbitrary.
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === 'Escape') { setDraft(committed.current); e.currentTarget.blur(); }
            }}
          />
        )}
        {saving && <span className="xs muted"> saving…</span>}
        {error && <span className="warn xs"> {error}</span>}
      </dd>
    </div>
  );
}

/** The same, for prose. A note wants room, and Enter should make a paragraph. */
export function InlineNote({ label, value, empty = 'nothing written yet', onSave }: Common & {
  value: string | undefined;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useSyncedDraft(value, focused);
  const committed = useRef(value ?? '');
  useEffect(() => { if (!focused) committed.current = value ?? ''; }, [value, focused]);

  return (
    <textarea
      className={`inline-input inline-input--note${draft ? '' : ' inline-input--empty'}`}
      rows={2}
      aria-label={label}
      placeholder={empty}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        const next = e.target.value.trim();
        if (next === committed.current) return;
        committed.current = next;
        void onSave(next === '' ? undefined : next);
      }}
    />
  );
}

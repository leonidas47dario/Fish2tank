/**
 * A panel that cannot be missed - spec 035.
 *
 * WHY THIS EXISTS. Spec 025 rendered the sign-in peek and the join prompt as
 * siblings BELOW the fish grid. On a tank with a few fish that reads fine; on
 * a long one the keeper taps a fish near the top, the answer appears far off
 * the bottom of the page, and nothing happens as far as they can tell. That is
 * the bug as reported: *"if the list is long, I couldn't see the msg at all."*
 *
 * Scrolling the panel into view would fix the symptom. It would not fix the
 * shape: this is a question the page is asking, and the page should stop until
 * it is answered. So it is a real dialog - fixed to the bottom of the viewport
 * on a phone, where a sheet is the native idiom for exactly this.
 *
 * IT IS A DIALOG IN THE ACCESSIBILITY SENSE TOO, not a div that looks like
 * one: focus moves in on open and returns to whatever opened it on close,
 * Escape dismisses, and the scrim is a real button rather than a click handler
 * on a decorative layer, so it is reachable without a pointer.
 */
import { useEffect, useRef } from 'react';

export function Sheet({ label, onDismiss, children }: {
  /** Names the dialog for a screen reader; never rendered visually. */
  label: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    // Focus the panel itself rather than its first control: a sheet that opens
    // with "Continue with Google" focused reads as if it has already decided.
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', onKey);

    // The page behind must not scroll under the sheet - on a phone that feels
    // like the answer is running away from the finger.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      // Returning focus is the half everybody forgets; without it a keyboard
      // lands back at the top of the document.
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onDismiss]);

  return (
    <div className="sheet">
      <button
        type="button"
        className="sheet__scrim"
        aria-label={`Dismiss ${label}`}
        onClick={onDismiss}
      />
      <div
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={panel}
      >
        {children}
      </div>
    </div>
  );
}

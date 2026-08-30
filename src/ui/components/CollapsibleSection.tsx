/**
 * One collapsible Settings card - spec 018.
 *
 * NATIVE `<details>`, NOT A DIV WITH A CLICK HANDLER. It gives keyboard
 * operation, the correct screen-reader announcement, and browser find-in-page
 * that can open a closed section to reveal a match, all without a line of
 * code. A hand-rolled disclosure has to earn each of those back and usually
 * only earns the first.
 *
 * `open` is controlled because the nav has to be able to expand a section it
 * is scrolling to. `onToggle` fires for the keeper's own clicks, so the two
 * routes into the same state stay in agreement.
 */
import type { ReactNode } from 'react';

export default function CollapsibleSection({
  id, label, open, onToggle, children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      className="card stack settings-section"
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
    >
      {/*
        The heading lives inside the summary so the section title is still an
        h2 in the document outline. Putting the summary inside a heading
        instead makes the disclosure control the heading, which reads as
        "Account, heading level 2, summary" in most screen readers.
      */}
      <summary className="settings-section__summary">
        <h2>{label}</h2>
      </summary>
      <div className="stack settings-section__body">{children}</div>
    </details>
  );
}

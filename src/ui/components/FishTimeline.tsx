/**
 * A kept fish as one dated stream - ENH-12, spec 037.
 *
 * WHAT THE ASK WAS: *"once a fish is brought home it stops being a profile and
 * becomes a unit in the inventory: post dated updates from acquisition until
 * it dies, rendered as a cascading timeline"*. This is that stream. It is a
 * section on the record rather than a replacement for it - "stops being a
 * profile" is about emphasis, not deletion.
 *
 * IT DECIDES NOTHING. Every rule about what may be claimed - which dates count
 * as evidence, which are only a lower bound, when a span may be shown at all -
 * lives in `domain/fish-timeline.ts`, which is pure and tested. This file
 * renders what it is given.
 *
 * A HOLDING CAN BE A GROUP, and then this is the story of several fish. The
 * count is shown at the head and the prose says "these three" rather than
 * "it", because a page that says "it" about three severums is telling a small
 * lie every time it is read.
 */
import { useMemo } from 'react';
import type { LifeEventType } from '@/domain/types';
import { formatLength } from '@/domain/units';
import { daysBetween, type Anchor } from '@/domain/fish-timeline';
import type { HoldingMeasurement } from '@/domain/types';
import { Link } from 'react-router-dom';
import { MeasurementForm } from './MeasurementForm';
import { NoteForm } from './NoteForm';
import { InlineNote } from './InlineField';
import { deleteNote, updateNote } from '@/data/repositories';
import type { FishTimelineView } from '../hooks';

/** Past tense, because every one of these already happened. */
const EVENT_LABEL: Record<LifeEventType, string> = {
  'opening-balance': 'Already kept when the records began',
  reserved: 'Reserved',
  acquired: 'Came home',
  'quantity-adjusted': 'Count corrected',
  birth: 'Born',
  moved: 'Moved tank',
  rehomed: 'Rehomed',
  sold: 'Sold',
  returned: 'Returned',
  missing: 'Missing',
  escaped: 'Escaped',
  deceased: 'Died',
};

/** `2026-02-14` → `14 Feb 2026`, in the reader's locale. */
function longDate(on: string): string {
  const parsed = Date.parse(`${on}T00:00:00Z`);
  if (Number.isNaN(parsed)) return on;
  return new Date(parsed).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * How far into the fish's time with you this happened.
 *
 * Only ever rendered when an anchor exists, and worded differently when the
 * anchor is a photograph: a photo proves the fish existed by that date, not
 * that it arrived then, and "day 40" off a lower bound would be a claim
 * nobody made (P6).
 */
function relativeLabel(on: string, anchor?: Anchor): string | undefined {
  if (!anchor) return undefined;
  const days = daysBetween(anchor.on, on);
  if (days === undefined || days === 0) return undefined;
  const months = Math.floor(days / 30);
  const span = months >= 1
    ? `${months} month${months === 1 ? '' : 's'}`
    : `${days} day${days === 1 ? '' : 's'}`;
  return anchor.lowerBound ? `${span} after the first photo` : `+${span}`;
}

function measurementText(m: HoldingMeasurement): string {
  return formatLength(m.length);
}

export function FishTimeline({ timeline, title, onMemorialPage = false }: {
  timeline: FishTimelineView;
  title: string;
  /**
   * Set on `/heaven/:id`, where the story is already printed at the head of
   * the page - spec 046. Repeating it two sections lower is not emphasis, it
   * is the reader wondering whether they are two different stories. Off
   * everywhere else, where the timeline row is the only place it appears and
   * the row doubles as the way in to the memorial.
   */
  onMemorialPage?: boolean;
}) {
  const { entries, anchor, byMedia, quantity, isGroup } = timeline;

  /*
   * A measurement read off a photo is rendered ON that photo's row, so the two
   * do not appear as unrelated entries on the same day. Filtered here rather
   * than in the domain function, because it is a presentation choice.
   */
  const shown = useMemo(
    () => entries.filter((e) => !(e.kind === 'measurement' && e.measurement?.mediaId
      && byMedia.get(e.measurement.mediaId)?.id === e.measurement.id)),
    [entries, byMedia],
  );

  if (shown.length === 0) {
    return (
      <section className="panel">
        <h2 className="sec-head">History</h2>
        <p className="panel__note" style={{ marginTop: 0 }}>
          Nothing dated yet. A photo, a measurement or a note starts the story —
          and a note can be dated to the day it is about, so a fish you have
          kept for years can be written up from the beginning.
        </p>
      <MeasurementForm
        holdingId={timeline.holdingId}
        photos={timeline.photos}
        acquiredOn={timeline.acquiredOn}
        isGroup={isGroup}
      />
      <NoteForm holdingId={timeline.holdingId} />
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="sec-head">
        History
        {/* The unit tag. A reader must never have to guess whether a page is
            about one animal or several. */}
        {isGroup && <span className="data timeline__count"> ×{quantity}</span>}
      </h2>

      <p className="panel__note panel__note--tight" style={{ marginTop: 0 }}>
        {isGroup
          ? `Everything recorded about these ${quantity === 1 ? 'fish' : `${quantity} fish`}, newest first.`
          : `Everything recorded about ${title}, newest first.`}
        {anchor?.lowerBound && ' Dates run from the first photograph, which is the earliest proof there is — not necessarily when they arrived.'}
      </p>

      <ol className="timeline">
        {shown.map((entry) => {
          const relative = relativeLabel(entry.on, anchor);
          const onPhoto = entry.kind === 'photo' ? byMedia.get(entry.id) : undefined;

          return (
            <li key={`${entry.kind}_${entry.id}`} className={`timeline__row timeline__row--${entry.kind}`}>
              <div className="timeline__when">
                <span className="data">{longDate(entry.on)}</span>
                {relative && <span className="xs muted"> {relative}</span>}
              </div>
              <div className="timeline__what">
                {entry.kind === 'event' && entry.event && (
                  <>
                    <strong>{EVENT_LABEL[entry.event.type]}</strong>
                    {/* The delta only ever says something about a GROUP. On a
                        single fish it is always ±1 and distinguishes nothing -
                        and "Died -1" beside a memorial is a cold way to print
                        a fact the reader already has (FR-L03). */}
                    {isGroup && entry.event.quantityDelta !== 0 && (
                      <span className="data xs muted">
                        {' '}{entry.event.quantityDelta > 0 ? '+' : ''}{entry.event.quantityDelta}
                      </span>
                    )}
                    {entry.event.notes && <p className="xs muted" style={{ marginBottom: 0 }}>{entry.event.notes}</p>}
                  </>
                )}

                {entry.kind === 'photo' && (
                  <>
                    <strong>Photographed</strong>
                    {onPhoto && <span className="data xs"> — {measurementText(onPhoto)}</span>}
                  </>
                )}

                {entry.kind === 'measurement' && entry.measurement && (
                  <>
                    <strong className="data">{measurementText(entry.measurement)}</strong>
                    {/* A group's measurement is of ONE of them. Averaging
                        several would be a number about no actual fish. */}
                    {isGroup && <span className="xs muted"> — one of them</span>}
                    {entry.measurement.note && (
                      <p className="xs muted" style={{ marginBottom: 0 }}>{entry.measurement.note}</p>
                    )}
                  </>
                )}

                {/*
                  Spec 046. Edits where it is displayed, like every other fact
                  on the record since spec 041 - there is no "edit this note"
                  button, because a page with one says what you can see is not
                  what you can change. Clearing the text deletes the note:
                  `updateNote` treats an empty note as a removal, since a dated
                  entry that says nothing is worse than no entry at all.
                */}
                {entry.kind === 'note' && entry.note && (
                  <>
                    <InlineNote
                      label={`Note from ${longDate(entry.on)}`}
                      value={entry.note.text}
                      onSave={(v) => updateNote(entry.note!.id, { text: v ?? '' })}
                    />
                    <button
                      type="button"
                      className="linkbtn xs"
                      onClick={() => void deleteNote(entry.note!.id)}
                    >
                      Remove this note
                    </button>
                  </>
                )}

                {entry.kind === 'memorial' && entry.memorial && (
                  <>
                    {/* On any other page this row is the way in to the
                        memorial, which is the thing the old one-line Journal
                        entry never had (spec 046). */}
                    {onMemorialPage
                      ? <strong>Remembered</strong>
                      : <Link to={`/heaven/${entry.memorial.id}`}><strong>Remembered</strong></Link>}
                    {/* The story is printed at the head of the memorial page,
                        so printing it again here reads as a second story. */}
                    {entry.memorial.story && !onMemorialPage && (
                      <p className="xs muted" style={{ marginBottom: 0 }}>{entry.memorial.story}</p>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <MeasurementForm
        holdingId={timeline.holdingId}
        photos={timeline.photos}
        acquiredOn={timeline.acquiredOn}
        isGroup={isGroup}
      />
      <NoteForm holdingId={timeline.holdingId} />
    </section>
  );
}

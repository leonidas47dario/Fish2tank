/**
 * Who lived in this tank and does not now - spec 048.
 *
 * WHAT THIS MAKES GOOD ON. Fish Heaven's subtitle promises "still part of
 * every tank they lived in", and until now nothing joined a memorial to a
 * place: a fish that lived in the 75 for two years vanished from that tank the
 * moment it died. The join needed no new storage - a residency has always
 * known which tank, and a memorial has always known which holding.
 *
 * IT DECIDES NOTHING. Every rule about what may be claimed - above all whether
 * a death may be attributed to THIS tank - lives in
 * `domain/who-lived-here.ts`, which is pure and tested.
 *
 * FR-L03 SETS THE TONE. Nothing here is counted or totalled: no "3 lost", no
 * rate, no comparison between tanks. A number like that is a scoreboard
 * however gently it is worded, and this is a list of animals.
 */
import { Link } from 'react-router-dom';
import type { FormerResident } from '@/domain/who-lived-here';
import { ButterflyIcon } from './Icons';

/** `2026-04-19` → `19 Apr 2026`, parsed as UTC so no timezone moves a day. */
function longDate(on: string): string {
  const parsed = Date.parse(`${on}T00:00:00Z`);
  if (Number.isNaN(parsed)) return on;
  return new Date(parsed).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function WhoLivedHere({ rows, tankName }: {
  rows: FormerResident[] | undefined;
  tankName: string;
}) {
  if (rows === undefined) return null;

  if (rows.length === 0) {
    return (
      <section className="card stack">
        <strong>Who lived here before</strong>
        {/* Gently, rather than an empty list under a heading that promises
            something. Nobody having left is a good state, not a missing one. */}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Everyone who has lived in {tankName} is still here.
        </p>
      </section>
    );
  }

  return (
    <section className="card stack">
      {/*
        "BEFORE" IS LOAD-BEARING. The tank's own grid two sections up is headed
        "Who lives here", and the two differ by one letter otherwise - which
        reads fine to whoever built it and not at all to somebody scanning the
        page. One word removes the collision and keeps the name that was asked
        for.
      */}
      <strong>Who lived here before</strong>
      <p className="xs muted" style={{ marginBottom: 0 }}>
        Fish that lived in {tankName} and have moved on or been lost.
      </p>

      <ul className="list livedhere">
        {rows.map((row) => (
          <li key={row.id} className="livedhere__row">
            <span className="livedhere__mark">
              {/* The wing mark, only where a death actually happened here -
                  the same substitution spec 046 recorded for Fish Heaven. */}
              {row.diedHere
                ? <ButterflyIcon size={18} aria-hidden="true" />
                : <span aria-hidden="true" className="livedhere__dash">→</span>}
            </span>

            <span className="livedhere__body">
              <strong>{row.name}</strong>

              <span className="xs muted data">
                {longDate(row.from)} — {row.to ? longDate(row.to) : 'still here'}
              </span>

              {/* A group that lost some and is still in the tank. Said plainly,
                  because "still here" beside "Remembered" otherwise reads as a
                  contradiction rather than as two true things. */}
              {!row.to && row.diedHere && (
                <span className="xs muted">
                  {row.isGroup ? 'Some of them are still in this tank.' : 'Still in this tank.'}
                </span>
              )}

              {row.diedHere && row.memorial && (
                <Link to={`/heaven/${row.memorial.id}`} className="xs">
                  Remembered {longDate(row.memorial.occurredOn)}
                </Link>
              )}

              {!row.diedHere && row.movedTo && (
                <span className="xs muted">
                  Moved to <Link to={`/tanks/${row.movedTo.id}`}>{row.movedTo.name}</Link>
                </span>
              )}

              {/*
                Lived here, left, and died SOMEWHERE ELSE later. Still
                reachable, but never filed as having died here - that would
                attribute a death to a tank the fish had already left.
              */}
              {!row.diedHere && row.memorial && (
                <Link to={`/heaven/${row.memorial.id}`} className="xs">
                  Later remembered, {longDate(row.memorial.occurredOn)}
                </Link>
              )}

              {!row.diedHere && !row.movedTo && !row.memorial && (
                <span className="xs muted">No longer in a tank</span>
              )}

              {row.specimenId && (
                <Link to={`/specimen/${row.specimenId}`} className="xs muted">
                  Their record
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

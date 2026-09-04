/**
 * Who lived in this tank and does not now - spec 048, given faces by spec 050.
 *
 * WHY IT IS A GRID AND NOT A LIST. It shipped as a text list beneath a grid of
 * photographed tiles, which put the fish you lost in a plainer format than the
 * fish you still have - on the one screen where that reads as a judgement. It
 * was also inconsistent for no reason: `chooseArt` has decided which picture a
 * fish wears since spec 021, and this section simply never asked.
 *
 * SAME COMPONENT, NOT A COPY. The tiles render through `ResidentTileContent`,
 * the one the resident grid uses, so the two cannot drift into looking almost
 * alike - which is worse than either looking the same or looking different.
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
import type { FormerResidentView } from '../hooks';
import { ResidentTileContent } from './tank/TankViewer';
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
  rows: FormerResidentView[] | undefined;
  tankName: string;
}) {
  if (rows === undefined) return null;

  if (rows.length === 0) {
    return (
      <section className="stack">
        <h2>Who lived here before</h2>
        {/* Gently, rather than an empty grid under a heading that promises
            something. Nobody having left is a good state, not a missing one. */}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Everyone who has lived in {tankName} is still here.
        </p>
      </section>
    );
  }

  return (
    <section className="stack">
      {/*
        "BEFORE" IS LOAD-BEARING. The resident grid above is headed "Who lives
        here", and the two differ by one letter otherwise - which reads fine to
        whoever built it and not at all to somebody scanning the page. Now that
        both are grids of the same tiles, the wording is carrying more weight,
        not less.
      */}
      <h2>Who lived here before</h2>
      <p className="xs muted" style={{ marginBottom: 0 }}>
        Fish that lived in {tankName} and have moved on or been lost.
      </p>

      <div className="tank-grid">
        {rows.map((row) => {
          /*
           * ONE TAP TARGET PER TILE, like the grid above - three competing
           * links inside one row were already too many for a thumb, and a
           * tile has less room, not more.
           *
           * In order of what the reader is most likely asking. The memorial
           * where there is one. Otherwise the fish's own record - but a
           * holding created by `stockTank` or the inventory import has no
           * specimen and therefore no record page, which left most tiles
           * inert. So then the tank it moved to, which is the answer to
           * "where did it go" and is exactly the link the text list carried.
           * A fish with none of the three is a plain tile rather than a dead
           * link, which is the rule the resident grid already follows.
           */
          const to = row.memorial
            ? `/heaven/${row.memorial.id}`
            : row.specimenId ? `/specimen/${row.specimenId}`
              : row.movedTo ? `/tanks/${row.movedTo.id}`
                : undefined;

          const tile = (
            <>
              <ResidentTileContent
                resident={{
                  holding: { id: row.holdingId } as never,
                  quantity: 1,
                  speciesId: undefined,
                  commonName: row.name,
                  scientificName: row.scientificName,
                  artUrl: row.artUrl,
                }}
              />
              <span className="tank-tile__body departed__facts">
                <span className="xs muted data">
                  {longDate(row.from)} — {row.to ? longDate(row.to) : 'still here'}
                </span>

                {row.diedHere && row.memorial && (
                  <span className="xs departed__end">
                    <ButterflyIcon size={14} aria-hidden="true" />
                    {' '}Remembered {longDate(row.memorial.occurredOn)}
                  </span>
                )}

                {/* A group that lost some and is still in the tank. Said
                    plainly: "still here" beside "Remembered" would otherwise
                    read as a contradiction rather than two true things. */}
                {!row.to && row.diedHere && (
                  <span className="xs muted">
                    {row.isGroup ? 'Some of them are still in this tank.' : 'Still in this tank.'}
                  </span>
                )}

                {!row.diedHere && row.movedTo && (
                  <span className="xs muted">Moved to {row.movedTo.name}</span>
                )}

                {/*
                  Lived here, left, and died SOMEWHERE ELSE later. Never filed
                  as having died here - that would attribute a death to a tank
                  the fish had already left - but still reachable, which is why
                  the tile links to the memorial.
                */}
                {!row.diedHere && row.memorial && (
                  <span className="xs muted">
                    Later remembered, {longDate(row.memorial.occurredOn)}
                  </span>
                )}

                {!row.diedHere && !row.movedTo && !row.memorial && (
                  <span className="xs muted">No longer in a tank</span>
                )}
              </span>
            </>
          );

          /* `--plain` is the dimmed treatment that already exists for a tile
             that is not a live resident. Identical tiles for the living and
             the departed, in two grids under two nearly identical headings,
             is a way to misread your own tank. */
          const className = `tank-tile tank-tile--plain departed-tile${row.diedHere ? ' departed-tile--remembered' : ''}`;

          return to
            ? <Link key={row.id} to={to} className={className}>{tile}</Link>
            : <div key={row.id} className={className}>{tile}</div>;
        })}
      </div>
    </section>
  );
}

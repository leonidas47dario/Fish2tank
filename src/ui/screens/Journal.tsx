/**
 * Journal, Fish Heaven and Keeper's Code - PRD 4.7, 4.9.
 *
 * FR-L03 asks for "a gentle, dignified tone ... rather than a stats-heavy
 * reward screen", so Fish Heaven leads with the story, the dates and the
 * lesson. There is no tier badge and no score anywhere on this screen.
 */
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { createKeeperPrinciple } from '@/data/repositories';
import { useState } from 'react';

export default function Journal() {
  const memorials = useLiveQuery(async () => {
    const all = await db.memorials.toArray();
    const holdings = await db.holdings.toArray();
    return all
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
      .map((m) => ({ memorial: m, holding: holdings.find((h) => h.id === m.holdingId) }));
  }, []);

  const principles = useLiveQuery(() => db.keeperPrinciples.toArray(), []);

  const chapters = useLiveQuery(async () => {
    const encounters = (await db.encounters.toArray()).filter((e) => e.notes);
    const specimens = await db.specimens.toArray();
    return encounters
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
      .map((e) => ({ encounter: e, specimen: specimens.find((s) => s.id === e.specimenId) }));
  }, []);

  return (
    <div className="stack">
      <header><h1>Journal</h1></header>

      <section>
        <h2>Stories</h2>
        {chapters?.length === 0 && <p className="empty">No stories written yet.</p>}
        <ul className="list">
          {chapters?.map(({ encounter, specimen }) => (
            <li key={encounter.id} className="card">
              <p className="xs muted data" style={{ marginBottom: 'var(--space-1)' }}>
                {new Date(encounter.observedAt).toLocaleDateString()}
              </p>
              {specimen && (
                <Link to={`/specimen/${specimen.id}`} style={{ fontWeight: 600 }}>
                  {specimen.nickname ?? specimen.rawLabel ?? 'Mystery Catch'}
                </Link>
              )}
              <p style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>{encounter.notes}</p>
            </li>
          ))}
        </ul>
      </section>

      <hr />

      <section>
        <h2>Fish Heaven</h2>
        <p className="muted small">Still part of every tank they lived in.</p>
        {memorials?.length === 0 && <p className="empty">Nobody here.</p>}
        <ul className="list">
          {memorials?.map(({ memorial, holding }) => (
            <li key={memorial.id} className="card stack">
              <div>
                <strong>{holding?.rawLabel ?? 'A fish'}</strong>
                <span className="muted"> · {new Date(memorial.occurredOn).toLocaleDateString()}</span>
              </div>
              {memorial.story && <p style={{ marginBottom: 0 }}>{memorial.story}</p>}
              <p className="xs muted" style={{ marginBottom: 0 }}>
                Cause: {memorial.causeConfidence}
                {memorial.suspectedContributors.length > 0 && ` — ${memorial.suspectedContributors.join(', ')}`}
              </p>
              {memorial.lesson && (
                <>
                  <p className="small" style={{ marginBottom: 0 }}><em>{memorial.lesson}</em></p>
                  {!memorial.keeperPrincipleId && (
                    <button
                      type="button"
                      className="btn--ghost"
                      onClick={() => void createKeeperPrinciple(memorial.lesson!, { memorialId: memorial.id, specimenId: memorial.specimenId })}
                    >
                      Keep this as a principle
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <hr />

      <section>
        <h2>Keeper's Code</h2>
        <p className="muted small">Private. Available when you look for it, never pushed at you mid-catch.</p>
        <PrincipleForm />
        <ul className="list">
          {principles?.map((p) => (
            <li key={p.id} className="card">
              {p.text}
              {p.sourceMemorialId && <p className="xs muted" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>Learned the hard way.</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PrincipleForm() {
  const [text, setText] = useState('');
  return (
    <div className="stack">
      <label htmlFor="principle">Add a principle</label>
      <input id="principle" value={text} onChange={(e) => setText(e.target.value)} placeholder="Quarantine everything, every time." />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={async () => { await createKeeperPrinciple(text.trim()); setText(''); }}
      >
        Save
      </button>
    </div>
  );
}

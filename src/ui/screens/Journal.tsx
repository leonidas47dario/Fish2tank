/**
 * Journal, Fish Heaven and Keeper's Code - PRD 4.7, 4.9.
 *
 * FR-L03 asks for "a gentle, dignified tone ... rather than a stats-heavy
 * reward screen". There is no tier badge and no score anywhere on this screen.
 *
 * Fish Heaven is no longer rendered here in full - spec 046 gave it its own
 * route, `/heaven`, because a memorial you cannot open is a memorial you
 * cannot revisit or correct. What is left is a way in.
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
    const specimens = await db.specimens.toArray();
    return all
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
      .map((m) => {
        const holding = holdings.find((h) => h.id === m.holdingId);
        const specimen = specimens.find(
          (s) => s.id === (m.specimenId ?? holding?.specimenId),
        );
        return {
          memorial: m,
          holding,
          name: specimen?.nickname ?? holding?.rawLabel ?? specimen?.rawLabel,
        };
      });
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

      {/*
        Spec 046. THE LIST LIVES AT /heaven NOW, and this is a way in rather
        than a second copy of it. It used to be the whole feature: a card per
        memorial, with the story, the cause and the lesson printed on it and
        nowhere to go. Everything a keeper wanted to do next - add a photo,
        write something later, correct a date - had no home, which is exactly
        what was rejected: "there is no way to revisit those profiles or update
        them".
      */}
      <section>
        <h2>Fish Heaven</h2>
        <p className="muted small">Still part of every tank they lived in.</p>
        {memorials?.length === 0 && <p className="empty">Nobody here.</p>}
        <ul className="list">
          {memorials?.slice(0, 3).map(({ memorial, holding, name }) => (
            <li key={memorial.id} className="card">
              <Link to={`/heaven/${memorial.id}`} style={{ fontWeight: 600 }}>
                {name ?? holding?.rawLabel ?? 'A fish'}
              </Link>
              <span className="muted data xs">
                {' '}· {new Date(memorial.occurredOn).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
        {(memorials?.length ?? 0) > 0 && (
          <Link to="/heaven" className="btn--ghost">
            {memorials!.length > 3
              ? `Visit Fish Heaven — all ${memorials!.length}`
              : 'Visit Fish Heaven'}
          </Link>
        )}
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

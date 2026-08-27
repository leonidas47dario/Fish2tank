/** Home - PRD 3.2: recent catches, Dream List, unfinished stories, tank highlights. */
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { useRecentCatches, useTanksWithResidents } from '../hooks';
import { IdentityBadge } from '../components/Badges';

export default function Home() {
  const recent = useRecentCatches(5);
  const tanks = useTanksWithResidents();
  const dreamList = useLiveQuery(() => db.dreamList.toArray(), []);
  const species = useLiveQuery(() => db.species.toArray(), []);

  // FR-C08 / PRD 3.3: a story left unfinished is a draft, never a nag.
  const unfinished = useLiveQuery(async () => {
    const encounters = await db.encounters.toArray();
    const withoutNotes = encounters.filter((e) => !e.notes);
    const specimens = await db.specimens.toArray();
    return withoutNotes
      .map((e) => specimens.find((s) => s.id === e.specimenId))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .slice(0, 3);
  }, []);

  const nameOf = (speciesId: string) => species?.find((s) => s.id === speciesId)?.commonName ?? speciesId;

  return (
    <div className="stack">
      <header>
        <h1>Fish2Tank</h1>
        <p className="muted small">Catch the encounter. Keep every story.</p>
      </header>

      <Link to="/catch" className="btn btn--primary btn--big" style={{ textAlign: 'center', textDecoration: 'none' }}>
        ◉  Catch something
      </Link>

      <section>
        <h2>Recent catches</h2>
        {recent?.length === 0 && <p className="empty">Nothing yet.</p>}
        <ul className="list">
          {recent?.map((s) => (
            <li key={s.id}>
              <Link to={`/specimen/${s.id}`} className="card spread" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span>
                  <strong>{s.nickname ?? s.rawLabel ?? 'Mystery Catch'}</strong><br />
                  <span className="xs muted data">{new Date(s.createdAt).toLocaleDateString()}</span>
                </span>
                <IdentityBadge status={s.identityStatus} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {unfinished && unfinished.length > 0 && (
        <section>
          <h2>Stories you haven't written yet</h2>
          <ul className="list">
            {unfinished.map((s) => (
              <li key={s.id}>
                <Link to={`/specimen/${s.id}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                  {s.nickname ?? s.rawLabel ?? 'Mystery Catch'}
                </Link>
              </li>
            ))}
          </ul>
          <p className="xs muted">No hurry. They keep.</p>
        </section>
      )}

      <section>
        <h2>Dream List</h2>
        {dreamList?.length === 0 && (
          <p className="empty">Nothing on it yet. Add species from the Collection.</p>
        )}
        <ul className="list">
          {dreamList?.map((d) => (
            <li key={d.id} className="card spread">
              <span>{nameOf(d.speciesId)}</span>
              {d.fulfilledBySpecimenId && <span className="badge badge--suitable"><span aria-hidden="true">✓</span> Found</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Your tanks</h2>
        <ul className="list">
          {tanks?.map(({ aquarium, residents }) => (
            <li key={aquarium.id} className="card spread">
              <span>
                <strong>{aquarium.name}</strong><br />
                <span className="xs muted">
                  {residents.length} holding{residents.length === 1 ? '' : 's'}
                  {aquarium.stockingState && ` · ${aquarium.stockingState}`}
                </span>
              </span>
              {!aquarium.volume && <span className="badge badge--insufficient-data"><span aria-hidden="true">?</span> Unmeasured</span>}
            </li>
          ))}
        </ul>
      </section>

      <Link to="/settings" className="btn btn--ghost" style={{ textAlign: 'center', textDecoration: 'none' }}>
        Settings and appearance
      </Link>
    </div>
  );
}

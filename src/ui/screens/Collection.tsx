/**
 * Collection - PRD 4.6.
 *
 * FR-R01 requires the index to distinguish "species unlocked" from "unique
 * specimen count", so a species page shows both, and every specimen keeps its
 * own card beneath it (FR-R02).
 */
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { addToDreamList } from '@/data/repositories';
import { ScarcityBadge, TierBadge } from '../components/Badges';
import { scarcityFor } from '@/data/market';

export default function Collection() {
  const data = useLiveQuery(async () => {
    const [species, specimens, snapshots, dream] = await Promise.all([
      db.species.toArray(), db.specimens.toArray(), db.raritySnapshots.toArray(), db.dreamList.toArray(),
    ]);
    const dreamed = new Set(dream.map((d) => d.speciesId));
    return species
      .map((s) => ({
        species: s,
        onDreamList: dreamed.has(s.id),
        specimens: specimens.filter((sp) => sp.speciesId === s.id),
        unlocked: specimens.some((sp) => sp.speciesId === s.id && sp.identityStatus === 'user-confirmed'),
        snapshots,
      }))
      .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || a.species.commonName.localeCompare(b.species.commonName));
  }, []);

  const mysteries = useLiveQuery(
    () => db.specimens.where('identityStatus').equals('unknown').toArray(), [],
  );

  const unlockedCount = data?.filter((d) => d.unlocked).length ?? 0;
  const specimenCount = data?.reduce((n, d) => n + d.specimens.length, 0) ?? 0;

  return (
    <div className="stack">
      <header>
        <h1>Collection</h1>
        <p className="muted small data">
          {unlockedCount} species unlocked · {specimenCount} specimen card{specimenCount === 1 ? '' : 's'}
        </p>
      </header>

      {data?.map(({ species, specimens, unlocked, onDreamList, snapshots }) => (
        <section key={species.id} className="card stack">
          <div className="spread">
            <span>
              <strong>{species.commonName}</strong>
              {!unlocked && <span className="muted"> · not yet confirmed</span>}
              <br />
              {species.scientificName && <span className="xs muted sci">{species.scientificName}</span>}
              {/* Auto-populated from the shipped market index. */}
              {(() => {
                const scarcity = scarcityFor(species.id);
                return scarcity.available
                  ? <div style={{ marginTop: 'var(--space-2)' }}><ScarcityBadge band={scarcity.band} /></div>
                  : null;
              })()}
            </span>
            {!onDreamList && !unlocked && (
              <button type="button" className="btn--ghost" onClick={() => void addToDreamList(species.id)}>
                + Dream List
              </button>
            )}
          </div>

          {specimens.length > 0 && (
            <ul className="list">
              {specimens.map((sp) => {
                const snap = snapshots.find((s) => s.specimenId === sp.id);
                return (
                  <li key={sp.id}>
                    <Link
                      to={`/specimen/${sp.id}`}
                      className="card card--raised spread"
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <span>{sp.nickname ?? sp.rawLabel ?? 'Unnamed specimen'}</span>
                      {snap && <TierBadge tier={snap.tier} golden={Boolean(sp.golden)} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {mysteries && mysteries.length > 0 && (
        <section>
          <h2>Mystery Catches</h2>
          <p className="muted small">Saved without an identity. That is a complete record, not a broken one.</p>
          <ul className="list">
            {mysteries.map((m) => (
              <li key={m.id}>
                <Link to={`/specimen/${m.id}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                  {m.rawLabel ?? 'Mystery Catch'} <span className="xs muted data">{new Date(m.createdAt).toLocaleDateString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

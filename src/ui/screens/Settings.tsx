/**
 * Settings - PRD 7.2, 7.4, 7.5, NFR-06, NFR-08.
 *
 * The theme and scene pickers exist for the art-direction acceptance test
 * (7.6): the same Panther has to be comparable across all three territories,
 * and switching must change nothing but appearance. Mute and reduced motion
 * ship from first release, not later.
 */
import { useState } from 'react';
import { SCENES, THEMES, useTheme } from '@/theme/ThemeProvider';
import { db } from '@/data/db';
import { importInventoryFile } from '@/data/import-service';
import type { ImportResult } from '@/data/seed/inventory-import';

export default function Settings() {
  const { theme, setTheme, scene, setScene, reducedMotion, setReducedMotion, muted, setMuted } = useTheme();

  return (
    <div className="stack">
      <header><h1>Settings</h1></header>

      <section className="card stack">
        <h2>App theme</h2>
        <p className="muted small">
          A comparison tool, not a finished decision. The records, the verdicts and the scores are identical
          in all three.
        </p>
        {THEMES.map((t) => (
          <label key={t.id} className="row" style={{ cursor: 'pointer', color: 'var(--color-text)' }}>
            <input
              type="radio" name="theme" value={t.id} checked={theme === t.id}
              onChange={() => setTheme(t.id)} style={{ width: 'auto' }}
            />
            <span>
              <strong>{t.name}</strong><br />
              <span className="xs muted">{t.blurb}</span>
            </span>
          </label>
        ))}
      </section>

      <section className="card stack">
        <h2>Aquarium scene</h2>
        <p className="muted small">
          A surround for the media window. The original photo or video is never replaced or altered.
        </p>
        {SCENES.map((s) => (
          <label key={s.id} className="row" style={{ cursor: 'pointer', color: 'var(--color-text)' }}>
            <input
              type="radio" name="scene" value={s.id} checked={scene === s.id}
              onChange={() => setScene(s.id)} style={{ width: 'auto' }}
            />
            <span>
              <strong>{s.name}</strong><br />
              <span className="xs muted">{s.blurb}</span>
            </span>
          </label>
        ))}
      </section>

      <section className="card stack">
        <h2>Motion and sound</h2>
        <label className="row" style={{ cursor: 'pointer', color: 'var(--color-text)' }}>
          <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} style={{ width: 'auto' }} />
          Reduce motion
        </label>
        <label className="row" style={{ cursor: 'pointer', color: 'var(--color-text)' }}>
          <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} style={{ width: 'auto' }} />
          Mute everything
        </label>
        <p className="xs muted" style={{ marginBottom: 0 }}>
          Reveals stay skippable whatever these are set to.
        </p>
      </section>

      <InventoryImport />
      <DataExport />

      <section className="card">
        <h2>Privacy</h2>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Everything lives on this device. There is no account, no server and no sharing in this build.
          Store and home locations are never published, and no public profile, map or trading feature
          exists.
        </p>
      </section>
    </div>
  );
}

/** FR-O03: bring the existing 61-row inventory in as opening balances. */
function InventoryImport() {
  const [result, setResult] = useState<ImportResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setBusy(true);
    try {
      setResult(await importInventoryFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Import inventory</h2>
      <p className="muted small">
        Load the Fish Inventory sheet — the <code>.xlsx</code> directly, or a CSV export. Raw labels are
        kept exactly as written, unclear IDs stay unclear, and no arrival dates are invented.
      </p>
      <input
        type="file"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={busy}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {busy && <p className="small muted">Reading…</p>}
      {error && <p className="warn">{error}</p>}
      {result && (
        <>
          <p className="small">
            Imported {result.holdings.length} rows into {result.aquariums.length} enclosures.
            {' '}{result.report.filter((r) => r.identity === 'unresolved').length} still need a species confirmed.
          </p>
          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>Row-by-row report</summary>
            <ul className="list xs" style={{ marginTop: 'var(--space-3)' }}>
              {result.report.map((r) => (
                <li key={r.holdingId}>
                  {r.row}. {r.tank} — {r.label} ×{r.quantity}{' '}
                  <span className="muted">({r.identity})</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

/** NFR-08: export records in a documented machine-readable form. */
function DataExport() {
  const [busy, setBusy] = useState(false);

  async function exportAll() {
    setBusy(true);
    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      // Media BLOBS are deliberately excluded: they are large and binary. The
      // metadata rows retain each original's key, size and type so a media
      // export can be added without changing this shape.
      note: 'Record export. Original media files are not included in this JSON.',
      species: await db.species.toArray(),
      speciesProfiles: await db.speciesProfiles.toArray(),
      specimens: await db.specimens.toArray(),
      encounters: await db.encounters.toArray(),
      media: await db.media.toArray(),
      identifications: await db.identifications.toArray(),
      priceObservations: await db.priceObservations.toArray(),
      raritySnapshots: await db.raritySnapshots.toArray(),
      dreamList: await db.dreamList.toArray(),
      aquariums: await db.aquariums.toArray(),
      holdings: await db.holdings.toArray(),
      residencies: await db.residencies.toArray(),
      lifeEvents: await db.lifeEvents.toArray(),
      assessments: await db.assessments.toArray(),
      memorials: await db.memorials.toArray(),
      keeperPrinciples: await db.keeperPrinciples.toArray(),
      places: await db.places.toArray(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fish2tank-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <section className="card stack">
      <h2>Export</h2>
      <p className="muted small">Every record, as JSON. Yours to keep and to move.</p>
      <button type="button" onClick={() => void exportAll()} disabled={busy}>
        {busy ? 'Preparing…' : 'Export records'}
      </button>
    </section>
  );
}

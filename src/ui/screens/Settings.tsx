/**
 * Settings - PRD 7.2, 7.4, 7.5, NFR-06, NFR-08.
 *
 * The theme and scene pickers exist for the art-direction acceptance test
 * (7.6): the same Panther has to be comparable across all three territories,
 * and switching must change nothing but appearance. Mute and reduced motion
 * ship from first release, not later.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { SCENES, THEMES, useTheme } from '@/theme/ThemeProvider';
import { BUILD_ID, BUILT_AT } from '@/build-info';
import { db } from '@/data/db';
import { LOCAL_PROFILE_ID, setDisplayName, updateSettings } from '@/data/profile';
import { importInventoryFile } from '@/data/import-service';
import type { ImportResult } from '@/data/seed/inventory-import';

/** Spec 005 FR-A04. Enough to cover where Ryan actually buys fish. */
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY'];

export default function Settings() {
  const { theme, setTheme, scene, setScene, reducedMotion, setReducedMotion, muted, setMuted } = useTheme();

  // A plain read, not loadProfile(): a live query re-runs whenever `users`
  // changes, and loadProfile() writes on first call, so using it here would put
  // a write inside a query observing the table it writes to. ThemeProvider has
  // already created the row by the time this screen renders.
  const profile = useLiveQuery(() => db.users.get(LOCAL_PROFILE_ID));

  return (
    <div className="stack">
      <header><h1>Settings</h1></header>

      <section className="card stack">
        <h2>Profile</h2>
        <p className="muted small">
          Kept on this device. Nothing here is shared or published.
        </p>
        <label className="stack">
          <span className="xs muted">Display name</span>
          <input
            type="text"
            value={profile?.displayName ?? ''}
            placeholder="Unnamed keeper"
            onChange={(e) => void setDisplayName(e.target.value)}
          />
        </label>
        <label className="stack">
          <span className="xs muted">Currency for new prices</span>
          <select
            value={profile?.settings.currency ?? 'USD'}
            onChange={(e) => void updateSettings({ currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </section>

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
      <BuildStamp />

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

/**
 * Which build is running, and a way to insist on the newest one.
 *
 * A service worker means the code on a device is not necessarily the code that
 * was deployed. A stale precached shell is indistinguishable from a fix that
 * did not work, and on iOS Safari an update can sit unactivated for as long as
 * a tab stays warm. Both ends of a UAT report were guessing; this makes the
 * answer readable in one glance.
 *
 * The button drops the caches and the worker registration, then reloads.
 * It deliberately does NOT touch IndexedDB - every catch, photo and record
 * lives there, and nothing about fetching fresh code should risk them.
 */
function BuildStamp() {
  const [busy, setBusy] = useState(false);

  async function forceLatest() {
    setBusy(true);
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        const dropped = await Promise.all(keys.map((k) => caches.delete(k)));
        console.info('[build] cleared caches', { keys, dropped });
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        const gone = await Promise.all(regs.map((r) => r.unregister()));
        console.info('[build] unregistered workers', { count: regs.length, gone });
      }
    } catch (e) {
      // Worth seeing, but never worth blocking the reload: a hard reload on
      // its own still stands a good chance of picking up the new build.
      console.warn('[build] could not fully clear the cached build', e);
    }
    window.location.reload();
  }

  return (
    <section className="card stack">
      <h2>Build</h2>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Offline support means this device can keep running an older build than the one deployed. If
        something looks unfixed, check this first.
      </p>
      <p className="xs muted data" style={{ marginBottom: 0 }}>
        {BUILD_ID}
        {BUILT_AT && ` · built ${new Date(BUILT_AT).toLocaleString()}`}
      </p>
      <button type="button" onClick={() => void forceLatest()} disabled={busy}>
        {busy ? 'Fetching…' : 'Get the latest build'}
      </button>
      <p className="xs muted" style={{ marginBottom: 0 }}>
        Clears the cached copy of the app and reloads. Your catches, photos and tanks are untouched.
      </p>
    </section>
  );
}

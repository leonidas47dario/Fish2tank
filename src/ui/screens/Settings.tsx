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
import { exportArchive } from '@/data/portability/export';
import { importArchive } from '@/data/portability/import';
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
      <BackupPanel />
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

/**
 * Backup and restore - spec 006. NFR-08.
 *
 * Supersedes the records-only JSON export this section used to hold. That
 * version deliberately left media out, which made it a fine data dump and a
 * poor backup: P3 says the media IS the record, so restoring without photos
 * restores the index and loses the collection.
 *
 * This matters more than it sounds. Everything lives in one browser's
 * IndexedDB, and Safari can evict that after about a week on a non-installed
 * site (ENH-04). Until sync exists, this archive is the only copy.
 */
function BackupPanel() {
  const [busy, setBusy] = useState<'export' | 'import' | undefined>();
  const [note, setNote] = useState<string>();
  const [problem, setProblem] = useState<string>();

  async function runExport() {
    setBusy('export');
    setNote(undefined);
    setProblem(undefined);
    try {
      const { blob, filename, manifest } = await exportArchive(db, { appBuild: BUILD_ID });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      const rows = Object.values(manifest.tables).reduce((n, v) => n + v, 0);
      setNote(`Saved ${filename}: ${rows} records and ${manifest.media.count} media files.`);
    } catch (err) {
      // Never silent. A backup that failed quietly is worse than none, because
      // you would go on believing you had one.
      console.error('[backup] export failed', err);
      setProblem(`Export failed: ${String(err)}`);
    }
    setBusy(undefined);
  }

  async function runImport(file: File) {
    setBusy('import');
    setNote(undefined);
    setProblem(undefined);
    try {
      const result = await importArchive(new Uint8Array(await file.arrayBuffer()), db);
      const rows = Object.values(result.tables).reduce((n, v) => n + v, 0);
      setNote(`Restored ${rows} records and ${result.mediaRestored} media files from ${file.name}.`);
    } catch (err) {
      console.error('[backup] import rejected', err);
      setProblem(err instanceof Error ? err.message : String(err));
    }
    setBusy(undefined);
  }

  return (
    <section className="card stack">
      <h2>Backup</h2>
      <p className="muted small">
        Every record and every photo, in one file. This is currently the only copy of your
        collection that lives anywhere but this browser.
      </p>

      <button type="button" onClick={() => void runExport()} disabled={Boolean(busy)}>
        {busy === 'export' ? 'Packing…' : 'Export everything'}
      </button>

      <label className="stack">
        <span className="xs muted">Restore from a backup</span>
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={Boolean(busy)}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void runImport(file);
            e.target.value = '';
          }}
        />
      </label>
      <p className="xs muted">
        Restoring adds to what is here and never deletes it. Importing the same file twice is
        safe. An archive that does not match its own manifest is refused whole.
      </p>

      {note ? <p className="small">{note}</p> : null}
      {problem ? <p className="small" role="alert">{problem}</p> : null}
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

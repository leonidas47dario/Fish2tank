/**
 * Settings - PRD 7.2, 7.4, 7.5, NFR-06, NFR-08.
 *
 * The theme and scene pickers exist for the art-direction acceptance test
 * (7.6): the same Panther has to be comparable across all three territories,
 * and switching must change nothing but appearance. Mute and reduced motion
 * ship from first release, not later.
 *
 * SPEC 017 REORDERED THIS SCREEN. It had grown to nine cards in the order they
 * were built, which put Account fifth and Backup seventh - the two things a
 * keeper opens Settings to find. It is now five: Account (who you are, whether
 * you are syncing, and what currency your prices read in), Theme (everything
 * about how it looks), Your data (backup, restore, erase, together because
 * erase is only safe next to backup), Privacy, and Build.
 *
 * Two sections were removed rather than moved. Profile held a display-name
 * field and the currency picker; the name now comes from the signed-in
 * account and the currency moved into Account. Import inventory was the last
 * caller of the spreadsheet importer, and deleting it also closes BUG-07,
 * whose only reachable path was re-importing an edited sheet.
 */
import { useState } from 'react';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import { SCENES, THEMES, useTheme, type SceneId, type ThemeId } from '@/theme/ThemeProvider';
import { BUILD_ID, BUILT_AT } from '@/build-info';
import { db } from '@/data/db';
import { LOCAL_PROFILE_ID, updateSettings } from '@/data/profile';
import AccountPanel from '@/ui/components/AccountPanel';
import { exportArchive } from '@/data/portability/export';
import { importArchive } from '@/data/portability/import';
import { eraseEverything } from '@/data/portability/erase';

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

      {/*
        Spec 017. Account first, because "am I signed in and is my collection
        safe" is the question this screen exists to answer; everything else is
        preference. The currency picker rides inside it rather than justifying
        a section of its own.
      */}
      <AccountPanel>
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
      </AccountPanel>

      <ThemePanel
        theme={theme} setTheme={setTheme}
        scene={scene} setScene={setScene}
        reducedMotion={reducedMotion} setReducedMotion={setReducedMotion}
        muted={muted} setMuted={setMuted}
      />

      <DataPanel />

      <section className="card">
        <h2>Privacy</h2>
        {/*
          Rewritten for spec 005. The old text promised "no account, no server",
          which stopped being true the moment sync shipped. A privacy notice
          that overclaims is worse than none, because it is the one paragraph
          someone actually relies on.
        */}
        <p className="small muted">
          Signed out, everything lives on this device and nothing leaves it. Signed in, your
          records sync to a private space only your account can read, and photos still never
          leave the device that took them.
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Store and home locations are never published, and no public profile, map or trading
          feature exists.
        </p>
      </section>

      <BuildStamp />
    </div>
  );
}

/**
 * Everything that changes how the app looks and feels, in one card.
 *
 * Spec 017. This was three sections - App theme, Aquarium scene, Motion and
 * sound - which between them pushed Account and Backup below the fold on a
 * phone. They are one concern (appearance) and one decision session, so they
 * are one card with three headings rather than three cards with one each.
 *
 * The radio groups keep their `name` attributes, which is what makes each set
 * behave as one group now that they share a fieldset-less card.
 */
function ThemePanel({
  theme, setTheme, scene, setScene, reducedMotion, setReducedMotion, muted, setMuted,
}: {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  scene: SceneId;
  setScene: (id: SceneId) => void;
  reducedMotion: boolean;
  setReducedMotion: (on: boolean) => void;
  muted: boolean;
  setMuted: (on: boolean) => void;
}) {
  return (
    <section className="card stack">
      <h2>Theme</h2>

      <h3 className="small">Appearance</h3>
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

      <h3 className="small">Aquarium scene</h3>
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

      <h3 className="small">Motion and sound</h3>
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
  );
}

/**
 * Backup, restore and erase, together, because they are one decision.
 *
 * Spec 017. Erase is only safe because backup is right above it, and restore
 * is the only thing that makes erase reversible. Splitting them across two
 * cards separated by other settings hid that relationship; a keeper looking
 * for "how do I start over" had to find two sections to do it safely.
 */
function DataPanel() {
  return (
    <section className="card stack">
      <h2>Your data</h2>
      <BackupPanel />
      <ErasePanel />
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
    <div className="stack">
      <h3 className="small">Backup</h3>
      <p className="muted small">
        Every record and every photo, in one file. Signed out, this is the only copy of your
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
    </div>
  );
}

/**
 * Erase everything, so a keeper can restore a clean copy over an empty app.
 *
 * THE BACKUP IS NOT OPTIONAL AND NOT A CHECKBOX. The archive is written first,
 * as step one of the flow, and a failed or cancelled export stops the whole
 * thing. Asking someone to confirm they have a backup is asking them to
 * remember; taking one is not.
 *
 * THREE STEPS, NOT ONE BUTTON. Backup, then consent, then erase. The consent
 * step asks for the word ERASE rather than offering a second button, because
 * the cost of a mis-tap here is the entire collection and the only honest
 * defence is making the action impossible to perform by accident.
 *
 * IT SAYS WHAT IT WILL REACH. Signed in, this is not a local reset: the
 * deletions sync, so the account is emptied on every device. Signed out it is
 * this browser only. Those are very different acts and the text changes to
 * match rather than describing the safer one.
 */
function ErasePanel() {
  const user = useObservable(db.cloud.currentUser);
  const signedIn = Boolean(user?.isLoggedIn);

  const [stage, setStage] = useState<'idle' | 'confirming' | 'working'>('idle');
  const [typed, setTyped] = useState('');
  const [backup, setBackup] = useState<string>();
  const [note, setNote] = useState<string>();
  const [problem, setProblem] = useState<string>();

  function reset() {
    setStage('idle');
    setTyped('');
    setBackup(undefined);
  }

  /** Step one. Nothing is destroyed until this has actually produced a file. */
  async function backupThenConfirm() {
    setStage('working');
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
      setBackup(`${filename} (${rows} records, ${manifest.media.count} media files)`);
      setStage('confirming');
    } catch (err) {
      console.error('[erase] refusing: the backup failed', err);
      setProblem(`Backup failed, so nothing was erased: ${String(err)}`);
      setStage('idle');
    }
  }

  /** Step three. Step two is the keeper typing the word. */
  async function erase() {
    setStage('working');
    try {
      const result = await eraseEverything(db);
      setNote(
        `Erased ${result.total} records${result.userSpeciesRemoved > 0
          ? `, including ${result.userSpeciesRemoved} species you added`
          : ''}. Restore your backup to bring a collection back.`,
      );
      reset();
    } catch (err) {
      // A half-erase is the dangerous outcome: some of the collection is gone
      // and the screen must not imply the rest is safe.
      console.error('[erase] failed part way through', err);
      setProblem(
        `Erase failed part way through: ${String(err)}. Some records may be gone. `
        + 'Restore the backup that was just saved.',
      );
      setStage('idle');
    }
  }

  return (
    <div className="stack">
      <h3 className="small">Erase everything</h3>
      <p className="muted small">
        {signedIn
          ? 'Empties your whole collection from this device and from your account, on every '
            + 'device signed into it. A backup is saved first, and restoring it is the only way back.'
          : 'Empties your whole collection from this browser. A backup is saved first, and '
            + 'restoring it is the only way back.'}
      </p>

      {stage !== 'confirming' ? (
        <button
          type="button"
          onClick={() => void backupThenConfirm()}
          disabled={stage === 'working'}
        >
          {stage === 'working' ? 'Saving your backup…' : 'Back up, then erase everything'}
        </button>
      ) : (
        <div className="stack">
          <p className="small" role="alert">
            Backup saved: <strong>{backup}</strong>
          </p>
          <p className="small">
            {signedIn
              ? 'This will delete every record in your account, everywhere. '
              : 'This will delete every record in this browser. '}
            Type <strong>ERASE</strong> to confirm.
          </p>
          <input
            aria-label="Type ERASE to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
          <button type="button" onClick={() => void erase()} disabled={typed.trim() !== 'ERASE'}>
            Erase everything now
          </button>
          <button type="button" onClick={reset}>Cancel</button>
        </div>
      )}

      {note ? <p className="small">{note}</p> : null}
      {problem ? <p className="small" role="alert">{problem}</p> : null}
    </div>
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

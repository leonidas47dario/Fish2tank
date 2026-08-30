/**
 * Account and sync status - spec 005 FR-A02, FR-A05, NFR-13.
 *
 * Two jobs, deliberately in one card because they answer one question: is my
 * collection anywhere but this device, and is it up to date?
 *
 * FR-A05 governs the tone. Signing in is how you KEEP a collection across
 * devices, not how you are permitted to open one, so this reads as an offer
 * rather than a gate, and everything works untouched if it is ignored.
 *
 * NFR-13 governs the detail. A sync engine is the exact shape of the DW_SYNC
 * failure - a status field reporting success while the data sits somewhere
 * else - so this shows the tier it is talking to and the real phase, and says
 * plainly when it does not know something rather than showing a comforting
 * zero.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { CLOUD_DATABASE_URL, DEPLOYMENT } from '@/build-info';
import { LOCAL_PROFILE_ID, updateSettings } from '@/data/profile';
import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  SYNC_INTERVAL_CHOICES,
} from '@/data/sync/auto-sync';
import { mediaSyncBlocker, runMediaSync, type MediaSyncResult } from '@/data/sync/media-sync';
import { autoSync, useAutoSyncState } from '@/ui/useAutoMediaSync';

/** Human wording for each sync phase. The raw enum is shown alongside. */
const PHASE_TEXT: Record<string, string> = {
  initial: 'Starting up',
  'not-in-sync': 'Changes waiting to go up',
  pushing: 'Sending your changes',
  pulling: 'Fetching changes',
  'in-sync': 'Up to date',
  error: 'Sync problem',
  offline: 'Offline, changes are saved here',
};

export default function AccountPanel({ children }: { children?: ReactNode }) {
  const user = useObservable(db.cloud.currentUser);
  const syncState = useObservable(db.cloud.syncState);
  const [busy, setBusy] = useState<'in' | 'out' | undefined>();
  const [problem, setProblem] = useState<string>();

  // SyncState carries no timestamp, so the moment it last reached `in-sync` is
  // observed here rather than invented. Held in a ref between renders and
  // mirrored into state only when it actually changes.
  const [lastInSync, setLastInSync] = useState<Date | undefined>();
  const wasInSync = useRef(false);
  useEffect(() => {
    const inSync = syncState?.phase === 'in-sync';
    if (inSync && !wasInSync.current) setLastInSync(new Date());
    wasInSync.current = inSync;
  }, [syncState?.phase]);

  async function signIn() {
    setBusy('in');
    setProblem(undefined);
    try {
      console.info('[sync] sign-in requested', { provider: 'google', db: CLOUD_DATABASE_URL });
      await db.cloud.login({ provider: 'google' });
      console.info('[sync] sign-in resolved', { userId: db.cloud.currentUser?.value?.userId });
    } catch (cause) {
      // Never swallowed. A login that failed quietly leaves someone believing
      // their collection is backed up when it is not.
      console.error('[sync] sign-in failed', cause);
      setProblem(cause instanceof Error ? cause.message : String(cause));
    }
    setBusy(undefined);
  }

  async function signOut() {
    setBusy('out');
    setProblem(undefined);
    try {
      await db.cloud.logout();
      console.info('[sync] signed out');
    } catch (cause) {
      console.error('[sync] sign-out failed', cause);
      setProblem(cause instanceof Error ? cause.message : String(cause));
    }
    setBusy(undefined);
  }

  const signedIn = Boolean(user?.isLoggedIn);
  const phase = syncState?.phase ?? 'initial';

  return (
    <section className="card stack">
      <h2>Account</h2>

      {signedIn ? (
        <>
          <p className="small" style={{ marginBottom: 0 }}>
            Signed in as <strong>{user?.name || user?.email || user?.userId}</strong>
          </p>
          <p className="xs muted">
            Your records sync to every device you sign in on. Photos travel separately,
            below, because they are megabytes rather than kilobytes.
          </p>
          <button type="button" onClick={() => void signOut()} disabled={Boolean(busy)}>
            {busy === 'out' ? 'Signing out…' : 'Sign out'}
          </button>
          <p className="xs muted" style={{ marginBottom: 0 }}>
            Signing out leaves this device's copy exactly where it is. Nothing is deleted.
          </p>
        </>
      ) : (
        <>
          <p className="muted small">
            Sign in to keep your collection across your phone, tablet and computer. Everything
            here works without an account; signing in is how it survives a lost device, not how
            you get in.
          </p>
          <button type="button" onClick={() => void signIn()} disabled={Boolean(busy)}>
            {busy === 'in' ? 'Opening Google…' : 'Sign in with Google'}
          </button>
        </>
      )}

      {problem ? (
        <p className="small" role="alert">{problem}</p>
      ) : null}

      {/*
        Spec 017. Settings passes the currency control in here rather than
        keeping a section of its own for it. It sits above the sync block
        because it is a thing you set, and everything below is a thing you
        read.
      */}
      {children}

      <dl className="xs muted" style={{ margin: 0 }}>
        <div className="row">
          <dt>Status</dt>
          <dd>
            {PHASE_TEXT[phase] ?? phase}{' '}
            <span className="data">({phase}{syncState?.status ? `/${syncState.status}` : ''})</span>
          </dd>
        </div>
        <div className="row">
          <dt>Last up to date</dt>
          <dd>{lastInSync ? lastInSync.toLocaleTimeString() : 'not yet this session'}</dd>
        </div>
        <div className="row">
          <dt>Syncing with</dt>
          {/* The tier, said out loud. Wrong-tier writes are otherwise invisible. */}
          <dd className="data">{DEPLOYMENT} · {CLOUD_DATABASE_URL.replace('https://', '')}</dd>
        </div>
      </dl>

      {syncState?.error ? (
        <p className="small" role="alert">
          {syncState.error.message}
        </p>
      ) : null}

      {syncState?.license && syncState.license !== 'ok' ? (
        <p className="small" role="alert">
          Account licence is {syncState.license}. Records are safe on this device but are not syncing.
        </p>
      ) : null}

      {signedIn ? <MediaSyncRow /> : null}
    </section>
  );
}

/**
 * Photos, which travel separately from records (FR-A01, FR-A03).
 *
 * Its own row because the two really are different guarantees, and conflating
 * them is how someone concludes their photos are backed up when only the
 * records are.
 *
 * It used to say runs happen on demand only, because "the first upload of a
 * whole library is a deliberate act". That was a good reason about the FIRST
 * upload and never a reason for the second photo, or the two hundredth, to sit
 * on one device until somebody remembered this button. Spec 014 made it
 * automatic; the button stays, because pressing it is how you find out whether
 * a deployment finally landed.
 */
/**
 * How a cadence reads to a person.
 *
 * "Every 180 minutes" is arithmetic; "Every 3 hours" is a sentence. Every
 * choice also says "and when photos change", because that half never stops -
 * turning the timer off does not turn syncing off, and a picker that implied
 * otherwise would be the more dangerous reading.
 */
function intervalLabel(minutes: number): string {
  if (minutes === 0) return 'Only when photos change';
  const every = minutes < 60
    ? `Every ${minutes} minutes`
    : minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`;
  return `${every}, and when photos change`;
}

function MediaSyncRow() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MediaSyncResult>();
  const blocker = mediaSyncBlocker();
  const auto = useAutoSyncState();
  const profile = useLiveQuery(() => db.users.get(LOCAL_PROFILE_ID));
  const minutes = profile?.settings.photoSyncMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES;

  const explanation: Record<string, string> = {
    'not-configured': 'Photo sync is not set up for this build.',
    'signed-out': 'Sign in to sync photos.',
    offline: 'Offline. Photos will sync when you have a connection.',
  };

  async function run() {
    setBusy(true);
    // Pressing the button is the deliberate act that says "try again anyway",
    // so it clears a pause before running rather than after: if the Worker is
    // now there, the automatic loop should start again with it.
    autoSync().resume();
    try {
      setResult(await runMediaSync());
    } catch (cause) {
      console.error('[sync] media run failed', cause);
      setResult(undefined);
    }
    setBusy(false);
  }

  const moved = (result?.upload?.uploaded ?? 0) + (result?.download?.downloaded ?? 0);
  const failed = (result?.upload?.failed ?? 0) + (result?.download?.failed ?? 0);

  /*
   * A failure nobody can wait out.
   *
   * On 2026-08-30 every photo on production failed because production's media
   * Worker had never been deployed - the URL answered Cloudflare's own "no
   * Worker here", not ours - and this panel said they "will be retried". Every
   * retry failed identically, and the screen kept promising the next one
   * would not. Saying which kind of failure it was is the difference between
   * an hour spent looking for a photo bug and a one-line answer.
   */
  const misconfigured = Boolean(
    result?.upload?.configurationFault || result?.download?.configurationFault,
  );
  const firstError = result?.upload?.firstError ?? result?.download?.firstError;

  return (
    <>
      <hr />
      <p className="small" style={{ marginBottom: 0 }}>Photos</p>
      {blocker ? (
        <p className="xs muted">{explanation[blocker]}</p>
      ) : (
        <>
          <button type="button" onClick={() => void run()} disabled={busy}>
            {busy ? 'Syncing photos…' : 'Sync photos now'}
          </button>
          {result ? (
            <p className="xs muted" style={{ marginBottom: 0 }}>
              {`${result.upload?.uploaded ?? 0} up, ${result.download?.downloaded ?? 0} down`}
              {failed > 0 ? `, ${failed} failed` : ''}
              {moved === 0 && failed === 0 ? ' — nothing to move' : ''}
            </p>
          ) : null}
          <label className="stack">
            <span className="xs muted">Sync photos automatically</span>
            <select
              value={minutes}
              onChange={(e) => void updateSettings({ photoSyncMinutes: Number(e.target.value) })}
            >
              {SYNC_INTERVAL_CHOICES.map((m) => (
                <option key={m} value={m}>{intervalLabel(m)}</option>
              ))}
            </select>
          </label>
          <p className="xs muted" style={{ marginBottom: 0 }}>
            {auto.paused ? (
              <>
                Automatic sync is paused: photo storage is not reachable, so a schedule would
                only fail on a timer. Press the button above once it is set up.
              </>
            ) : auto.lastRunAt ? (
              <>Last automatic run {new Date(auto.lastRunAt).toLocaleTimeString()} ({auto.lastReason}).</>
            ) : (
              <>No automatic run yet this session.</>
            )}
          </p>
          {failed > 0 ? (
            <p className="xs warn" role="alert" style={{ marginBottom: 0 }}>
              {misconfigured ? (
                <>
                  Photo storage is not reachable for this build, so retrying will not help until
                  it is set up. Your photos are safe on this device and nothing has been lost.
                </>
              ) : (
                <>Some photos did not transfer. They stay on this device and will be retried.</>
              )}
              {/* The verbatim reason, small and last. Useless to most readers
                  and the only thing that matters to whoever fixes it. */}
              {firstError && (
                <span className="faint data" style={{ display: 'block' }}>{firstError}</span>
              )}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

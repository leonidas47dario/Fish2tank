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
import { useEffect, useRef, useState } from 'react';
import { useObservable } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { CLOUD_DATABASE_URL, DEPLOYMENT } from '@/build-info';

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

export default function AccountPanel() {
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
            Your records sync to every device you sign in on. Photos still stay on the
            device that took them, until media sync ships.
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
    </section>
  );
}

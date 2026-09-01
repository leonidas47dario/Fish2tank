/**
 * The sign-in gate - spec 010 FR-A09.
 *
 * Reverses spec 005 FR-A05, which said an account is not a gate. That was
 * sound in the abstract and wrong in practice: a logged-out device worked
 * perfectly while silently accumulating catches, photos and tanks somewhere
 * that would not survive the device. The lost-phone case this whole feature
 * exists to prevent was the default state, and it looked healthy.
 *
 * THE GATE TESTS FOR A CACHED IDENTITY, NOT FOR A NETWORK. Logging a catch
 * happens in a fish store, and fish stores have bad signal. Dexie Cloud
 * persists the login in IndexedDB against a non-exportable keypair, so
 * `currentUser` resolves offline from the last successful sign-in. A device
 * that has ever signed in keeps working with no connection at all. Only a
 * device that has never signed in is stopped, and it has nothing to lose yet.
 *
 * Rendered by us rather than by flipping the addon's `requireAuth`, whose
 * dialog is unstyled and would arrive in the middle of the app's own visual
 * language. A gate we draw is a gate we can explain.
 *
 * Spec 013 adds one explicit exception - developer mode - so the deployed
 * builds can be driven without a Google account. It is not a secret and does
 * not pretend to be; see `data/dev-mode.ts`. What matters here is that it is
 * never silent: the banner rides above every route for as long as it is on.
 */
import { useEffect, useState } from 'react';
import { useObservable } from 'dexie-react-hooks';
import { BUILD_ID } from '@/build-info';
import { db } from '@/data/db';
import { DEVELOPER_MODE_EVENT, enterDeveloperMode, isDeveloperMode } from '@/data/dev-mode';
import { exportArchive } from '@/data/portability/export';
import {
  countPendingClaim,
  discardLocalRecords,
  tablesThisDeviceWouldPush,
  type PendingClaim,
} from '@/data/sync/joining-a-device';
import DeveloperBanner from './DeveloperBanner';
import { FishIcon, GoogleLogoIcon } from './Icons';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const user = useObservable(db.cloud.currentUser);
  const [busy, setBusy] = useState<'in' | 'replacing' | undefined>();
  const [problem, setProblem] = useState<string>();
  const [developer, setDeveloper] = useState(isDeveloperMode);
  /** `undefined` until counted. See the reconcile panel below (spec 022). */
  const [claim, setClaim] = useState<PendingClaim>();

  // Entering and leaving happen from two different subtrees (the gate below,
  // the banner above), so both go through the window event rather than lifting
  // state neither of them owns.
  useEffect(() => {
    const sync = () => setDeveloper(isDeveloperMode());
    window.addEventListener(DEVELOPER_MODE_EVENT, sync);
    // `storage` covers a second tab in the same browser.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DEVELOPER_MODE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  /**
   * What this device would push over the account if it signed in right now.
   *
   * Spec 020 BUG-08. Counted before the login rather than after, because after
   * is too late: the addon's first sync sends every local row of every
   * not-yet-synced table as a whole-object upsert and the account's version of
   * those keys never comes back.
   *
   * Almost always zero, and when it is, nothing below changes.
   */
  const signedOut = user !== undefined && !user.isLoggedIn;
  useEffect(() => {
    if (!signedOut) return;
    let cancelled = false;
    countPendingClaim(db, tablesThisDeviceWouldPush(db))
      .then((counted) => {
        if (cancelled) return;
        setClaim(counted);
        if (counted.total > 0) {
          console.warn('[join] this device holds records the account has not seen', {
            rows: counted.total, byTable: counted.byTable,
          });
        }
      })
      .catch((err) => {
        // Not fatal, but not silent either: failing to count means the gate
        // shows the plain button and the overwrite goes ahead unannounced.
        console.error('[join] could not count what this device would push', err);
      });
    return () => {
      cancelled = true;
    };
  }, [signedOut]);

  // `undefined` means the observable has not emitted yet, which is a different
  // thing from "signed out" and must not flash the gate at someone who is
  // signed in. Dexie resolves this from IndexedDB, so it is brief and offline.
  if (user === undefined) return null;

  if (user.isLoggedIn) return <>{children}</>;

  // Signed out but let in on purpose. The banner is not optional - it is the
  // whole reason this exception is allowed to exist.
  if (developer) {
    return (
      <>
        <DeveloperBanner />
        {children}
      </>
    );
  }

  async function signIn() {
    setBusy('in');
    setProblem(undefined);
    try {
      await db.cloud.login({ provider: 'google' });
    } catch (cause) {
      // Never swallowed: this screen is the only thing between someone and
      // their collection, so a failure here has to say what happened.
      console.error('[sync] sign-in failed', cause);
      setProblem(cause instanceof Error ? cause.message : String(cause));
      setBusy(undefined);
    }
  }

  /**
   * Take the account's copy: back up, drop this device's records, then sign in.
   *
   * The order is the safety. The backup is a real downloaded file before
   * anything is cleared, and a failed export aborts with nothing touched -
   * because in the one case this is the wrong choice (this device holds the
   * only copy) the archive is all that is left of it.
   */
  async function useAccountCopy() {
    if (!claim) return;
    setBusy('replacing');
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
      console.info('[join] backup written before discarding', {
        filename, rows, media: manifest.media.count,
      });

      await discardLocalRecords(db, claim.tables);
      setClaim({ byTable: {}, total: 0, tables: claim.tables });
      await db.cloud.login({ provider: 'google' });
    } catch (cause) {
      console.error('[join] could not replace this device\'s copy', cause);
      setProblem(
        `${cause instanceof Error ? cause.message : String(cause)} `
        + '- nothing was signed in. Your records on this device are as they were.',
      );
      setBusy(undefined);
    }
  }

  return (
    <main className="app gate">
      <div className="gate__panel stack">
        <FishIcon size={44} weight="fill" aria-hidden="true" className="gate__mark" />
        <h1>Fish2Tank</h1>

        {claim && claim.total > 0 ? (
          <ReconcilePanel
            claim={claim}
            busy={busy}
            onUseAccount={() => void useAccountCopy()}
            onKeepDevice={() => void signIn()}
          />
        ) : (
          <>
            <p className="muted">
              Sign in to open your collection. Your catches, tanks and photos are tied to your
              account so they survive a lost phone.
            </p>

            <button
              type="button"
              className="gate__button"
              onClick={() => void signIn()}
              disabled={Boolean(busy)}
            >
              <GoogleLogoIcon size={20} weight="bold" aria-hidden="true" />
              {busy ? 'Opening Google…' : 'Sign in with Google'}
            </button>
          </>
        )}

        {problem ? (
          <p className="small" role="alert">{problem}</p>
        ) : null}

        <p className="xs muted" style={{ marginBottom: 0 }}>
          You only need to do this once on each device. After that it works with no signal,
          which matters in a fish shop.
        </p>

        <DeveloperEntry />
      </div>
    </main>
  );
}

/** Table names as a keeper would say them. Anything unlisted reads as itself. */
const RECORD_NAMES: Record<string, [one: string, many: string]> = {
  aquariums: ['tank', 'tanks'],
  holdings: ['fish', 'fish'],
  specimens: ['catch', 'catches'],
  encounters: ['encounter', 'encounters'],
  media: ['photo record', 'photo records'],
  places: ['place', 'places'],
  residencies: ['tank placement', 'tank placements'],
  lifeEvents: ['life event', 'life events'],
  dreamList: ['dream list entry', 'dream list entries'],
  users: ['profile', 'profile'],
};

function describe(table: string, rows: number): string {
  const [one, many] = RECORD_NAMES[table] ?? [table, table];
  return `${rows} ${rows === 1 ? one : many}`;
}

/**
 * The choice a joining device has to be offered - spec 022 FR-A11.
 *
 * WHY THIS EXISTS AT ALL. Dexie Cloud's first sync after a login pushes every
 * local row of every not-yet-synced table up as a whole-object upsert, and the
 * account's version of any key it collides with is discarded without ever
 * being shown. Six tanks, the seeded store and the profile all use hardcoded
 * ids, so a device that predates sync overwrites those records on the account
 * every single time it signs in. That is how tank edits have been going
 * missing.
 *
 * WHY IT IS A QUESTION AND NOT A RULE. "Always take the account's copy" is
 * what was asked for and it is wrong in exactly one case, which happens to be
 * the case sync was built for: the first device to sign in holds the only copy
 * and the account is empty. From here those two situations are identical, so
 * this asks, defaults to the safe answer, and takes a backup either way.
 */
function ReconcilePanel({
  claim, busy, onUseAccount, onKeepDevice,
}: {
  claim: PendingClaim;
  busy: 'in' | 'replacing' | undefined;
  onUseAccount: () => void;
  onKeepDevice: () => void;
}) {
  const parts = Object.entries(claim.byTable)
    .sort(([, a], [, b]) => b - a)
    .map(([table, rows]) => describe(table, rows));

  return (
    <>
      <p className="muted">
        This device already holds <strong>{claim.total} records</strong> that have never
        reached an account: {parts.join(', ')}. Signing in has to decide which copy is
        the real one, so it is asking rather than guessing.
      </p>

      <button
        type="button"
        className="gate__button"
        onClick={onUseAccount}
        disabled={Boolean(busy)}
      >
        <GoogleLogoIcon size={20} weight="bold" aria-hidden="true" />
        {busy === 'replacing' ? 'Backing up, then signing in…' : 'Use my account\'s copy'}
      </button>
      <p className="xs muted">
        The usual answer on a phone, tablet or second browser. Saves a backup file of
        what is here first, then replaces it with whatever your account holds. Photos
        already on this device stay where they are.
      </p>

      <button type="button" onClick={onKeepDevice} disabled={Boolean(busy)}>
        {busy === 'in' ? 'Opening Google…' : 'Keep what is on this device'}
      </button>
      <p className="xs muted" style={{ marginBottom: 0 }}>
        Right only if this device has the collection and your account does not. These
        records will be uploaded, and where the two disagree the account's version is
        replaced and cannot be recovered.
      </p>
    </>
  );
}

/**
 * The way in for automated checks - spec 013.
 *
 * Closed by default and worded flatly, because it must not read as a second
 * way to open your collection competing with the button above it. It is not:
 * it opens an empty, signed-out app on this device and unlocks nothing that
 * lives anywhere else.
 */
function DeveloperEntry() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setWrong(false);
    // enterDeveloperMode raises the event the gate is listening for, so a
    // match re-renders this component straight out of existence.
    if (!(await enterDeveloperMode(value))) setWrong(true);
    setChecking(false);
  }

  if (!open) {
    return (
      <button type="button" className="gate__dev" onClick={() => setOpen(true)}>
        Developer mode
      </button>
    );
  }

  return (
    <form className="stack gate__devform" onSubmit={(e) => void submit(e)}>
      <label className="stack">
        <span className="xs muted">Developer passphrase</span>
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={wrong || undefined}
          autoFocus
        />
      </label>
      <button type="submit" disabled={checking || value.length === 0}>
        {checking ? 'Checking…' : 'Open without an account'}
      </button>
      {wrong ? (
        <p className="xs warn" role="alert" style={{ marginBottom: 0 }}>
          That passphrase does not match. Nothing has changed.
        </p>
      ) : null}
      <p className="xs muted" style={{ marginBottom: 0 }}>
        Opens this device signed out, with an empty collection. It does not sign you in
        and cannot reach anybody's records or photos.
      </p>
    </form>
  );
}

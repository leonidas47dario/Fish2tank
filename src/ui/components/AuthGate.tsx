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
import { db } from '@/data/db';
import { DEVELOPER_MODE_EVENT, enterDeveloperMode, isDeveloperMode } from '@/data/dev-mode';
import DeveloperBanner from './DeveloperBanner';
import { FishIcon, GoogleLogoIcon } from './Icons';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const user = useObservable(db.cloud.currentUser);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [developer, setDeveloper] = useState(isDeveloperMode);

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
    setBusy(true);
    setProblem(undefined);
    try {
      await db.cloud.login({ provider: 'google' });
    } catch (cause) {
      // Never swallowed: this screen is the only thing between someone and
      // their collection, so a failure here has to say what happened.
      console.error('[sync] sign-in failed', cause);
      setProblem(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <main className="app gate">
      <div className="gate__panel stack">
        <FishIcon size={44} weight="fill" aria-hidden="true" className="gate__mark" />
        <h1>Fish2Tank</h1>
        <p className="muted">
          Sign in to open your collection. Your catches, tanks and photos are tied to your
          account so they survive a lost phone.
        </p>

        <button type="button" className="gate__button" onClick={() => void signIn()} disabled={busy}>
          <GoogleLogoIcon size={20} weight="bold" aria-hidden="true" />
          {busy ? 'Opening Google…' : 'Sign in with Google'}
        </button>

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

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
 */
import { useState } from 'react';
import { useObservable } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { FishIcon, GoogleLogoIcon } from './Icons';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const user = useObservable(db.cloud.currentUser);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  // `undefined` means the observable has not emitted yet, which is a different
  // thing from "signed out" and must not flash the gate at someone who is
  // signed in. Dexie resolves this from IndexedDB, so it is brief and offline.
  if (user === undefined) return null;

  if (user.isLoggedIn) return <>{children}</>;

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
      </div>
    </main>
  );
}

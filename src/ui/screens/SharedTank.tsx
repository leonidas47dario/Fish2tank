/**
 * Somebody else's tank, opened by a stranger - spec 023.
 *
 * THE ONLY ROUTE IN THIS APP THAT RENDERS WITHOUT AN ACCOUNT. It reads one
 * public file from the Worker and draws it with the same components the
 * owner's screen uses, so what a guest sees is what the keeper sees.
 *
 * It touches no database. There is nothing here to read from one: the visitor
 * has never used this app, the tank is not theirs, and the snapshot already
 * carries the numbers the owner's device computed. That is what keeps a fresh
 * browser from having to seed anything before the page can draw.
 *
 * IT IS ALSO THE TOP OF A FUNNEL. A stranger looking at a tank of fish is the
 * most interested this app's audience ever gets, so the two things they might
 * want - THIS fish, and to READ about this fish - are two separate targets on
 * a tile, and the tap they made survives the sign-in.
 *
 * Spec 025 wired the second of those. Until then a tile was a plain div with a
 * heart on it: opening a fish had been specified, typed into PendingIntent and
 * branched on by the consumer, and never built. The branch that existed would
 * have HEARTED a fish somebody asked to read about.
 *
 * BEING SIGNED IN DOES NOT CHANGE WHAT THIS ROUTE RENDERS, and must not. A
 * share link has to show the share - to a keeper checking their own link, to a
 * signed-in friend following it. What signing in changes is that a tile can
 * now open the real catalog entry, and that the way into the app is offered.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useObservable } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { addToDreamList } from '@/data/repositories';
import { MEDIA_WORKER_URL } from '@/build-info';
import { remember, takePending } from '@/data/share/pending-intent';
import type { PublicSnapshot, SharedResident } from '@/data/share/snapshot';
import type { TankResident } from '@/domain/tank-stats';
import { TankViewer } from '../components/tank/TankViewer';
import { FishIcon, GoogleLogoIcon, HeartIcon } from '../components/Icons';
import { portraitAsset } from '@/data/catalog';
import { peekRows } from './shared-peek';

type LoadState =
  | { status: 'loading' }
  | { status: 'gone' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; snapshot: PublicSnapshot };

export default function SharedTank() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const user = useObservable(db.cloud?.currentUser);
  const signedIn = Boolean(user?.isLoggedIn);
  const [wanted, setWanted] = useState<SharedResident>();
  /** The fish a signed-out guest asked to read about (spec 025). */
  const [peeked, setPeeked] = useState<SharedResident | undefined>();
  const [hearted, setHearted] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    if (!MEDIA_WORKER_URL) {
      setState({ status: 'failed', reason: 'This build cannot open shared tanks.' });
      return;
    }
    console.info('[share] opening a shared tank', { token, worker: MEDIA_WORKER_URL });

    void (async () => {
      try {
        const res = await fetch(`${MEDIA_WORKER_URL}/shared/${token}`);
        if (!live) return;
        if (res.status === 404) {
          console.info('[share] shared tank -> no such share', { token });
          setState({ status: 'gone' });
          return;
        }
        if (!res.ok) {
          console.error('[share] shared tank -> failed', { token, status: res.status });
          setState({ status: 'failed', reason: `The page could not be loaded (${res.status}).` });
          return;
        }
        const snapshot = (await res.json()) as PublicSnapshot;
        console.info('[share] shared tank -> ok', {
          token, tank: snapshot.tank?.name, residents: snapshot.residents?.length,
        });
        setState({ status: 'ready', snapshot });
      } catch (cause) {
        if (!live) return;
        // Never swallowed: offline and "the Worker is down" look identical to
        // somebody holding a phone, and both need saying out loud.
        console.error('[share] shared tank -> could not be reached', { token, cause: String(cause) });
        setState({ status: 'failed', reason: 'This page could not be reached. Check your connection.' });
      }
    })();

    return () => { live = false; };
  }, [token]);

  const heart = useCallback(async (speciesId: string) => {
    await addToDreamList(speciesId);
    setHearted((prev) => new Set(prev).add(speciesId));
    console.info('[share] added to dream list', { speciesId, token });
  }, [token]);

  /*
   * FR-S06. Whatever the guest was trying to do before signing in, do it now.
   *
   * Runs when the session becomes logged in, which covers both shapes of the
   * Google flow: a popup that resolves in this page, and a full redirect that
   * comes back to a fresh one. `takePending` consumes, so this cannot re-fire.
   */
  useEffect(() => {
    if (!signedIn) return;
    const intent = takePending();
    if (!intent) return;
    console.info('[share] replaying the intent from before sign-in', intent);
    // Spec 025. These used to collapse into one branch, so asking to READ
    // about a fish silently added it to a Dream List instead. Two wants, two
    // outcomes: `profile` opens the catalog entry, `heart` hearts.
    if (intent.action === 'profile') {
      navigate(`/species/${intent.speciesId}`);
      return;
    }
    void heart(intent.speciesId);
  }, [signedIn, heart, navigate]);

  if (state.status === 'loading') return <p className="muted">Loading…</p>;

  if (state.status === 'gone') {
    return (
      <SharedShell>
        <p className="empty">
          This link has been turned off. Whoever shared it can send you a new one.
        </p>
      </SharedShell>
    );
  }

  if (state.status === 'failed') {
    return (
      <SharedShell>
        <p className="warn">{state.reason}</p>
      </SharedShell>
    );
  }

  const { snapshot } = state;
  const residents = snapshot.residents.map((r, i) => asResident(r, i, token));
  const photoKey = snapshot.tank.photoBlobKey;

  return (
    <SharedShell>
      <header className="stack">
        {photoKey && (
          // Straight at the Worker, which checks the manifest and redirects to
          // a presigned URL. Lazy, because it is the keeper's untouched
          // original and can be several megabytes.
          <img
            className="sharedtank__photo"
            src={`${MEDIA_WORKER_URL}/shared/${token}/media/${photoKey}`}
            alt=""
            loading="lazy"
          />
        )}
        <p className="xs muted" style={{ marginBottom: 0 }}>A tank shared with you</p>
        <h1 style={{ marginBottom: 0 }}>{snapshot.tank.name}</h1>
        <p className="muted small data" style={{ marginBottom: 0 }}>
          {snapshot.tank.volume
            ? `${snapshot.tank.volume.value} ${snapshot.tank.volume.unit}`
            : 'volume unrecorded'}
          {' · '}{snapshot.stats.fish} fish · {snapshot.stats.species} species
        </p>
      </header>

      <TankViewer
        tankName={snapshot.tank.name}
        residents={residents}
        stats={snapshot.stats}
        renderTile={(r, content) => {
          const speciesId = r.speciesId;
          // No species means nothing to want and nothing to read. An honest
          // plain tile, exactly as the owner's own screen shows it.
          if (!speciesId) return <div className="tank-tile tank-tile--plain">{content}</div>;
          const already = hearted.has(speciesId);
          const resident = snapshot.residents.find((s) => s.speciesId === speciesId);
          // Not `--plain`: that is the owner's dimmed treatment for a fish the
          // catalog could not name, and applying it here would fade the whole
          // grid for no reason.
          return (
            <div className="tank-tile">
              {/*
                Spec 025. The tile itself opens the fish, which it could not do
                before. Signed in that is the real catalog entry; signed out it
                is the peek, because asking for an account before showing
                anything is the request everybody dismisses.
              */}
              <button
                type="button"
                className="tank-tile__open"
                aria-label={`Read about ${r.commonName}`}
                onClick={() => {
                  if (signedIn) { navigate(`/species/${speciesId}`); return; }
                  setPeeked(resident);
                }}
              >
                {content}
              </button>
              <button
                type="button"
                className="tank-tile__heart"
                aria-pressed={already}
                aria-label={already ? `${r.commonName} is on your Dream List` : `Want a ${r.commonName}`}
                onClick={() => {
                  if (already) return;
                  if (signedIn) { void heart(speciesId); return; }
                  setWanted(snapshot.residents.find((s) => s.speciesId === speciesId));
                }}
              >
                <HeartIcon size={18} weight={already ? 'fill' : 'regular'} aria-hidden="true" />
              </button>
            </div>
          );
        }}
      >
        {wanted && !signedIn && (
          <JoinPrompt
            resident={wanted}
            token={token}
            onDismiss={() => setWanted(undefined)}
          />
        )}
        {peeked && !signedIn && (
          <ProfilePeek
            resident={peeked}
            token={token}
            onDismiss={() => setPeeked(undefined)}
          />
        )}
        {hearted.size > 0 && (
          <p className="xs muted" aria-live="polite" style={{ marginBottom: 0 }}>
            {hearted.size === 1 ? 'One fish added' : `${hearted.size} fish added`} to your Dream List.
          </p>
        )}
        {/*
          Spec 025. Signing in leaves a guest here, which is right - they were
          reading a tank and should not be yanked out of it - but it must not
          be a dead end. Offered, never forced: redirecting a signed-in visitor
          off this route would stop a share link showing the share.
        */}
        {signedIn && (
          <Link className="btn--ghost sharedtank__enter" to="/">
            Open Fish2Tank
          </Link>
        )}
      </TankViewer>
    </SharedShell>
  );
}

/**
 * What a signed-out guest gets when they ask to read about a fish (spec 025).
 *
 * THE BLUR IS AN INVITATION, NOT A LOCK. Every value behind it is already in
 * the published JSON that anyone holding this link can fetch directly, so
 * nothing here is protected and this code must not pretend otherwise. What is
 * actually behind the account is the app: the Dream List, the tank you measure
 * against, the honest read on whether this fish could live in it.
 *
 * It shows the fish first and asks second, which is the opposite of the heart
 * path and the reason that one leaks: an account request with nothing shown
 * yet is a request to trust a stranger's link.
 */
function ProfilePeek({ resident, token, onDismiss }: {
  resident: SharedResident;
  token: string;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function open() {
    setBusy(true);
    setProblem(undefined);
    // Written BEFORE the login call: Google can return through a full-page
    // redirect, and anything held only in memory is gone by then. `profile`
    // rather than `heart` - they asked to read, not to want.
    remember({
      action: 'profile',
      speciesId: resident.speciesId!,
      returnTo: `/share/${token}`,
    });
    try {
      await db.cloud.login({ provider: 'google' });
    } catch (cause) {
      console.error('[share] sign-in from a shared tank peek failed', cause);
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const rows = peekRows(resident);

  return (
    <section className="card stack">
      <strong>{resident.commonName}</strong>
      {resident.scientificName && (
        <p className="sci xs muted" style={{ marginBottom: 0 }}>{resident.scientificName}</p>
      )}

      {rows.length > 0 ? (
        <dl className="peek" aria-hidden="true">
          {rows.map((row) => (
            <div className="peek__row" key={row.label}>
              <dt className="xs muted">{row.label}</dt>
              <dd className="peek__value data">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="small muted" style={{ marginBottom: 0 }}>
          Nobody has measured this one yet.
        </p>
      )}

      <p className="small muted" style={{ marginBottom: 0 }}>
        Sign in to read the full profile in the catalog - care, compatibility with
        the tank you actually have, and what one costs near you.
      </p>
      <button type="button" className="btn--primary" disabled={busy} onClick={() => void open()}>
        <GoogleLogoIcon size={18} weight="bold" aria-hidden="true" />
        {busy ? ' Opening...' : ' Continue with Google'}
      </button>
      <button type="button" className="btn--ghost" onClick={onDismiss}>
        Not now
      </button>
      {problem && <p className="warn small" style={{ marginBottom: 0 }}>{problem}</p>}
    </section>
  );
}

/**
 * The offer, made at the moment somebody wants something.
 *
 * States plainly what signing in gets them and what happens to the tap they
 * already made, because "sign in to continue" with no object is the thing
 * everybody dismisses.
 */
function JoinPrompt({ resident, token, onDismiss }: {
  resident: SharedResident;
  token: string;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function join() {
    setBusy(true);
    setProblem(undefined);
    // Written BEFORE the login call: Google can return through a full-page
    // redirect, and anything held only in memory is gone by then.
    remember({
      action: 'heart',
      speciesId: resident.speciesId!,
      returnTo: `/share/${token}`,
    });
    try {
      await db.cloud.login({ provider: 'google' });
    } catch (cause) {
      console.error('[share] sign-in from a shared tank failed', cause);
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <strong>Want a {resident.commonName}?</strong>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Fish2Tank keeps a Dream List of the fish you are looking for, and tells you
        whether one would actually fit the tank you have. Make an account and this
        {' '}{resident.commonName} goes straight onto your list.
      </p>
      <button type="button" className="btn--primary" disabled={busy} onClick={() => void join()}>
        <GoogleLogoIcon size={18} weight="bold" aria-hidden="true" />
        {busy ? ' Opening…' : ' Continue with Google'}
      </button>
      <button type="button" className="btn--ghost" onClick={onDismiss}>
        Not now
      </button>
      {problem && <p className="warn small" style={{ marginBottom: 0 }}>{problem}</p>}
    </section>
  );
}

/** The frame. No bottom nav and no profile button: this is not their app yet. */
function SharedShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app stack sharedtank">
      {children}
      <footer className="card stack sharedtank__footer">
        <strong><FishIcon size={18} weight="fill" aria-hidden="true" /> Fish2Tank</strong>
        <p className="xs muted" style={{ marginBottom: 0 }}>
          Catch the encounter, keep every story. Photograph a fish in a shop, find out what it is,
          and get an honest read on whether it could live in your tank.
        </p>
      </footer>
    </main>
  );
}

/**
 * A published resident, shaped for the components the owner's screen uses.
 *
 * `holding` is the awkward part: `TankResident` carries the whole record and a
 * guest is deliberately never sent one, so a stand-in is built from the
 * species id. Only two things read it - the React key and the editor, and the
 * editor never runs here. The portrait comes from the guest's own bundled
 * assets, because that is where the owner's came from too (`portraitAsset`).
 */
/**
 * One published resident, as the grid wants it.
 *
 * THE KEEPER'S OWN PHOTOGRAPH WINS (spec 026), served through the Worker's
 * share-media route, which checks the key against the manifest's allowlist
 * before redirecting to a presigned URL. Spec 023 drew the bundled portrait
 * unconditionally here, which is what made a shared tank a wall of stock
 * images - and contradicted the ask it was built from, "anyone should be able
 * to review the page and see the exact same thing".
 *
 * The fallback order is the same one `chooseArt` applies on the owner's
 * screen, arrived at the other way round: the publisher already resolved WHICH
 * photo this fish wears, so there is no second opinion to have here - either a
 * key was published or the portrait stands.
 */
function asResident(resident: SharedResident, index: number, token: string): TankResident {
  const own = resident.photoBlobKey
    ? `${MEDIA_WORKER_URL}/shared/${token}/media/${resident.photoBlobKey}`
    : undefined;
  return {
    holding: { id: `shared_${resident.speciesId ?? index}` } as TankResident['holding'],
    quantity: resident.quantity,
    speciesId: resident.speciesId,
    commonName: resident.commonName,
    scientificName: resident.scientificName,
    artUrl: own ?? (resident.speciesId ? portraitAsset(resident.speciesId) : undefined),
    adultSizeIn: resident.adultSizeIn,
    minVolumeGal: resident.minVolumeGal,
    aggression: resident.aggression,
    waterZone: resident.waterZone,
    unitPrice: resident.unitPrice,
  };
}

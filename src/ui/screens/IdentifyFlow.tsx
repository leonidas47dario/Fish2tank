/**
 * Capture → identify → reveal, as one motion.
 *
 * WHAT THIS REPLACES. The loop used to be three places: capture dumped you on
 * the specimen page, where you had to find the identity block, type a search,
 * pick a species, then scroll further down and press Reveal. Four deliberate
 * acts, none of them signposted, for the thing the app exists to do.
 *
 * ON VISUAL SEARCH. There is no public Google Lens API. The PRD says so and
 * says what to do instead - FR-I03: "Provide an external visual-search handoff
 * where the platform permits. The product does not claim embedded Google Lens
 * capability; the user returns and confirms the result manually." So the photo
 * goes to Lens only through a share sheet the user taps, and the work this
 * screen does is the half that comes after: turning whatever words come back
 * into a shortlist of real catalog species.
 *
 * NOTHING HERE CAN LOSE A CATCH. The draft is written by createCatchDraft()
 * before this screen mounts. Every step can be skipped, the back button is
 * safe, and closing the tab mid-flow leaves a saved Unknown specimen - which
 * FR-I01 says is a perfectly valid state to keep forever.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { blobFor, db } from '@/data/db';
import { CATALOG } from '@/data/catalog';
import { canShareFiles, identifyFromText, isConfident, type Candidate } from '@/data/identify';
import { assertIdentity, revealSpecimen } from '@/data/repositories';
import type { RaritySnapshot } from '@/domain/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSpecimenMedia } from '../hooks';
import { RevealCeremony } from '../components/RevealCeremony';

type Step = 'identify' | 'reveal';

export default function IdentifyFlow() {
  const { specimenId } = useParams<{ specimenId: string }>();
  const navigate = useNavigate();
  /**
   * Wrapped in an envelope rather than using the shared `useSpecimen` hook.
   *
   * Dexie's `.get()` resolves to `undefined` for a row that does not exist,
   * and `useLiveQuery` also yields `undefined` while it is still running - so
   * "loading" and "not found" are the same value and a bad id would spin
   * forever. The extra flag makes them distinguishable. This matters more here
   * than elsewhere because the id comes from the URL, so it can be wrong.
   */
  const found = useLiveQuery(
    async () => ({ specimen: specimenId ? await db.specimens.get(specimenId) : undefined }),
    [specimenId],
  );
  const specimen = found?.specimen;
  const media = useSpecimenMedia(specimenId);

  const [step, setStep] = useState<Step>('identify');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<RaritySnapshot | undefined>();
  const [shareFile, setShareFile] = useState<File | undefined>();

  const photo = media?.[0];

  /**
   * The original blob as a File, so the share sheet has something to hand over.
   *
   * Object URLs are useless for this - navigator.share wants a real File - so
   * the blob comes back out of IndexedDB. Read once, when the media appears.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!photo || photo.media.kind !== 'photo') return;
      const blob = blobFor(await db.blobs.get(photo.media.originalBlobKey));
      if (!blob || cancelled) return;
      const ext = blob.type.includes('png') ? 'png' : 'jpg';
      setShareFile(new File([blob], `catch.${ext}`, { type: blob.type || 'image/jpeg' }));
    })();
    return () => { cancelled = true; };
  }, [photo]);

  const candidates: Candidate[] = useMemo(
    () => (query.trim() ? identifyFromText(query, CATALOG.species) : []),
    [query],
  );
  const confident = isConfident(candidates);
  const canShare = shareFile ? canShareFiles([shareFile]) : false;

  async function onShare() {
    if (!shareFile) return;
    setError(undefined);
    try {
      await navigator.share({
        files: [shareFile],
        title: 'What fish is this?',
        text: 'Identify this fish',
      });
    } catch (e) {
      // Cancelling the share sheet rejects with AbortError. That is the user
      // changing their mind, not a failure worth shouting about.
      if (e instanceof Error && e.name === 'AbortError') return;
      setError('This device would not open the share sheet. Search by name instead.');
    }
  }

  async function onConfirm(speciesId: string) {
    if (!specimenId) return;
    setBusy(true);
    setError(undefined);
    try {
      // Supersedes any earlier assertion rather than overwriting it (FR-I06),
      // and is recorded as user-confirmed, never as an AI percentage (FR-I04).
      await assertIdentity({ specimenId, speciesId, source: 'user', status: 'user-confirmed' });
      const snap = await revealSpecimen(specimenId);
      setSnapshot(snap);
      setStep('reveal');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that identification.');
    } finally {
      setBusy(false);
    }
  }

  const done = () => navigate(`/specimen/${specimenId}`, { replace: true });

  if (found === undefined) return <p className="muted small">Loading…</p>;
  if (!specimen) {
    return (
      <div className="stack">
        <p className="empty">That catch is not on this device.</p>
        <button type="button" onClick={() => navigate('/catch')}>Back to Catch</button>
      </div>
    );
  }

  if (step === 'reveal') {
    return (
      <div className="stack identify">
        {snapshot ? (
          <RevealCeremony
            snapshot={snapshot}
            commonName={CATALOG.species.find((s) => s.speciesId === specimen.speciesId)?.commonName ?? 'Unknown'}
            scientificName={CATALOG.species.find((s) => s.speciesId === specimen.speciesId)?.scientificName}
            golden={Boolean(specimen.golden)}
          />
        ) : (
          /* revealSpecimen returns nothing if a snapshot already existed. The
             identification still saved, so say that plainly rather than
             showing an empty stage. */
          <p className="empty">Identity saved. This one was already revealed.</p>
        )}
        <button type="button" className="btn--primary btn--big" onClick={done}>
          See the full record
        </button>
      </div>
    );
  }

  return (
    <div className="stack identify">
      <header>
        <h1>What is it?</h1>
        <p className="muted small">
          Already saved as a draft. Name it now or leave it Unknown — both are fine.
        </p>
      </header>

      {photo?.url && <img className="identify__shot media" src={photo.url} alt="The fish you just caught" />}

      <div className="row">
        {canShare && (
          <button type="button" className="btn--primary grow" onClick={() => void onShare()}>
            🔍 Look it up
          </button>
        )}
        <button type="button" className={canShare ? '' : 'grow'} onClick={done}>
          Not yet
        </button>
      </div>

      {canShare && (
        <p className="xs muted">
          Hands the photo to Google Lens or whichever visual search you have installed. It leaves
          this device only when you tap that, and only to the app you choose. Come back with a name
          and type it below — nothing is confirmed for you.
        </p>
      )}

      <label htmlFor="idq">Search the catalog</label>
      <input
        id="idq"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Paste a name, or type what the tag said…"
        aria-label="Search for the species by name"
      />

      {error && <p className="warn">{error}</p>}

      {query.trim() && candidates.length === 0 && (
        <p className="empty">
          Nothing in the catalog matches that. Leave it Unknown and the record still keeps your
          photo and the store label.
        </p>
      )}

      {candidates.length > 0 && (
        <>
          {/* FR-I04: ordering is the only confidence signal. No percentages. */}
          <p className="xs muted">
            {confident
              ? 'Closest match first. Check it against your photo before confirming.'
              : 'Several of these fit equally well. Pick the one that matches your photo.'}
          </p>
          <ul className="list identify__hits">
            {candidates.map((c, i) => (
              <li key={c.species.speciesId}>
                <button
                  type="button"
                  className={`card spread identify__hit ${i === 0 && confident ? 'identify__hit--lead' : ''}`}
                  disabled={busy}
                  onClick={() => void onConfirm(c.species.speciesId)}
                >
                  <span>
                    <strong>{c.species.commonName}</strong>
                    {c.species.scientificName && (
                      <><br /><span className="xs sci muted">{c.species.scientificName}</span></>
                    )}
                  </span>
                  <span className="xs muted">{VIA_LABEL[c.via]}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Why a candidate is on the list. Saying so beats a number that means nothing. */
const VIA_LABEL: Record<Candidate['via'], string> = {
  'scientific-name': 'scientific name',
  'common-name': 'common name',
  alias: 'trade name',
  'word-overlap': 'partial match',
};

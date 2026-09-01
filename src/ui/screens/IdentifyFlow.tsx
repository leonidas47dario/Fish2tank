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
import { identityStatusFor } from '@/data/catalog';
import { canShareFiles, identifyFromText, isConfident, shareForLens, type Candidate } from '@/data/identify';
import { assertIdentity, revealSpecimen, submitUserSpecies } from '@/data/repositories';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  useCatalogCard, useIsFirstOfSpecies, useMediaUrl, useSearchableSpecies, useSpecimenMedia,
} from '../hooks';
import type { RevealOutcome } from '@/data/repositories';
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
  const card = useCatalogCard(specimen?.speciesId) ?? undefined;
  const isFirst = useIsFirstOfSpecies(specimenId, specimen?.speciesId);

  const [step, setStep] = useState<Step>('identify');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<RevealOutcome | undefined>();
  const [shareFile, setShareFile] = useState<File | undefined>();

  const photo = media?.[0];
  /*
   * Spec 036: the shot fills the width of the screen, so it takes the preview
   * rather than the strip-sized thumbnail `useSpecimenMedia` yields.
   */
  const photoUrl = useMediaUrl(photo?.media, 'preview');

  /**
   * The original blob as a File, so the share sheet has something to hand over.
   *
   * Object URLs are useless for this - navigator.share wants a real File - so
   * the blob comes back out of IndexedDB. Read once, when the media appears.
   *
   * DELIBERATELY THE ORIGINAL, not the preview spec 036 introduced everywhere
   * else. This hands a file to another application. Passing on a re-encoded
   * 1280-pixel copy of someone's photograph because it was cheaper to read
   * would be the app quietly degrading the very thing it was asked to share.
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

  /**
   * Spec 007: the catalog PLUS anything this keeper has submitted before.
   *
   * Searching the mart alone meant a species you had already typed in once was
   * invisible the second time you met the fish, and the only way through was
   * "log it as is" again - typing the same name into a row that already exists.
   */
  const corpus = useSearchableSpecies();
  const candidates: Candidate[] = useMemo(
    () => (query.trim() ? identifyFromText(query, corpus) : []),
    [query, corpus],
  );
  const confident = isConfident(candidates);
  const canShare = shareFile ? canShareFiles([shareFile]) : false;

  async function onShare() {
    if (!shareFile) return;
    setError(undefined);
    const result = await shareForLens(shareFile);
    if (result === 'unavailable') {
      setError('This device would not open the share sheet. Search by name instead.');
    }
  }

  async function onConfirm(speciesId: string) {
    if (!specimenId) return;
    setBusy(true);
    setError(undefined);
    try {
      // Supersedes any earlier assertion rather than overwriting it (FR-I06),
      // and is recorded by the user, never as an AI percentage (FR-I04).
      //
      // Since spec 007 the corpus includes the keeper's own submissions, so one
      // can be PICKED here and not only typed. identityStatusFor() is what keeps
      // that from silently promoting an invented name to a confirmed species.
      await assertIdentity({
        specimenId, speciesId, source: 'user', status: identityStatusFor(speciesId),
      });
      setOutcome(await revealSpecimen(specimenId));
      setStep('reveal');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that identification.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The escape for a fish the catalog does not contain.
   *
   * Records the keeper's wording as its own `user-submitted` species and
   * leaves identityStatus `provisional`. Deliberately does NOT reveal:
   * Discovery reads market evidence for a species, and a species nobody sells
   * under this name has none - a ceremony over an empty result would be a
   * worse answer than going straight to the record.
   */
  async function onLogAsIs(label: string) {
    if (!specimenId) return;
    setBusy(true);
    setError(undefined);
    try {
      await submitUserSpecies({ specimenId, label });
      navigate(`/specimen/${specimenId}`, { replace: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[identify] could not log the species', { specimenId, label, error: message });
      setError('Could not save that name.');
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
    /* Four outcomes, and each says a different true thing. The old code had
       two and collapsed a refusal into "already revealed", which told the user
       something false about their own record. */
    const rated = outcome?.status === 'revealed' || outcome?.status === 'already-revealed';
    return (
      <div className="stack identify">
        {card && outcome ? (
          rated || outcome.status === 'no-market-evidence' ? (
            <RevealCeremony
              card={card}
              isFirstOfSpecies={Boolean(isFirst)}
              snapshot={rated ? outcome.snapshot : undefined}
              unrated={outcome.status === 'no-market-evidence'
                ? { reason: outcome.reason, explanation: outcome.explanation }
                : undefined}
              golden={Boolean(specimen.golden)}
            />
          ) : (
            <p className="empty">Identity saved.</p>
          )
        ) : (
          <p className="empty">Identity saved.</p>
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
          Already saved as a draft, and safe. Every record carries a label, so this is the one
          question the catch needs answered.
        </p>
      </header>

      {photoUrl && <img className="identify__shot media" src={photoUrl} alt="The fish you just caught" />}

      {/* "Not yet" used to sit here. It is gone by direct instruction - "all
          records must be identified" - and the way out for a fish the catalog
          does not contain is at the bottom of this screen, where it costs the
          store label rather than a tap. */}
      {canShare && (
        <div className="row">
          <button type="button" className="btn--primary grow" onClick={() => void onShare()}>
            🔍 Look it up
          </button>
        </div>
      )}

      {canShare && (
        <p className="xs muted">
          Shares the photo on its own, so Lens gets a picture rather than a caption to search.
          Pick Chrome or Google in the sheet — iOS decides that order, not this app, and it moves
          what you choose nearer the front over time. Come back with a name and type it below;
          nothing is confirmed for you.
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

      {/* The way past this screen without a catalog match.
​
          THIS USED TO BE GATED ON `candidates.length === 0`, which is why it
          came and went. The search returns partial word-overlap matches, so
          typing a fish the catalog has never heard of frequently surfaces one
          bad hit - and one bad hit was enough to remove the only exit, leaving
          a real catch stranded on a screen whose matches were all wrong. It is
          now offered whenever there is something to log, sitting below the
          matches so a genuine one still leads.

          Not a skip. The catalog holds 2,176 species and a shop will sell one
          it has never heard of. What this records is the keeper's wording,
          verbatim, as its own species marked `user-submitted`, with the
          identity `provisional` - the weaker of the two, and displayed as
          weaker on the record. */}
      {query.trim() && (
        <div className="stack identify__asis">
          <p className="xs muted" style={{ marginBottom: 0 }}>
            {candidates.length > 0
              ? 'None of these it?'
              : 'Nothing in the catalog matches that.'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onLogAsIs(query.trim())}
          >
            Log it as &ldquo;{query.trim()}&rdquo;
          </button>
          <p className="xs muted">
            Keeps your wording exactly and marks the identity provisional rather than confirmed.
            It becomes a species of your own, so the next one you catch can join it — and it goes
            forward for review, which is how the shared catalog gets the fish it is missing.
          </p>
        </div>
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

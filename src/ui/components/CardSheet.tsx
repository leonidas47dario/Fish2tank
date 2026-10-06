/**
 * One fish's card, and the way to keep it - spec 070, FR-R16.
 *
 * The card is drawn as an image the moment the sheet opens, and the preview
 * IS that image. Two reasons, both load-bearing:
 *
 *   - `navigator.share` needs a live user gesture, and Safari drops it across
 *     an await as long as encoding a 1080 x 1350 JPEG. Drawing up front means
 *     the button hands over a file that already exists.
 *   - A preview drawn separately in HTML would be a second rendering of the
 *     same card, and the two would disagree within a month.
 *
 * Golden lives here too (FR-R06, BUG-23): the card is where Golden is seen,
 * and until this sheet nothing in the app could award it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { readMediaBlob } from '@/data/media/read';
import {
  canvasToJpeg, drawCatchCard, loadCardFonts, type CardPalette,
} from '@/data/media/card-image';
import { awardGolden, removeGolden } from '@/data/repositories';
import { CATALOG_BY_SPECIES } from '@/data/catalog';
import { LOCAL_PROFILE_ID } from '@/data/profile';
import { cardFileName, catchCardContent } from '@/domain/catch-card';
import type { Id } from '@/domain/types';
import { useBlobUrl } from '../blob-url';
import { formatWhen } from '../format-when';
import { Sheet } from './Sheet';
import { DownloadSimpleIcon, ShareNetworkIcon, StarIcon, XIcon } from './Icons';

/** The live theme, as the canvas needs it. Read at draw time, never cached. */
function readPalette(): CardPalette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    canvas: v('--color-canvas'),
    surface: v('--color-surface'),
    text: v('--color-text'),
    muted: v('--color-muted'),
    faint: v('--color-faint'),
    legendary: v('--color-legendary'),
    onLegendary: v('--color-on-primary'),
    edge: v('--sticker-edge'),
    shadow: v('--card-shadow'),
    fontDisplay: v('--font-display'),
    fontBody: v('--font-body'),
    fontScientific: v('--font-scientific'),
  };
}

type Outcome =
  | { kind: 'done'; text: string }
  | { kind: 'cancelled'; text: string }
  | { kind: 'failed'; text: string };

export function CardSheet({ specimenId, onClose }: { specimenId: Id; onClose: () => void }) {
  const [showPlace, setShowPlace] = useState(true);
  const [showName, setShowName] = useState(true);
  const [reason, setReason] = useState('');
  const [image, setImage] = useState<Blob>();
  const [drawError, setDrawError] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const imageUrl = useBlobUrl(image);

  const cloudUser = useObservable(db.cloud.currentUser);
  const data = useLiveQuery(async () => {
    const specimen = await db.specimens.get(specimenId);
    if (!specimen) return null;
    const [encounters, holdings, media, profile, localSpecies] = await Promise.all([
      db.encounters.where('specimenId').equals(specimenId).toArray(),
      db.holdings.where('specimenId').equals(specimenId).toArray(),
      db.media.where('specimenIds').equals(specimenId).toArray(),
      db.users.get(LOCAL_PROFILE_ID),
      specimen.speciesId ? db.species.get(specimen.speciesId) : undefined,
    ]);
    const first = [...encounters].sort((a, b) => a.observedAt.localeCompare(b.observedAt))[0];
    const place = first?.placeId ? await db.places.get(first.placeId) : undefined;
    // Newest photo of this fish - the same one its sticker wears.
    const photo = media
      .filter((m) => m.kind === 'photo')
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    const catalog = specimen.speciesId ? CATALOG_BY_SPECIES.get(specimen.speciesId) : undefined;
    return {
      specimen,
      firstMet: first?.observedAt,
      place,
      acquiredOn: holdings.map((h) => h.acquiredOn).filter((d): d is string => Boolean(d)).sort()[0],
      photo,
      displayName: profile?.displayName,
      commonName: localSpecies?.commonName ?? catalog?.commonName,
      scientificName: localSpecies?.scientificName ?? catalog?.scientificName,
    };
  }, [specimenId]);

  const content = useMemo(() => data && catchCardContent({
    specimen: data.specimen,
    commonName: data.commonName,
    scientificName: data.scientificName,
    firstMet: data.firstMet,
    place: data.place,
    acquiredOn: data.acquiredOn,
    displayName: data.displayName,
    // Signed out (developer mode), Dexie Cloud names the user "Unauthorized".
    // Only a signed-in account's name is a name.
    accountName: cloudUser?.isLoggedIn ? cloudUser.name : undefined,
    showPlace,
    showName,
  }), [data, cloudUser?.isLoggedIn, cloudUser?.name, showPlace, showName]);

  // What each switch would add, so a switch with nothing behind it is not offered.
  const hasPlace = Boolean(data && catchCardContent({ specimen: {}, place: data.place, showPlace: true, showName: false }).where);
  const hasName = Boolean(content && catchCardContent({
    specimen: {}, displayName: data?.displayName,
    accountName: cloudUser?.isLoggedIn ? cloudUser.name : undefined,
    showPlace: false, showName: true,
  }).finder);

  const photoBlob = useLiveQuery(
    async () => (data?.photo ? (await readMediaBlob(data.photo, 'preview')) ?? null : null),
    [data?.photo?.id],
  );

  // Draw whenever what is on the card changes. The key is the words and the
  // picture; anything else re-running this would re-encode for nothing.
  const drawKey = content && photoBlob ? JSON.stringify([content, data?.photo?.id]) : undefined;
  useEffect(() => {
    if (!content || !photoBlob || !data) return;
    let cancelled = false;
    setDrawError(undefined);
    setOutcome(undefined);
    (async () => {
      const palette = readPalette();
      const [bitmap] = await Promise.all([createImageBitmap(photoBlob), loadCardFonts(palette)]);
      const verb = data.firstMet ? 'Found' : 'Kept';
      const meta = [
        content.finder && `${verb} by ${content.finder}`,
        content.where,
        content.when && `${content.when.kind === 'caught' ? 'Caught' : 'Home since'} ${formatWhen(content.when.on, 'long')}`,
      ].filter((l): l is string => Boolean(l));
      const canvas = drawCatchCard({
        title: content.title, kind: content.kind, scientific: content.scientific,
        meta, golden: content.golden, photo: bitmap, palette,
      });
      bitmap.close();
      const blob = await canvasToJpeg(canvas);
      if (!cancelled) setImage(blob);
    })().catch((e) => {
      console.error('[card] drawing failed', { specimenId, error: e });
      if (!cancelled) setDrawError(e instanceof Error ? e.message : 'The card could not be drawn.');
    });
    return () => { cancelled = true; };
  }, [drawKey]);

  const fileName = content ? cardFileName(content.title) : 'fish2tank-card.jpg';
  const file = useMemo(
    () => (image ? new File([image], fileName, { type: 'image/jpeg' }) : undefined),
    [image, fileName],
  );
  const canShareFile = Boolean(file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }));

  function download() {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = fileName;
    a.click();
    setOutcome({ kind: 'done', text: 'Downloaded.' });
  }

  async function save() {
    if (!file) return;
    setOutcome(undefined);
    if (!canShareFile) return download();
    try {
      // Synchronous from the tap up to here: the file already exists.
      await navigator.share({ files: [file], title: content?.title });
      setOutcome({ kind: 'done', text: 'Handed to your share sheet.' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setOutcome({ kind: 'cancelled', text: 'Not saved. Nothing changed.' });
        return;
      }
      console.error('[card] share failed', { specimenId, error: e });
      setOutcome({
        kind: 'failed',
        text: `Sharing did not work${e instanceof Error && e.message ? ` (${e.message})` : ''}. You can download it instead.`,
      });
    }
  }

  const title = content?.title ?? 'this fish';
  const golden = data?.specimen.golden;

  return (
    <Sheet label={`Card for ${title}`} onDismiss={onClose}>
      <div className="cardsheet stack">
        <div className="spread">
          <h2 className="cardsheet__title">Card</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            <XIcon size={20} aria-hidden="true" />
          </button>
        </div>

        {data === null && <p className="muted small">That fish is no longer here.</p>}

        {data && !data.photo && (
          // Spec 070: a card is made from YOUR photograph (P3, and the
          // portraits' licences). Said plainly rather than drawn without one.
          <div className="prompt cardsheet__prompt">
            <p className="prompt__title">A card needs your own photo</p>
            <p className="prompt__body">
              Add a photo of this fish on its record, and its card appears here. The catalog&apos;s
              portrait is someone else&apos;s picture of another fish, so it is never used.
            </p>
          </div>
        )}

        {data?.photo && (
          <>
            <div className="cardsheet__frame" aria-busy={!imageUrl}>
              {imageUrl ? (
                <img
                  className="cardsheet__image"
                  src={imageUrl}
                  alt={`Card: ${[content?.title, content?.kind, content?.where].filter(Boolean).join(', ')}`}
                />
              ) : (
                <span className="cardsheet__drawing">{drawError ?? 'Drawing the card…'}</span>
              )}
            </div>

            <div className="row">
              {hasPlace && (
                <label className="cardsheet__switch">
                  <input type="checkbox" checked={showPlace} onChange={(e) => setShowPlace(e.target.checked)} />
                  Show where
                </label>
              )}
              {hasName && (
                <label className="cardsheet__switch">
                  <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
                  Show my name
                </label>
              )}
            </div>

            <button type="button" className="btn--primary btn--big" disabled={!file} onClick={() => void save()}>
              {canShareFile
                ? <><ShareNetworkIcon size={18} aria-hidden="true" /> Save or send…</>
                : <><DownloadSimpleIcon size={18} aria-hidden="true" /> Download image</>}
            </button>
            {outcome && (
              <p role="status" className={outcome.kind === 'failed' ? 'warn small' : 'muted small'}>
                {outcome.text}
              </p>
            )}
            {outcome?.kind === 'failed' && (
              <button type="button" className="btn--ghost" onClick={download}>
                <DownloadSimpleIcon size={16} aria-hidden="true" /> Download instead
              </button>
            )}
            <p className="xs muted cardsheet__note">
              Never on the card: coordinates, a home, your email address, or the photo&apos;s
              camera data.
            </p>
          </>
        )}

        {data && (
          <section className="cardsheet__golden stack">
            {golden ? (
              <>
                <p className="row cardsheet__golden-on">
                  <StarIcon size={18} weight="fill" aria-hidden="true" />
                  Golden since {formatWhen(golden.awardedAt, 'long')}
                </p>
                {golden.reason && (
                  <p className="small muted">
                    <span className="visually-hidden">Your private reason: </span>
                    &ldquo;{golden.reason}&rdquo; <span className="xs">Only you see this.</span>
                  </p>
                )}
                <button type="button" className="btn--ghost" onClick={() => void removeGolden(specimenId)}>
                  Remove Golden
                </button>
              </>
            ) : (
              <>
                <p className="small muted">
                  Golden is your own mark for a fish that matters. It changes nothing about its rarity.
                </p>
                <label className="stack">
                  <span className="xs muted">Why, if you like. Private: never on the card.</span>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The way he tracked me across the glass" />
                </label>
                <button
                  type="button"
                  className="btn--ghost"
                  onClick={() => void awardGolden(specimenId, reason.trim() || undefined).then(() => setReason(''))}
                >
                  <StarIcon size={16} aria-hidden="true" /> Make it Golden
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}

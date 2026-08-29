/**
 * One species, opened from the catalog.
 *
 * The card is shown large, then the things you can only say about a species
 * rather than an individual: its care profile, what the vendors charge, and
 * where the picture came from.
 *
 * This is also where the art choice lives. A species in your collection
 * defaults to your own photo - the product's claim is that the exact specimen
 * matters - but the reference portrait is one tap away, because a photo taken
 * through algae at an angle is sometimes genuinely worse than the reference
 * shot.
 *
 * Photos can be added here for anything you have, kept fish included. That is
 * the only route for a fish imported as an opening balance: it never passed
 * through the Catch screen, so without this its card could never carry your
 * own picture.
 */
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data/db';
import type { Id } from '@/domain/types';
import { addPhotos, ensureSpecimenForHolding, type CaptureFile } from '@/data/repositories';
import {
  CATALOG_BY_SPECIES, cardPrice, marketAndScarcity, ownership, portraitCredit, type CatalogCard,
} from '@/data/catalog';
import { deriveQuantity } from '@/domain/holdings';
import { formatVolume } from '@/domain/units';
import { FishCard } from '../components/FishCard';
import { MarketPanel } from '../components/MarketPanel';
import { OwnPhotoStrip } from '../components/OwnPhotoStrip';

export default function SpeciesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const species = id ? CATALOG_BY_SPECIES.get(id) : undefined;

  const data = useLiveQuery(async () => {
    if (!id) return undefined;
    const [specimens, snapshots, holdings, lifeEvents, residencies, media] = await Promise.all([
      db.specimens.where('speciesId').equals(id).toArray(),
      db.raritySnapshots.where('speciesId').equals(id).toArray(),
      db.holdings.where('speciesId').equals(id).toArray(),
      db.lifeEvents.toArray(), db.residencies.toArray(), db.media.toArray(),
    ]);
    const ownPhotos = media
      .filter((m) => m.kind === 'photo' && m.specimenIds.some((sid) => specimens.some((s) => s.id === sid)))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    return { specimens, snapshots, holdings, lifeEvents, residencies, ownPhotos };
  }, [id]);

  const pref = useLiveQuery(() => (id ? db.cardPrefs.get(id) : undefined), [id]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | undefined>();

  if (!id || !species) return <p className="empty">No such species in the catalog.</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const confirmed = data.specimens.filter((s) => s.identityStatus === 'user-confirmed');
  const currentlyKept = data.holdings.some((h) => {
    if (deriveQuantity(h, data.lifeEvents) <= 0) return false;
    return data.residencies.some((r) => r.holdingId === h.id && !r.endDate);
  });
  const { market, scarcityBand } = marketAndScarcity(id);

  const card: CatalogCard = {
    species,
    user: {
      ...ownership(confirmed.length, data.holdings.length),
      currentlyKept,
      specimenCount: data.specimens.length,
      tier: data.snapshots[0]?.tier,
      golden: data.specimens.some((s) => Boolean(s.golden)),
      onDreamList: false,
      ownPhotoMediaIds: data.ownPhotos.map((m) => m.id),
    },
    market,
    price: cardPrice(market),
    scarcityBand,
  };

  const hasOwnPhoto = data.ownPhotos.length > 0;
  const usingOwn = pref?.artSource !== 'portrait' && hasOwnPhoto;

  async function setArt(artSource: 'own' | 'portrait') {
    await db.cardPrefs.put({ speciesId: id!, artSource, updatedAt: new Date().toISOString() });
  }

  /**
   * Where a new photo goes. A photo is of a fish, not of a species.
   *
   * A specimen you already have is the obvious target. Failing that the fish
   * is one you keep but never caught, so the holding's specimen is minted on
   * the spot - preferring one still in a tank, because that is the fish you
   * just pointed a camera at.
   */
  async function targetSpecimenId(): Promise<Id> {
    const newest = [...data!.specimens].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (newest) return newest.id;

    const live = data!.holdings.find((h) =>
      data!.residencies.some((r) => r.holdingId === h.id && !r.endDate));
    const holding = live ?? data!.holdings[0];
    if (!holding) throw new Error('Nothing of yours to attach this photo to.');
    return (await ensureSpecimenForHolding(holding.id)).id;
  }

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setSaving(true);
    setPhotoError(undefined);
    try {
      const files: CaptureFile[] = Array.from(list).map((f) => ({
        kind: f.type.startsWith('video') ? 'video' : 'photo',
        blob: f,
        mimeType: f.type || 'application/octet-stream',
      }));
      await addPhotos({ specimenId: await targetSpecimenId(), files });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not save that photo.');
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="stack">
      <button type="button" className="btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div style={{ maxWidth: 260, margin: '0 auto', width: '100%' }}>
        <FishCard card={card} />
      </div>

      <header className="stack">
        <h1 style={{ marginBottom: 0 }}>{species.commonName}</h1>
        {species.scientificName && <p className="muted sci" style={{ marginBottom: 0 }}>{species.scientificName}</p>}
        {species.aliases.length > 0 && (
          <p className="xs muted" style={{ marginBottom: 0 }}>Also sold as: {species.aliases.join(', ')}</p>
        )}
      </header>

      {/* --- Card art choice ------------------------------------------- */}
      <section className="card stack">
        <h2>Card art</h2>
        {hasOwnPhoto ? (
          <>
            <div className="filters">
              <button type="button" className="chip" aria-pressed={usingOwn} onClick={() => void setArt('own')}>
                Your photo
              </button>
              <button
                type="button" className="chip" aria-pressed={!usingOwn}
                disabled={!species.portrait}
                onClick={() => void setArt('portrait')}
              >
                Reference portrait
              </button>
            </div>
            <p className="xs muted" style={{ marginBottom: 0 }}>
              {species.portrait
                ? 'Your own photo is the default — it is the fish you actually met.'
                : 'No reference portrait exists for this species, so your photo is the only art available.'}
            </p>
          </>
        ) : (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {card.user.inCollection
              ? 'No photo of yours yet. Add one and it becomes this card\u2019s art.'
              : 'Catch one and your own photo becomes this card\u2019s art.'}
          </p>
        )}

        {/* Anything you have can take a photo - a fish imported as an opening
            balance never passed through the Catch screen, so this is its only
            route to having its own picture. */}
        {card.user.inCollection && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              multiple
              className="visually-hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => fileRef.current?.click()}
            >
              {saving ? 'Saving\u2026' : hasOwnPhoto ? '\u2295  Add another photo' : '\u2295  Add your photo'}
            </button>
            {photoError && <p className="warn" style={{ marginBottom: 0 }}>{photoError}</p>}
            {data.ownPhotos.length > 0 && (
              <OwnPhotoStrip
                mediaIds={data.ownPhotos.map((m) => m.id)}
                onPick={(mediaId) => void db.cardPrefs.put({
                  speciesId: id, artSource: 'own', preferredMediaId: mediaId,
                  updatedAt: new Date().toISOString(),
                })}
                selected={usingOwn ? (pref?.preferredMediaId ?? data.ownPhotos[0]!.id) : undefined}
              />
            )}
          </>
        )}
      </section>

      {/* --- Care profile ------------------------------------------------ */}
      <section className="card stack">
        <h2>Profile</h2>
        <dl className="kv">
          {species.adultSizeIn !== undefined && (<><dt>Adult size</dt><dd>{Math.round(species.adultSizeIn * 10) / 10}&quot;</dd></>)}
          {species.minVolumeGal !== undefined && (<><dt>Minimum tank</dt><dd>{formatVolume({ value: species.minVolumeGal, unit: 'gal' })}</dd></>)}
          {species.aggression && (<><dt>Temperament</dt><dd>{species.aggression}</dd></>)}
          {species.tempMinC !== undefined && species.tempMaxC !== undefined && (
            <><dt>Temperature</dt><dd>{species.tempMinC}–{species.tempMaxC}°C</dd></>
          )}
          {species.predationTags.length > 0 && (<><dt>Predation</dt><dd>{species.predationTags.join(', ')}</dd></>)}
        </dl>
        {species.sourceLabel && (
          <p className="xs muted" style={{ marginBottom: 0 }}>
            {species.sourceUrl
              ? <>Care data: <a href={species.sourceUrl} target="_blank" rel="noreferrer">{species.sourceLabel}</a></>
              : <>Care data: {species.sourceLabel}</>}
          </p>
        )}
      </section>

      <MarketPanel speciesId={id} />

      {/* --- Your specimens ---------------------------------------------- */}
      <section className="card stack">
        {/* Not "encounters": a fish minted from a kept holding was never met
            anywhere, it has simply always been yours. */}
        <h2>Your fish</h2>
        {data.specimens.length === 0 && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            {card.user.kept
              ? 'Add a photo above and this becomes a record of the one you keep.'
              : 'You haven\u2019t caught one yet.'}
          </p>
        )}
        <ul className="list">
          {data.specimens.map((s) => (
            <li key={s.id}>
              <Link to={`/specimen/${s.id}`} className="card card--raised spread" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span>{s.nickname ?? s.rawLabel ?? 'Unnamed specimen'}</span>
                <span className="xs muted data">{new Date(s.createdAt).toLocaleDateString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* --- Attribution -------------------------------------------------- */}
      {species.portrait && (
        <section className="card">
          <h2>Picture credit</h2>
          <p className="small" style={{ marginBottom: 0 }}>
            <strong>{portraitCredit(species.portrait)}</strong>
            {species.portrait.attributionUrl && (
              <> — <a href={species.portrait.attributionUrl} target="_blank" rel="noreferrer">source</a></>
            )}
          </p>
        </section>
      )}
    </div>
  );
}

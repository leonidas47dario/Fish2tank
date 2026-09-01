/**
 * One species, opened from the catalog.
 *
 * This is the screen for the question asked standing in the aisle, before the
 * fish is yours: what is it, how big does it get, what tank does it need, and
 * what do the shops charge. The photograph is shown large, then the facts, and
 * where a fact does not exist the screen says so rather than leaving a gap the
 * reader has to interpret.
 *
 * This is also where the art choice lives. A species in your collection
 * defaults to your own photo - the product's claim is that the exact specimen
 * matters - but the reference portrait is one tap away, because a photo taken
 * through algae at an angle is sometimes genuinely worse than the reference
 * shot.
 *
 * Photos are NOT added here any more (spec 020). They belong to a fish rather
 * than to a species, so they are added on a record, and every fish of yours
 * now has one reachable from "Your fish" below. What stays here is the choice
 * this screen is uniquely placed to make: which of your pictures the card
 * wears, and whether it wears one at all.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data/db';
import {
  addToDreamList, ensureSpecimenForHolding, removeFromDreamList,
} from '@/data/repositories';
import {
  CATALOG_BY_SPECIES, cardPrice, marketAndScarcity, ownership, portraitCredit,
  type CareField, type CatalogCard, type CatalogSpecies,
} from '@/data/catalog';
import { deriveQuantity } from '@/domain/holdings';
import { keptFishRows, type KeptFishRow } from '@/domain/kept-fish';
import { readProfile } from '@/data/profile';
import { isBlended } from '@/engine/pricing/own-prices';
import { formatVolume } from '@/domain/units';
import { MarketPanel } from '../components/MarketPanel';
import { OwnPhotoStrip } from '../components/OwnPhotoStrip';
import { Plate, useCardArt } from '../components/Plate';
import { ScarcityBadge, TierBadge } from '../components/Badges';
import { CaretLeftIcon } from '../components/Icons';
import type { DiscoveryTier } from '@/domain/types';
import { SCARCITY_LABELS, type MarketScarcityBand } from '@/engine/rarity/market-scarcity';

const TIERS: readonly DiscoveryTier[] = ['familiar', 'uncommon', 'rare', 'epic', 'legendary'];
const isTier = (v: string | undefined): v is DiscoveryTier =>
  v !== undefined && (TIERS as readonly string[]).includes(v);
const isScarcityBand = (v: string | undefined): v is MarketScarcityBand =>
  v !== undefined && v in SCARCITY_LABELS;

const SOURCE_LABEL: Record<string, string> = {
  wikipedia: 'Wikipedia',
  vendor: 'store listing',
};

/**
 * Credit for a single care value.
 *
 * Per-field rather than per-species because under the spec 003 backfill a
 * fish's adult size can come from a Wikipedia article while its minimum tank
 * volume comes from a shop that wants to sell it. Those are not equally strong
 * claims and crediting them together would hide which is which.
 *
 * Renders nothing for the curated profiles, which carry no per-field
 * provenance and are credited once beneath the list.
 */
function CareCredit({ species, field }: { species: CatalogSpecies; field: CareField }) {
  const src = species.careSources?.[field];
  if (!src) return null;
  const label = SOURCE_LABEL[src.source] ?? src.source;
  return (
    <span className="xs faint">
      {' ('}
      {src.url
        ? <a href={src.url} target="_blank" rel="noreferrer">{label}</a>
        : label}
      {')'}
    </span>
  );
}

export default function SpeciesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const species = id ? CATALOG_BY_SPECIES.get(id) : undefined;

  const data = useLiveQuery(async () => {
    if (!id) return undefined;
    const [specimens, snapshots, holdings, lifeEvents, residencies, media, dream, prices, profile, places] =
      await Promise.all([
        db.specimens.where('speciesId').equals(id).toArray(),
        db.raritySnapshots.where('speciesId').equals(id).toArray(),
        db.holdings.where('speciesId').equals(id).toArray(),
        db.lifeEvents.toArray(), db.residencies.toArray(), db.media.toArray(),
        db.dreamList.where('speciesId').equals(id).first(),
        db.priceObservations.where('speciesId').equals(id).toArray(),
        readProfile(),
        db.places.toArray(),
      ]);
    const aquariums = await db.aquariums.toArray();
    const ownPhotos = media
      .filter((m) => m.kind === 'photo' && m.specimenIds.some((sid) => specimens.some((s) => s.id === sid)))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    return { specimens, snapshots, holdings, lifeEvents, residencies, ownPhotos, dream, aquariums,
      prices, currency: profile.settings.currency,
      placeNames: Object.fromEntries(places.map((pl) => [pl.id, pl.name])) };
  }, [id]);

  const pref = useLiveQuery(() => (id ? db.cardPrefs.get(id) : undefined), [id]);

  const [openError, setOpenError] = useState<string | undefined>();

  /* A dead end with no way out is not an empty state. This one is reachable
     from a stale bookmark or a link written before a catalog rebuild renamed
     an id, so it says what happened and offers the one door out. */
  if (!id || !species) {
    return (
      <div className="screen">
        <div className="topbar">
          <button type="button" className="iconbtn" onClick={() => navigate(-1)} aria-label="Back">
            <CaretLeftIcon size={22} aria-hidden="true" />
          </button>
          <h1 className="topbar__title">Not found</h1>
        </div>
        <div className="state">
          <p className="state__head">No such species in the catalog</p>
          <p className="state__body">
            Nothing in the library has the id <span className="data">{id ?? '(none)'}</span>. Catalog
            ids can change when the species list is rebuilt, so an old link can end up here.
          </p>
          <Link to="/catalog" className="state__act">Search the catalog</Link>
        </div>
      </div>
    );
  }
  if (!data) return <p className="empty muted">Loading…</p>;

  const confirmed = data.specimens.filter((s) => s.identityStatus === 'user-confirmed');
  const currentlyKept = data.holdings.some((h) => {
    if (deriveQuantity(h, data.lifeEvents) <= 0) return false;
    return data.residencies.some((r) => r.holdingId === h.id && !r.endDate);
  });
  const { market, scarcityBand } = marketAndScarcity(id, { prices: data.prices, currency: data.currency });

  const card: CatalogCard = {
    species,
    user: {
      ...ownership(confirmed.length, data.holdings.length),
      currentlyKept,
      specimenCount: data.specimens.length,
      tier: data.snapshots[0]?.tier,
      golden: data.specimens.some((s) => Boolean(s.golden)),
      onDreamList: Boolean(data.dream),
      ownPhotoMediaIds: data.ownPhotos.map((m) => m.id),
    },
    market,
    price: cardPrice(market),
    scarcityBand,
  };

  /**
   * Every fish of yours of this species, caught or merely kept, as one list.
   * See `keptFishRows` for why the two used to be separate and why they no
   * longer are.
   */
  const yourFish = keptFishRows({
    specimens: data.specimens,
    holdings: data.holdings,
    residencies: data.residencies,
    lifeEvents: data.lifeEvents,
    aquariums: data.aquariums,
    speciesName: species.commonName,
  });

  /* Spec 019 added a "which one is this?" picker here, and spec 020 deleted
     it. It answered "which of your fish is this a photo of", which is a
     question only a species page has to ask; a record already knows. Moving
     the upload there removed the ambiguity rather than resolving it. */

  const hasOwnPhoto = data.ownPhotos.length > 0;
  const usingOwn = pref?.artSource !== 'portrait' && hasOwnPhoto;

  async function setArt(artSource: 'own' | 'portrait') {
    await db.cardPrefs.put({ speciesId: id!, artSource, updatedAt: new Date().toISOString() });
  }

  /** Open the record for a row, minting it first if the fish never had one. */
  async function openRow(row: KeptFishRow) {
    if (row.specimenId) return navigate(`/specimen/${row.specimenId}`);
    setOpenError(undefined);
    try {
      const specimen = await ensureSpecimenForHolding(row.holdingId!);
      navigate(`/specimen/${specimen.id}`);
    } catch (e) {
      console.error('[mint] opening a kept fish failed', { holdingId: row.holdingId, error: e });
      setOpenError(e instanceof Error ? e.message : 'Could not open that fish.');
    }
  }

  /* What the catalog actually holds for this fish.
   *
   * The spec 003 backfill changed the shape of this panel: adult size is now
   * recorded for 689 of 2,178 species rather than 47. Minimum tank volume is
   * still only recorded for 92, so a fish can show a full-looking profile and
   * still be unscreenable - which is why the note below keys off those two
   * fields specifically rather than off the length of this list.
   *
   * `field` is the provenance key where the backfill carries one. Predation
   * and water column come from the catalog itself and are credited with the
   * rest of the record beneath the list. */
  const profile = [
    species.adultSizeIn !== undefined
      && { k: 'Adult size', v: `${Math.round(species.adultSizeIn * 10) / 10}"`, field: 'adultSizeIn' as const },
    species.minVolumeGal !== undefined
      && { k: 'Minimum tank', v: formatVolume({ value: species.minVolumeGal, unit: 'gal' }), field: 'minVolumeGal' as const },
    species.aggression && { k: 'Temperament', v: species.aggression, field: 'aggression' as const },
    species.tempMinC !== undefined && species.tempMaxC !== undefined
      && { k: 'Temperature', v: `${species.tempMinC}–${species.tempMaxC}°C`, field: 'tempC' as const },
    species.predationTags.length > 0 && { k: 'Predation', v: species.predationTags.join(', ') },
    species.waterZone && { k: 'Water column', v: species.waterZone.replace('-', ' ') },
  ].filter((r): r is { k: string; v: string; field?: CareField } => Boolean(r));

  const onDream = Boolean(data.dream) && !data.dream?.fulfilledBySpecimenId;

  return (
    <div className="screen">
      <div className="topbar">
        <button type="button" className="iconbtn" onClick={() => navigate(-1)} aria-label="Back">
          <CaretLeftIcon size={22} aria-hidden="true" />
        </button>
        <span className="grow" />
      </div>

      <SpeciesHero card={card} />

      <div className="pad">
        {/* The binomial is set as the label, in real italic letterforms, and
            the common name sits under it. This is the one screen where the
            scientific name is what you are actually matching against a tag. */}
        {species.scientificName
          ? (
            <>
              <h1 className="specimen-sci">{species.scientificName}</h1>
              <p className="specimen-common">{species.commonName}</p>
            </>
          )
          : <h1 className="specimen-name">{species.commonName}</h1>}

        <div className="tagrow">
          {/* Both of these arrive as widened strings from the catalog view
              model, so they are narrowed here rather than asserted. An unknown
              tier draws nothing, which is the correct rendering of a tier this
              build does not have a treatment for. */}
          {isTier(card.user.tier) && <TierBadge tier={card.user.tier} golden={card.user.golden} />}
          {isScarcityBand(scarcityBand) && <ScarcityBadge band={scarcityBand} />}
          <button
            type="button"
            className="chip"
            aria-pressed={onDream}
            onClick={() => void (onDream ? removeFromDreamList(id) : addToDreamList(id))}
          >
            {onDream ? 'On your Dream List' : 'Want one'}
          </button>
        </div>

        {species.aliases.length > 0 && (
          <p className="panel__note panel__note--tight">Also sold as: {species.aliases.join(', ')}</p>
        )}
      </div>

      {/* --- Care profile ------------------------------------------------ */}
      <section className="panel">
        <h2 className="sec-head">What we know</h2>
        {profile.length > 0 ? (
          <dl className="kv">
            {profile.map((r) => (
              <div key={r.k} style={{ display: 'contents' }}>
                <dt>{r.k}</dt>
                <dd>
                  {r.v}
                  {r.field && <CareCredit species={species} field={r.field} />}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          /* Not an empty panel and not a row of dashes. The absence has a
             cause, and naming it is the difference between "the app is
             broken" and "nobody has written this profile yet". */
          <div className="state">
            <p className="state__head">No care profile for this one</p>
            <p className="state__body">
              This species is in the catalog because a store listed it, not because anyone has
              recorded how big it gets or what it needs. Nothing here is guessed from the family,
              so a screening against your tanks will say it cannot answer rather than invent one.
            </p>
          </div>
        )}
        {(species.adultSizeIn === undefined || species.minVolumeGal === undefined) && profile.length > 0 && (
          <p className="panel__note panel__note--tight">
            {species.adultSizeIn === undefined && species.minVolumeGal === undefined
              ? 'Adult size and minimum tank are both unrecorded, so this cannot be screened for fit.'
              : species.adultSizeIn === undefined
                ? 'Adult size is unrecorded.'
                : 'Minimum tank is unrecorded.'}
          </p>
        )}
        {species.sourceLabel && (
          <p className="panel__note panel__note--tight">
            {species.sourceUrl
              ? <>Care data: <a href={species.sourceUrl} target="_blank" rel="noreferrer">{species.sourceLabel}</a></>
              : <>Care data: {species.sourceLabel}</>}
          </p>
        )}
      </section>

      {/* --- Card art choice --------------------------------------------- */}
      <section className="panel">
        <h2 className="sec-head">Card art</h2>
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
            <p className="panel__note panel__note--tight">
              {species.portrait
                ? 'Your own photo is the default — it is the fish you actually met.'
                : 'No reference portrait exists for this species, so your photo is the only art available.'}
            </p>
          </>
        ) : (
          <p className="panel__note">
            {/* Says where the button is, now that it is not here. A note that
                asks for a photo without offering a way to give one is the
                thing this panel was already being criticised for. */}
            {card.user.inCollection
              ? 'No photo of yours yet. Add one on any of your fish below and it becomes this card’s art.'
              : 'Catch one and your own photo becomes this card’s art.'}
          </p>
        )}

        {/* Anything you have can take a photo - a fish imported as an opening
            balance never passed through the Catch screen, so this is its only
            route to having its own picture.

            NO LONGER TRUE, and the panel is smaller for it (spec 020). A photo
            is of a fish, not of a species, so uploading moved onto the record,
            where there is no "which one of yours is this?" to ask. This panel
            keeps only the choice it is named for: which picture the card
            wears. The upload button, its hidden input and that whole picker
            are gone. */}
        {card.user.inCollection && data.ownPhotos.length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <OwnPhotoStrip
              mediaIds={data.ownPhotos.map((m) => m.id)}
              onPick={(mediaId) => void db.cardPrefs.put({
                speciesId: id, artSource: 'own', preferredMediaId: mediaId,
                updatedAt: new Date().toISOString(),
              })}
              selected={usingOwn ? (pref?.preferredMediaId ?? data.ownPhotos[0]!.id) : undefined}
            />
          </div>
        )}
      </section>

      <MarketPanel
        speciesId={id}
        blended={isBlended(market) ? market : undefined}
        placeNames={data.placeNames}
      />

      {/* --- Your specimens ---------------------------------------------- */}
      <section className="panel panel--flush">
        {/* Not "encounters": a fish minted from a kept holding was never met
            anywhere, it has simply always been yours. */}
        <h2 className="sec-head">Your fish</h2>
        {yourFish.length === 0 ? (
          <p className="panel__note" style={{ padding: '0 var(--space-4)' }}>
            You haven&apos;t caught one yet.
          </p>
        ) : (
          /* Every row opens, including a fish you keep that was never
             photographed. Those rows used to be plain divs - "there is no
             record to open until a photo mints one" - which made a fish you
             have kept for years the one thing on this page you could not get
             into. Opening it mints the record it always implied (spec 019). */
          yourFish.map((row) => (
            <button
              key={row.key}
              type="button"
              className="tankrow"
              onClick={() => void openRow(row)}
            >
              <span className="grow">
                <span className="tankrow__name">
                  {row.name}
                  {row.quantity > 1 && <span className="muted data"> ×{row.quantity}</span>}
                </span>
                <span className="tankrow__meta" style={{ display: 'block' }}>
                  {/* Three different sentences, and they are not the same
                      fact. Past kept means you held it and hold none now;
                      "not in a tank" means it is alive somewhere unrecorded,
                      or was caught and never brought home (spec 020). */}
                  {row.pastKept
                    ? 'no longer kept'
                    : row.tanks.length ? row.tanks.join(' + ') : 'not in a tank'}
                </span>
              </span>
              <span className={row.createdAt ? 'tankrow__meta num' : 'tankrow__meta'}>
                {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : 'no photo yet'}
              </span>
            </button>
          ))
        )}
        {openError && (
          <p className="warn" style={{ margin: 'var(--space-3) var(--space-4) 0' }}>{openError}</p>
        )}
      </section>

      {/* --- Attribution -------------------------------------------------- */}
      {species.portrait && (
        <section className="panel">
          <h2 className="sec-head">Picture credit</h2>
          <p className="small" style={{ marginBottom: 0 }}>
            {portraitCredit(species.portrait)}
            {species.portrait.attributionUrl && (
              <> — <a href={species.portrait.attributionUrl} target="_blank" rel="noreferrer">source</a></>
            )}
          </p>
        </section>
      )}
    </div>
  );
}

/** The plate at full width, honouring the same art preference as the tile. */
function SpeciesHero({ card }: { card: CatalogCard }) {
  const { art, ownUrl } = useCardArt(card);
  return (
    <div className="hero-plate">
      <Plate
        speciesId={card.species.speciesId}
        art={art}
        ownUrl={ownUrl}
        alt={card.species.commonName}
        locked={!card.user.inCollection}
        owned={card.user.currentlyKept ? 'Kept' : card.user.inCollection ? 'Caught' : undefined}
      />
    </div>
  );
}

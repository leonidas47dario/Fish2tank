/**
 * Home - PRD 3.2.
 *
 * The shipped version of this screen was a list of text rows: recent catches
 * as names and dates, Dream List as names, tanks as names. A collecting app
 * whose front door contains no fish.
 *
 * So the recent catches are a shelf of photographs, and the tanks are one row
 * each with the thing you would actually want to know about them. The wordmark
 * is gone, because the app's own name is the one fact the person holding the
 * phone already has.
 */
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { blobFor, db } from '@/data/db';
import { CATALOG_BY_SPECIES, portraitAsset } from '@/data/catalog';
import { formatVolume } from '@/domain/units';
import type { Id } from '@/domain/types';
import { useRecentCatches, useTanksWithResidents } from '../hooks';
import { Plate } from '../components/Plate';
import { CameraIcon, GearIcon } from '../components/Icons';

export default function Home() {
  const recent = useRecentCatches(8);
  const tanks = useTanksWithResidents();
  const species = useLiveQuery(() => db.species.toArray(), []);

  /* Only shown when it has something in it. The shipped screen rendered a
     permanent "Nothing on it yet. Add species from the Collection" — and no
     screen in the app could add to it, so the instruction pointed nowhere. */
  const dreamList = useLiveQuery(async () => {
    const items = await db.dreamList.toArray();
    return items.filter((d) => !d.fulfilledBySpecimenId);
  }, []);

  const metCount = useLiveQuery(async () => {
    const specimens = await db.specimens.toArray();
    return new Set(
      specimens.filter((s) => s.identityStatus === 'user-confirmed').map((s) => s.speciesId),
    ).size;
  }, []);

  const nameOf = (speciesId?: string) =>
    (speciesId ? species?.find((s) => s.id === speciesId)?.commonName : undefined)
    ?? (speciesId ? CATALOG_BY_SPECIES.get(speciesId)?.commonName : undefined);

  /*
   * Retired tanks keep their records but are not part of "your tanks" any
   * more, so this screen stops at the active ones.
   *
   * Derived once and used for the hero line as well as the list. Counting the
   * retired ones in "6 tanks, 3 measured" while drawing four rows underneath
   * would make the summary disagree with the thing it is summarising.
   */
  const active = tanks?.filter(({ aquarium }) => aquarium.status !== 'retired') ?? [];
  const measured = active.filter((t) => Boolean(t.aquarium.volume)).length;
  const tankCount = active.length;

  return (
    <div className="screen">
      <header className="home-hero">
        {/*
          Where you are, in one line, from your own data. Not a tagline, and
          not a wordmark: the app's own name is the one fact the person holding
          the phone already has.

          It is the h1 because it IS the heading of this page in substance. A
          screen reader landing here should hear where the collection stands,
          not the word "Home".
        */}
        <h1 className="home-hero__line">
          {metCount === undefined
            ? 'Loading your collection…'
            : metCount === 0
              ? 'Nothing caught yet.'
              : `${metCount} species met.`}
        </h1>
        <p className="home-hero__sub">
          {tankCount === 0
            ? 'No tanks recorded, so nothing can be screened yet.'
            : measured === tankCount
              ? `${tankCount} tank${tankCount === 1 ? '' : 's'}, all measured.`
              : `${tankCount} tank${tankCount === 1 ? '' : 's'}, ${measured} measured.`}
        </p>
      </header>

      <div className="pad">
        <Link to="/catch" className="cta">
          <CameraIcon size={20} weight="fill" aria-hidden="true" />
          Catch something
        </Link>
      </div>

      <section className="panel panel--flush">
        <h2 className="sec-head">Recent catches</h2>
        {recent?.length === 0 ? (
          <div className="prompt">
            <p className="prompt__title">Nothing here yet</p>
            <p className="prompt__body">
              A catch is a photograph and a moment. Identifying it can wait, and so can everything else.
            </p>
            <Link to="/catch" className="prompt__act">Take the first one</Link>
          </div>
        ) : (
          <div className="shelf">
            {recent?.map((s) => (
              <Link key={s.id} to={`/specimen/${s.id}`} className="shelf-item">
                <SpecimenPlate specimenId={s.id} speciesId={s.speciesId} />
                <p className="shelf-item__name">
                  {s.nickname ?? nameOf(s.speciesId) ?? s.rawLabel ?? 'Mystery catch'}
                </p>
                <span className="shelf-item__when">
                  {new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="panel panel--flush">
        <h2 className="sec-head">Your tanks</h2>
        {tankCount === 0 ? (
          <div className="prompt">
            <p className="prompt__title">No tanks yet</p>
            <p className="prompt__body">
              Screening needs a real tank with real dimensions. Until there is one, every check
              can only answer &ldquo;not enough data&rdquo;.
            </p>
            <Link to="/tanks" className="prompt__act">Add a tank</Link>
          </div>
        ) : (
          active.map(({ aquarium, residents }) => (
            /* Opens the tank itself, not the index. This used to be inert text,
               which put the one screen a visitor is shown two taps behind a
               nav item. */
            <Link key={aquarium.id} to={`/tanks/${aquarium.id}`} className="tankrow">
              <span className="grow">
                <span className="tankrow__name">{aquarium.name}</span>
                <span className="tankrow__meta" style={{ display: 'block' }}>
                  <span className="num">{residents.length}</span>
                  {' '}holding{residents.length === 1 ? '' : 's'}
                  {aquarium.volume && <> · <span className="num">{formatVolume(aquarium.volume)}</span></>}
                  {aquarium.stockingState && ` · ${aquarium.stockingState}`}
                </span>
                {/* The reason, on the collapsed row. An "Unmeasured" pill on its
                    own says a state; it does not say what that state costs. */}
                {!aquarium.volume && (
                  <span className="tankrow__why tankrow__why--warn">
                    No screening can run against it
                  </span>
                )}
              </span>
              {!aquarium.volume && (
                <span className="status status--unknown">
                  <span className="status__glyph" aria-hidden="true">?</span>
                  Unmeasured
                </span>
              )}
            </Link>
          ))
        )}
      </section>

      {dreamList && dreamList.length > 0 && (
        <section className="panel panel--flush">
          <h2 className="sec-head">Dream List</h2>
          {dreamList.map((d) => (
            <Link key={d.id} to={`/species/${d.speciesId}`} className="tankrow">
              <span className="grow">
                <span className="tankrow__name">{nameOf(d.speciesId) ?? d.speciesId}</span>
              </span>
            </Link>
          ))}
        </section>
      )}

      <div className="panel">
        <Link to="/settings" className="cta cta--quiet">
          <GearIcon size={18} aria-hidden="true" />
          Settings and appearance
        </Link>
      </div>
    </div>
  );
}

/**
 * The shelf shows a SPECIMEN, so it prefers that specimen's own photograph -
 * the fish you actually met - and falls back to the species portrait.
 *
 * Not the shared card-art preference: that answers "which picture represents
 * this species", which is a different question from "what does this one look
 * like".
 */
function SpecimenPlate({ specimenId, speciesId }: { specimenId: Id; speciesId?: Id }) {
  const ownUrl = useLiveQuery(async () => {
    const media = (await db.media.where('specimenIds').equals(specimenId).toArray())
      .filter((m) => m.kind === 'photo')
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    if (!media) return undefined;
    const blob = blobFor(await db.blobs.get(media.originalBlobKey));
    return blob ? URL.createObjectURL(blob) : undefined;
  }, [specimenId]);

  const portrait = speciesId ? portraitAsset(speciesId) : undefined;
  const credit = speciesId ? CATALOG_BY_SPECIES.get(speciesId)?.portrait : undefined;

  if (ownUrl) {
    return (
      <Plate
        speciesId={speciesId ?? ''}
        art={{ kind: 'own', mediaId: specimenId }}
        ownUrl={ownUrl}
      />
    );
  }
  return (
    <Plate
      speciesId={speciesId ?? ''}
      art={portrait && credit ? { kind: 'portrait', src: portrait, credit } : { kind: 'none' }}
    />
  );
}

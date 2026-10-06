/**
 * The sticker book - spec 069, FR-R15.
 *
 * Every fish you have met or kept, one sticker each. The catalog answers
 * "which kinds of fish have I got"; this answers "which fish", which nothing
 * else in the app did past the eight on the Home shelf.
 *
 * The look is borrowed from Cat Collector's sticker drawer and deliberately
 * stops short of its cutout: a die-cut paper edge around the whole photograph
 * rather than a segmentation model removing the background, which would
 * sometimes take the fins with it. The spec has the reasoning.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { ensureSpecimenForHolding } from '@/data/repositories';
import { CATALOG_BY_SPECIES, portraitAsset } from '@/data/catalog';
import {
  countStickers, matchesFilter, stickerBook, type Sticker, type StickerFilter,
} from '@/domain/sticker-book';
import { Plate } from '../components/Plate';
import { TileArt } from '../components/TileArt';
import { CaretLeftIcon, StarIcon } from '../components/Icons';
import { formatWhen } from '../format-when';

const FILTERS: Array<{ id: StickerFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'caught', label: 'Caught' },
  { id: 'kept', label: 'Kept' },
  { id: 'golden', label: 'Golden' },
];

const NUM = new Intl.NumberFormat();

export default function Stickers() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<StickerFilter>('all');
  const [openError, setOpenError] = useState<string>();

  const stickers = useLiveQuery(async () => {
    const [specimens, encounters, holdings, lifeEvents, media, species] = await Promise.all([
      db.specimens.toArray(), db.encounters.toArray(), db.holdings.toArray(),
      db.lifeEvents.toArray(), db.media.toArray(), db.species.toArray(),
    ]);
    // Keeper-submitted species first, then the bundled catalog - the order
    // the Home shelf resolves a name in.
    const local = new Map(species.map((s) => [s.id, s.commonName]));
    return stickerBook({
      specimens, encounters, holdings, lifeEvents, media,
      speciesName: (id) => local.get(id) ?? CATALOG_BY_SPECIES.get(id)?.commonName,
    });
  }, []);

  const counts = stickers ? countStickers(stickers) : undefined;
  // Golden is only offered once there is one, so the row never holds a
  // filter that can only show nothing. Falls back if the last one is undone.
  const filters = FILTERS.filter((f) => f.id !== 'golden' || (counts?.golden ?? 0) > 0);
  const active = filters.some((f) => f.id === filter) ? filter : 'all';
  const shown = stickers?.filter((s) => matchesFilter(s, active)) ?? [];

  /** Open the record, minting it first for a kept fish that never had one. */
  async function open(sticker: Sticker) {
    if (sticker.specimenId) return navigate(`/specimen/${sticker.specimenId}`);
    setOpenError(undefined);
    try {
      const specimen = await ensureSpecimenForHolding(sticker.holdingId!);
      navigate(`/specimen/${specimen.id}`);
    } catch (e) {
      console.error('[stickers] opening a kept fish failed', { holdingId: sticker.holdingId, error: e });
      setOpenError(e instanceof Error ? e.message : 'Could not open that fish.');
    }
  }

  return (
    <div className="screen">
      <div className="topbar topbar--clear">
        <button type="button" className="iconbtn" onClick={() => navigate(-1)} aria-label="Back">
          <CaretLeftIcon size={22} aria-hidden="true" />
        </button>
        <h1 className="topbar__title">Sticker book</h1>
        {counts && counts.all > 0 && <span className="topbar__count">{NUM.format(counts.all)}</span>}
      </div>

      {stickers?.length === 0 ? (
        <div className="prompt">
          <p className="prompt__title">No stickers yet</p>
          <p className="prompt__body">
            Every fish you catch or keep becomes a sticker here, one each - even two of the same kind.
          </p>
          <Link to="/catch" className="prompt__act">Catch the first one</Link>
        </div>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Filter by how the fish became yours">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chip"
                aria-pressed={active === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {counts && <span className="chip__n">{NUM.format(counts[f.id])}</span>}
              </button>
            ))}
          </div>

          {openError && <p className="warn pad" role="alert">{openError}</p>}

          {stickers && shown.length === 0 && (
            <p className="empty muted">Nothing under {filters.find((f) => f.id === active)?.label}.</p>
          )}

          <ul className="stickerbook">
            {shown.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={['sticker', s.golden ? 'sticker--golden' : ''].filter(Boolean).join(' ')}
                  onClick={() => void open(s)}
                >
                  <StickerFace sticker={s} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StickerFace({ sticker }: { sticker: Sticker }) {
  const { speciesId, mediaId } = sticker;
  const portrait = speciesId ? portraitAsset(speciesId) : undefined;
  const credit = speciesId ? CATALOG_BY_SPECIES.get(speciesId)?.portrait : undefined;

  return (
    <>
      <span className="sticker__die">
        {mediaId ? (
          // This fish's own photograph, loaded on its own so a page of them
          // paints at once (spec 053).
          <span className="plate" data-species={speciesId}>
            <TileArt mediaId={mediaId} className="plate__img" />
          </span>
        ) : (
          <Plate
            speciesId={speciesId ?? ''}
            art={portrait && credit ? { kind: 'portrait', src: portrait, credit } : { kind: 'none' }}
          />
        )}
        {/* Each mark is a word as well as a look (NFR-06). "No longer kept"
            rather than anything about dying: it is also a fish rehomed or
            sold, and it is the species page's wording for the same fact. */}
        {(sticker.golden || sticker.pastKept) && (
          <span className="sticker__marks">
            {sticker.golden && (
              <span className="sticker__mark sticker__mark--golden">
                <StarIcon size={12} weight="fill" aria-hidden="true" /> Golden
              </span>
            )}
            {sticker.pastKept && <span className="sticker__mark">No longer kept</span>}
          </span>
        )}
      </span>
      <span className="sticker__name">{sticker.name}</span>
      {sticker.when && (
        <span className="sticker__when">
          {sticker.when.kind === 'caught' ? 'Caught ' : 'Home since '}
          {formatWhen(sticker.when.on)}
        </span>
      )}
    </>
  );
}

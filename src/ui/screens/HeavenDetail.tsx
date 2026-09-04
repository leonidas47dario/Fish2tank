/**
 * One fish, remembered - spec 046, FH-1 through FH-7.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE OLD ONE LINE IN THE JOURNAL: it is not a
 * second store of facts about a dead fish. Everything below is already written
 * and already dated - the life events, the photographs, the measurements, the
 * memorial - and spec 037 gave them one stream to merge into. This page is a
 * place to read that stream, ending where it ended.
 *
 * FR-L03 IS THE HARDEST CONSTRAINT AND IT IS DELIBERATELY THE FIRST DECISION
 * HERE: "a gentle, dignified tone rather than a stats-heavy reward screen".
 * Every number on this page is a fact about an animal and none of them is a
 * score. Nothing is ranked, nothing is totalled across fish, and no tier,
 * rarity band or completion percentage appears anywhere - which is why
 * growth reads "2.1 in → 2.8 in" rather than "+33%": the percentage is the
 * version that reads as a performance.
 *
 * WHERE P6 BITES: "Together for N days" appears only when BOTH ends are real.
 * `summariseLife` decides that, not this file; a fish nobody dated has no span
 * and the page says so rather than reaching for `holding.createdAt`, which for
 * the 61 imported rows is the minute a spreadsheet was read.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data/db';
import { readMediaBlob } from '@/data/media/read';
import {
  createKeeperPrinciple, deleteMemorial, setAcquiredOn, updateMemorial,
} from '@/data/repositories';
import { summariseLife, type LifeSummary } from '@/domain/fish-timeline';
import { formatLength } from '@/domain/units';
import type { CauseConfidence } from '@/domain/types';
import { CATALOG_BY_SPECIES } from '@/data/catalog';
import { useBlobUrl } from '../blob-url';
import { useFishTimeline } from '../hooks';
import { FishTimeline } from '../components/FishTimeline';
import { InlineField, InlineNote } from '../components/InlineField';
import { ButterflyIcon, CaretLeftIcon } from '../components/Icons';
import { longDate } from './Heaven';

/** FR-L02: several possibilities are valid; there is no required diagnosis. */
const CONFIDENCE: Array<{ id: CauseConfidence; name: string }> = [
  { id: 'unknown', name: 'Never worked out' },
  { id: 'suspected', name: 'Suspected' },
  { id: 'likely', name: 'Likely' },
  { id: 'confirmed', name: 'Confirmed' },
];

export default function HeavenDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const page = useLiveQuery(async () => {
    if (!id) return null;
    const memorial = await db.memorials.get(id);
    if (!memorial) return null;

    const holding = await db.holdings.get(memorial.holdingId);
    const specimenId = memorial.specimenId ?? holding?.specimenId;
    const specimen = specimenId ? await db.specimens.get(specimenId) : undefined;

    const [events, measurements] = await Promise.all([
      db.lifeEvents.where('holdingId').equals(memorial.holdingId).toArray(),
      db.holdingMeasurements.where('holdingId').equals(memorial.holdingId).toArray(),
    ]);
    const media = specimenId
      ? await db.media.where('specimenIds').equals(specimenId).toArray()
      : [];

    const life = summariseLife({
      holding: { acquiredOn: holding?.acquiredOn },
      memorial, events, media, measurements,
    });

    // The last photograph, which is the one a keeper looks for. Preview, not
    // thumbnail: this is drawn full-width, and spec 036's rule is that a
    // thumbnail suits a box of 107 CSS px or less.
    const blob = life.lastPhoto ? await readMediaBlob(life.lastPhoto, 'preview') : undefined;

    const tanks = await db.aquariums.toArray();
    const speciesId = specimen?.speciesId ?? holding?.speciesId;

    return {
      memorial,
      holdingId: memorial.holdingId,
      specimenId,
      acquiredOn: holding?.acquiredOn,
      life,
      blob,
      name: specimen?.nickname
        ?? holding?.rawLabel
        ?? specimen?.rawLabel
        ?? (speciesId ? CATALOG_BY_SPECIES.get(speciesId)?.commonName : undefined)
        ?? 'A fish',
      species: speciesId ? CATALOG_BY_SPECIES.get(speciesId)?.commonName : undefined,
      // Named, in the order they were lived in. A tank since deleted keeps its
      // place in the story; it just has no name to show.
      tankNames: life.tanks
        .map((t) => tanks.find((a) => a.id === t)?.name)
        .filter((n): n is string => Boolean(n)),
    };
  }, [id]);

  const photoUrl = useBlobUrl(page?.blob);
  const timeline = useFishTimeline(page?.holdingId);

  const principle = useLiveQuery(
    async () => (id
      ? (await db.keeperPrinciples.toArray()).find((k) => k.sourceMemorialId === id)
      : undefined),
    [id],
  );

  if (!id) return <p className="empty">No memorial.</p>;
  if (page === undefined) return <p className="empty muted">Loading…</p>;
  if (page === null) return <p className="empty">That memorial is no longer here.</p>;

  const { memorial, life } = page;

  return (
    <div className="screen">
      <div className="topbar">
        <button type="button" className="iconbtn" onClick={() => navigate(-1)} aria-label="Back">
          <CaretLeftIcon size={22} aria-hidden="true" />
        </button>
        <span className="grow" />
      </div>

      {photoUrl && (
        <figure className="heaven-hero">
          <img src={photoUrl} alt={`The last photograph of ${page.name}`} />
          {life.lastPhoto && (
            <figcaption className="xs muted">
              The last photograph · {longDate(life.lastPhoto.capturedAt.slice(0, 10))}
            </figcaption>
          )}
        </figure>
      )}

      <header className="pad">
        <h1 className="specimen-name">
          <ButterflyIcon size={22} aria-hidden="true" /> {page.name}
        </h1>
        {page.species && page.species !== page.name && (
          <p className="specimen-common">{page.species}</p>
        )}
        {/*
          A HEADER THAT READS AS A SPAN OF TIME, where a tank header reads as
          capacity. This one line is the differentiation that a tinted banner
          only pretends at.
        */}
        <p className="heaven-span data">{spanLine(life)}</p>
        {life.anchor?.lowerBound && (
          <p className="xs muted" style={{ marginBottom: 0 }}>
            Dated from the earliest photograph, which is the earliest proof there
            is — not necessarily when they arrived.
          </p>
        )}
      </header>

      <section className="panel">
        <h2 className="sec-head">Remembering</h2>

        {/*
          Spec 041's rule holds here: everything editable edits where it is
          displayed. A memorial written in the first hour is written badly on
          purpose - the keeper had just lost a fish - and it must be possible
          to come back and say it properly without an "edit" mode.
        */}
        <div className="pad">
          <InlineNote
            label="The story"
            value={memorial.story}
            empty="Write what happened, when you are ready."
            onSave={(v) => updateMemorial(memorial.id, { story: v ?? null })}
          />
        </div>

        <dl className="factlist">
          <InlineField
            label="Came home"
            type="date"
            value={page.acquiredOn}
            empty="not recorded"
            onSave={(v) => setAcquiredOn(page.holdingId, v)}
          />
          <InlineField
            label="Died"
            type="date"
            value={memorial.occurredOn}
            onSave={(v) => (v ? updateMemorial(memorial.id, { occurredOn: v }) : undefined)}
          />
          <InlineField
            label="Cause"
            value={memorial.causeConfidence}
            empty="never worked out"
            options={CONFIDENCE}
            onSave={(v) => updateMemorial(memorial.id, {
              causeConfidence: (v as CauseConfidence) ?? 'unknown',
            })}
          />
          <InlineField
            label="What may have contributed"
            value={memorial.suspectedContributors.join(', ')}
            empty="nothing written down"
            onSave={(v) => updateMemorial(memorial.id, {
              // FR-L02: several possibilities are valid, so this is a list and
              // not a diagnosis. Empty means none were named, not "none".
              suspectedContributors: v
                ? v.split(',').map((s) => s.trim()).filter(Boolean)
                : [],
            })}
          />
          {/*
            GROWTH IS TWO SIZES, NEVER A PERCENTAGE, and appears only when
            there are two measurements: one is a size, not a growth, and
            reporting "grew 0 in" from a single data point would be inventing
            the second one (P6).
          */}
          {life.grew && (
            <div className="factlist__row">
              <dt>Grew</dt>
              <dd className="data">
                {formatLength(life.grew.from)} → {formatLength(life.grew.to)}
              </dd>
            </div>
          )}
          {page.tankNames.length > 0 && (
            <div className="factlist__row">
              <dt>{page.tankNames.length === 1 ? 'Lived in' : 'Lived in'}</dt>
              <dd>{page.tankNames.join(' → ')}</dd>
            </div>
          )}
          {page.specimenId && (
            <div className="factlist__row">
              <dt>Their record</dt>
              <dd><Link to={`/specimen/${page.specimenId}`}>Open the catch</Link></dd>
            </div>
          )}
        </dl>
      </section>

      <section className="panel">
        <h2 className="sec-head">What it taught you</h2>
        <div className="pad">
          <InlineNote
            label="The lesson"
            value={memorial.lesson}
            empty="Nothing yet, and there may never be."
            onSave={(v) => updateMemorial(memorial.id, { lesson: v ?? null })}
          />
          {/* FR-L04: a lesson becomes a principle only when the keeper says so.
              Promoting it automatically would turn grief into a checklist. */}
          {memorial.lesson && !principle && (
            <button
              type="button"
              className="btn--ghost"
              onClick={() => void createKeeperPrinciple(memorial.lesson!, {
                memorialId: memorial.id, specimenId: memorial.specimenId,
              })}
            >
              Keep this in the Keeper's Code
            </button>
          )}
          {principle && (
            <p className="xs muted" style={{ marginBottom: 0 }}>
              Kept in your Keeper's Code.
            </p>
          )}
        </div>
      </section>

      {/*
        THE WHOLE TIMELINE, ENDING AT THE MEMORIAL - which is the sentence
        spec 037 finished on and the reason this feature waited for it. Notes
        are written from inside it, in date order beside the photographs, so
        backfilling a fish kept for two years is the same act as writing about
        one that died yesterday.
      */}
      {timeline && <FishTimeline timeline={timeline} title={page.name} onMemorialPage />}

      <section className="panel">
        <h2 className="sec-head">Correcting the record</h2>
        {!confirming ? (
          <div className="pad">
            <button type="button" className="btn--ghost" onClick={() => setConfirming(true)}>
              Remove this memorial
            </button>
          </div>
        ) : (
          <div className="pad stack">
            {/*
              WHAT STAYS IS THE POINT. Somebody clearing a mistyped memorial is
              not asking to resurrect a fish or lose its pictures - the same
              rule ENH-09 settled for deleting a catch, and the two must not
              disagree.
            */}
            <p className="panel__note" style={{ marginTop: 0 }}>
              This removes the record of the death. {page.name}, their tank
              history and their photographs all stay, and so does the day they
              died in the history below.
              {principle && ' The principle you kept from it goes with it.'}
            </p>
            <div className="row">
              <button
                type="button"
                className="btn--danger"
                onClick={async () => { await deleteMemorial(memorial.id); navigate('/heaven'); }}
              >
                Remove it
              </button>
              <button type="button" className="btn--ghost" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The one line at the head of the page.
 *
 * "Together for N days" only when both ends are real - `summariseLife` has
 * already refused a negative span and refused to invent a start date, so an
 * absent `days` here means the app genuinely does not know and the line says
 * only what it does know.
 */
function spanLine(life: LifeSummary): string {
  const died = `Died ${longDate(life.died)}`;
  if (life.days === undefined || !life.anchor) return died;

  const together = life.anchor.lowerBound
    ? `Together for at least ${plural(life.days)}`
    : `Together for ${plural(life.days)}`;
  return `${longDate(life.anchor.on)} — ${longDate(life.died)} · ${together}`;
}

function plural(days: number): string {
  if (days < 400) return `${days} day${days === 1 ? '' : 's'}`;
  // Past a year, days stop being how anybody holds the number. Years read as
  // "2 years" rather than "2.3 years": a decimal on a life is a measurement,
  // and this line is a sentence.
  const years = Math.floor(days / 365);
  const rest = days - years * 365;
  const months = Math.floor(rest / 30);
  return months > 0
    ? `${years} year${years === 1 ? '' : 's'} and ${months} month${months === 1 ? '' : 's'}`
    : `${years} year${years === 1 ? '' : 's'}`;
}

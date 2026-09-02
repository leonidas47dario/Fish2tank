/**
 * One specimen, its whole story - PRD 3.4, 4.3-4.8.
 *
 * Everything the store visit deferred happens here: confirm the identity,
 * record what it cost, screen it against the real tanks, see the reveal, write
 * the story, and — only if it ever happens — bring it home. One record follows
 * the fish through all of it (FR-T01).
 *
 * The screening block is what the redesign changed. It used to print seven
 * factors for each of six tanks, all expanded, with no summary and no sticky
 * anything: 20,286px, about 25 phone screens of reasoning with the answer
 * buried somewhere inside it. Now the answer comes first as one sentence, each
 * tank is one row carrying its own worst finding, and the seven factors are
 * behind that row.
 *
 * Nothing was removed to achieve that. FR-E04 still holds: every factor, every
 * input, every missing input and the rules version are all still reachable,
 * one tap further in.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data/db';
import {
  acquireSpecimen, addEncounterChapter, assertIdentity, deleteCatch,
  evaluateSpecimen, moveHolding, planDeleteCatch, recordPrice, updateCatch,
  type DeleteCatchPlan,
} from '@/data/repositories';
import { identifyFromText } from '@/data/identify';
import { deriveQuantity } from '@/domain/holdings';
import { formatVolume } from '@/domain/units';
import type { Specimen, Verdict } from '@/domain/types';
import { useFishTimeline, useSearchableSpecies } from '../hooks';
import {
  CATALOG_BY_SPECIES, identityStatusFor, portraitAsset, type CatalogSpecies,
} from '@/data/catalog';
import { IdentityBadge, VerdictBadge } from '../components/Badges';
import { FactorList, MissingInputsNotice } from '../components/FactorList';
import { InlineField, InlineNote } from '../components/InlineField';
import { usePrefersReducedMotion } from '@/theme/ThemeProvider';
import { CaretLeftIcon, CaretRightIcon } from '../components/Icons';
import { CatchPhotos } from '../components/CatchPhotos';
import { FishTimeline } from '../components/FishTimeline';

export default function SpecimenDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();

  const specimen = useLiveQuery(() => (id ? db.specimens.get(id) : undefined), [id]);
  const species = useLiveQuery(
    async () => (specimen?.speciesId ? db.species.get(specimen.speciesId) : undefined),
    [specimen?.speciesId],
  );
  const encounters = useLiveQuery(
    async () => (id ? (await db.encounters.where('specimenId').equals(id).toArray())
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt)) : []),
    [id],
  );
  const assessments = useLiveQuery(
    async () => (id ? (await db.assessments.where('specimenId').equals(id).toArray())
      .sort((a, b) => b.assessedAt.localeCompare(a.assessedAt)) : []),
    [id],
  );
  const prices = useLiveQuery(
    async () => (id ? db.priceObservations.where('specimenId').equals(id).toArray() : []),
    [id],
  );
  const aquariums = useLiveQuery(() => db.aquariums.where('status').equals('active').toArray(), []);
  const places = useLiveQuery(() => db.places.toArray(), []);

  /**
   * Where this fish actually is, which is a question about residencies rather
   * than about `specimen.status`.
   *
   * A holding is in a tank only while it has a residency with no end date;
   * one that has never been placed, or whose residency was closed, is in no
   * tank at all and was invisible on every screen before spec 005.
   */
  const placement = useLiveQuery(async () => {
    if (!id) return undefined;
    const holdings = await db.holdings.where('specimenId').equals(id).toArray();
    if (holdings.length === 0) return [];
    const [residencies, tanks, events] = await Promise.all([
      db.residencies.toArray(), db.aquariums.toArray(), db.lifeEvents.toArray(),
    ]);
    return holdings.map((holding) => {
      const open = residencies.find((r) => r.holdingId === holding.id && !r.endDate);
      return {
        holding,
        aquarium: open ? tanks.find((t) => t.id === open.aquariumId) : undefined,
        quantity: deriveQuantity(holding, events),
      };
    });
  }, [id]);

  const timeline = useFishTimeline(placement?.[0]?.holding.id);

  /**
   * Spec 039. Owned means a holding exists - acquireSpecimen mints one - so
   * the screening panel disappears the moment the fish is brought home.
   */
  const owned = (placement?.length ?? 0) > 0;
  const placed = placement?.filter((p) => p.aquarium) ?? [];
  const unplaced = placement?.filter((p) => !p.aquarium) ?? [];


  // Hooks before the early returns, always: React counts them per render and
  // a conditional one is error #310. The screening panel's state came back
  // with it in spec 039 and briefly landed below these guards.
  const [busy, setBusy] = useState(false);
  const [openTank, setOpenTank] = useState<string | undefined>();

  if (!id) return <p className="empty">No specimen.</p>;
  if (specimen === undefined) return <p className="empty muted">Loading…</p>;
  if (specimen === null) return <p className="empty">That catch is no longer here.</p>;

  const latest = encounters?.[encounters.length - 1];
  const newest = assessments?.[0];
  const groupedAssessments = assessments?.filter((a) => a.assessedAt === newest?.assessedAt) ?? [];

  async function onEvaluate() {
    setBusy(true);
    await evaluateSpecimen(id!, { observedSize: latest?.observedSize });
    setBusy(false);
  }


  const price = prices?.[0];
  const title = specimen.nickname ?? specimen.rawLabel ?? 'Mystery Catch';

  /**
   * Whether this record has a label at all (spec 005).
   *
   * `provisional` counts. It is the state for a fish genuinely absent from the
   * catalog: the store's word, recorded verbatim, and shown as weaker than a
   * match. Refusing to accept it would leave a real catch with no way forward,
   * since the catalog cannot contain every fish a shop will sell.
   */
  const identified = specimen.identityStatus === 'user-confirmed'
    || specimen.identityStatus === 'provisional';

  /**
   * Where this fish lives (PRD 4.8, spec 005), rendered on BOTH sides of the
   * identity gate - which is why it is a variable rather than inline JSX.
   *
   * It used to be gated on `status !== 'resident'`, a wrong proxy for "is it in
   * a tank", and spec 005 replaced that with the real question. It was then
   * behind the identity seal, which is the bug spec 021 fixes: a fish you have
   * not named yet still lives somewhere, and the seal's own reason does not
   * reach this panel. Price, screening, Discovery and the story describe a
   * SPECIES and have nothing to say without a name; a tank placement describes
   * an animal. The inventory importer has always created residents with no
   * species at all, so the model never required one either.
   */
  const placementPanel = (
    <section className="panel">
      <h2 className="sec-head">Keeping the fish</h2>

      {placement === undefined ? (
        <p className="panel__note" style={{ marginTop: 0 }}>Checking…</p>
      ) : placed.length === 0 ? (
        <>
          <p className="panel__note" style={{ marginTop: 0 }}>
            Nothing here needs to happen. A catch is documentation, not acquisition.
          </p>
          <div style={{ marginTop: 'var(--space-3)' }}>
            {unplaced.length > 0 ? (
              /* It already has a holding - imported, or minted when you
                 added a photo - it is just not in a tank. Placing the
                 holding it has beats minting a second one. */
              <PlaceHolding
                holdingId={unplaced[0]!.holding.id}
                aquariums={aquariums ?? []}
                defaultQuantity={latest?.quantitySeen}
              />
            ) : (
              <BringHome
                specimenId={id}
                aquariums={aquariums ?? []}
                defaultQuantity={latest?.quantitySeen}
              />
            )}
          </div>
        </>
      ) : (
        /*
          Spec 042. A PICKER THAT MOVES IT, not a way to add a second one.

          The old panel offered "Also add to another tank", which minted a
          second holding of the same species. That is a real capability - six
          tetras split across two tanks genuinely are two holdings - but it is
          the wrong offer on a SPECIMEN's record. This page is about one fish,
          a fish is in one tank, and offering to put it in a second is offering
          to create a second animal.

          moveHolding has done the right thing since FR-T03: it closes the
          current residency, opens the next, and writes a `moved` life event -
          which now also lands in the timeline, so where a fish has lived
          becomes part of its history rather than only its current state.

          Several rows only when a record already HAS several holdings, which
          the inventory import can produce and nothing here can any more.
          Hiding the second would be tidier and would let a keeper see a fish
          in the tank list that its own record denied being in.
        */
        <dl className="factlist">
          {placed.map((p) => (
            <InlineField
              key={p.holding.id}
              label={placed.length > 1 ? `Tank (×${p.quantity})` : 'Tank'}
              value={p.aquarium!.id}
              empty="not in a tank"
              options={(aquariums ?? []).map((t) => ({ id: t.id, name: t.name }))}
              onSave={(to) => (to && to !== p.aquarium!.id
                ? moveHolding(p.holding.id, to)
                : undefined)}
            />
          ))}
          {placed.length === 1 && (
            <div className="factlist__row">
              <dt>How many</dt>
              {/* Derived from life events by deriveQuantity - a death, a birth,
                  a correction - so it is shown rather than typed. A number that
                  looked editable but was computed would be worse than one that
                  plainly is not. */}
              <dd>×{placed[0]!.quantity}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );

  return (
    <div className="screen">
      <div className="topbar">
        <button type="button" className="iconbtn" onClick={() => navigate(-1)} aria-label="Back">
          <CaretLeftIcon size={22} aria-hidden="true" />
        </button>
        <span className="grow" />
      </div>

      {/* --- Media. Original, always (FR-J01, PRD 7.4) --------------------- */}
      <CatchPhotos specimenId={specimen.id} title={title} reducedMotion={reducedMotion} />

      {/*
        Spec 037. Rendered only once this fish is actually kept - a catch that
        never came home is an encounter, and "history" on a fish you met once
        in a shop would be a section about nothing. The first holding, because
        a specimen with several is the group case and they share one story.
      */}
      {timeline && timeline.entries.length > 0 && (
        <FishTimeline timeline={timeline} title={title} />
      )}

      <header className="pad">
        <h1 className="specimen-name">{title}</h1>
        {species && (
          <>
            {species.scientificName && <p className="specimen-sci">{species.scientificName}</p>}
            <p className="specimen-common">{species.commonName}</p>
          </>
        )}
        <div className="tagrow">
          {/* Identity is about THIS fish - what it was decided to be, and how
              confidently. The tier and scarcity badges went with Discovery:
              both are the species' rarity, identical for every specimen. */}
          <IdentityBadge status={specimen.identityStatus} />
        </div>

        {/*
          Spec 040. ONE BLOCK OF FACTS ABOUT THIS FISH, one per line.

          Spec 039 put these here and edited them in place, which was right,
          and laid them out as five equal columns, which was not: on a 390px
          phone that is 70px each, so every heading wrapped to three lines and
          the values wrapped under them. Reported as "too cramped for phone",
          and the screenshot showed it plainly.

          Rows, not columns. And the nickname and the price join them, because
          they are the same kind of fact and were three separate sections
          asking the reader to hold one record in three places.

          `specimen.createdAt` is still not offered as "caught": it is when the
          row was written, not when the fish was met.
        */}
        <dl className="factlist">
          <InlineField
            label="Nickname"
            value={specimen.nickname}
            empty="none"
            onSave={(v) => updateCatch({ specimenId: id, nickname: v ?? null })}
          />
          <InlineField
            label="The store's label"
            value={specimen.rawLabel}
            empty="not written down"
            onSave={(v) => updateCatch({ specimenId: id, rawLabel: v ?? null })}
          />
          <InlineField
            label="Seen on"
            type="date"
            value={latest?.observedAt?.slice(0, 10)}
            onSave={(v) => updateCatch({
              specimenId: id,
              encounterId: latest?.id,
              ...(v ? { observedAt: new Date(`${v}T12:00:00`).toISOString() } : {}),
            })}
          />
          <InlineField
            label="Shop"
            value={latest?.placeId}
            options={(places ?? []).map((pl) => ({ id: pl.id, name: pl.name }))}
            onSave={(v) => updateCatch({
              specimenId: id, encounterId: latest?.id, placeId: v ?? null,
            })}
          />
          <InlineField
            label="How many you saw"
            type="number"
            value={latest?.quantitySeen ? String(latest.quantitySeen) : undefined}
            empty="not counted"
            onSave={(v) => updateCatch({
              specimenId: id, encounterId: latest?.id,
              quantitySeen: v ? Number(v) : null,
            })}
          />
          {/* Inches, matching the price form and every other size the app
              asks for. The label is "(in)" rather than "when seen (inches)"
              because the long version was the one heading still wrapping to
              two lines at 390px - measured, not guessed. */}
          <InlineField
            label="Size (in)"
            type="number"
            value={latest?.observedSize ? String(latest.observedSize.value) : undefined}
            onSave={(v) => updateCatch({
              specimenId: id, encounterId: latest?.id,
              observedSize: v ? { value: Number(v), unit: 'in' } : null,
            })}
          />

          {/*
            The price figures, folded in rather than sitting under their own
            heading. They are read-only HERE on purpose: a price is a dated
            observation of what a shop asked, not a mutable field, so the way
            to change one is to record another - which is what the form below
            does. Editing the number in place would quietly rewrite history.
          */}
          {price && (
            <>
              <div className="factlist__row">
                <dt>Asking</dt>
                <dd className={price.askingPrice === undefined ? 'is-blank' : undefined}>
                  {price.askingPrice === undefined ? 'not noted' : `$${price.askingPrice}`}
                </dd>
              </div>
              {price.memberPrice !== undefined && (
                <div className="factlist__row">
                  <dt>Member</dt>
                  <dd>${price.memberPrice}</dd>
                </div>
              )}
              <div className="factlist__row">
                <dt>Paid</dt>
                <dd className={price.paidPrice === undefined ? 'is-blank' : undefined}>
                  {price.paidPrice === undefined ? 'not bought' : `$${price.paidPrice}`}
                </dd>
              </div>
            </>
          )}
        </dl>

        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary className="xs muted" style={{ cursor: 'pointer' }}>
            {price ? 'Record another price' : 'Record a price'}
          </summary>
          <PriceForm
            specimenId={id}
            speciesId={specimen.speciesId}
            encounterId={latest?.id}
            places={places ?? []}
          />
        </details>
      </header>

      {/* --- The gate (spec 005) --------------------------------------------
          "All records must be identified." Until a label is set, Identity is
          the only live panel.

          Sealed structurally with an early return rather than by wrapping each
          section in a condition. There are nine panels below and a per-section
          guard is one forgotten `&&` away from leaking; this cannot leak.

          Delete stays reachable. A record you cannot identify AND cannot
          remove would be a genuine trap, and the seal is meant to direct the
          work, not to hold the user hostage. Nothing here deletes on its own:
          the media and the draft are intact and stay that way. */}
      {!identified ? (
        <>
          <IdentityPanel specimen={specimen} species={species} />
          {placementPanel}
          <section className="panel">
            <p className="panel__note" style={{ marginTop: 0 }}>
              Price, tank screening, Discovery and the story open once this has a label. They all
              describe a species, so they have nothing to say until this one has a name. Where it
              lives does not depend on that, so it is above. Your photo and the draft are saved.
            </p>
          </section>
          <DeleteCatch
            specimenId={id}
            name={title}
            onDeleted={() => navigate('/catch', { replace: true })}
          />
        </>
      ) : (
      <>
      {/*
        Spec 039. TANK SCREENING, BUT ONLY WHILE THE ANSWER CAN CHANGE
        ANYTHING.

        It was removed entirely at first, as species-shaped: every input is a
        species fact and the verdict for two severums in one tank is
        identical. The keeper's correction is sharper than the removal was -
        "the tank analysis can stay but should disappear once the fish is
        already owned, because the analysis is meaningless."

        That is the real distinction. Standing in a shop, "would this suit my
        tanks?" is a decision with a deadline. Once the fish is home and in a
        tank, the same panel is a verdict on something already done - and a
        high-risk badge over a fish you are keeping is either a reproach or
        noise. The stocking view is where a tank you already own gets judged.

        Owned means it has a holding: acquireSpecimen mints one, so this
        vanishes the moment the fish is brought home.
      */}
      {!owned && (
        <section className="panel panel--flush">
          <div className="pad spread" style={{ marginBottom: 'var(--space-3)' }}>
            <h2 className="sec-head" style={{ margin: 0 }}>Your tanks</h2>
            <button type="button" className="prompt__act" onClick={() => void onEvaluate()} disabled={busy}>
              {busy ? 'Checking…' : groupedAssessments.length ? 'Check again' : 'Check my tanks'}
            </button>
          </div>

          {groupedAssessments.length === 0 ? (
            <div className="prompt">
              <p className="prompt__title">Not screened yet</p>
              <p className="prompt__body">
                {aquariums?.length
                  ? `Check this fish against your ${aquariums.length} tank${aquariums.length === 1 ? '' : 's'}. Nothing is inferred: where a fact is missing the answer says so.`
                  : 'There are no tanks to check against yet.'}
              </p>
            </div>
          ) : (
            <>
              <p className="verdict-lede">{lede(groupedAssessments.map((a) => a.verdict))}</p>

              {groupedAssessments.map((a) => {
                const tank = aquariums?.find((t) => t.id === a.aquariumId);
                const name = tank?.name ?? a.aquariumId;
                const open = openTank === a.id;
                const bad = a.verdict === 'high-risk' || a.verdict === 'extreme-risk';
                return (
                  <div key={a.id}>
                    <button
                      type="button"
                      className="tankrow"
                      aria-expanded={open}
                      onClick={() => setOpenTank(open ? undefined : a.id)}
                    >
                      <span className="grow">
                        <span className="tankrow__name">{name}</span>
                        {/*
                          The reason, on the COLLAPSED row. The engine already
                          aggregates worst-wins and writes the top findings into
                          the headline; printing it small and grey under a pill
                          was what let a row reading "Conditional" hide "eats 4
                          residents" one tap down. A summary is never allowed to
                          be calmer than its own contents.
                        */}
                        {a.headline && (
                          <span className={`tankrow__why${bad ? '' : ' tankrow__why--warn'}`}>
                            {a.headline}
                          </span>
                        )}
                      </span>
                      <VerdictBadge verdict={a.verdict} />
                    </button>

                    {open && (
                      <>
                        {/* FR-E03: the juvenile view is present but visibly secondary. */}
                        {a.temporaryJuvenileFit && (
                          <p className="warn" style={{ margin: 'var(--space-3) var(--space-4)' }}>
                            Right now, temporarily: {a.temporaryJuvenileFit.note}
                          </p>
                        )}
                        <MissingInputsNotice missing={a.missingInputs} />
                        {a.factors.length > 0 && <FactorList assessment={a} tankName={name} />}
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </section>
      )}

      {/* --- Identity (PRD 4.3) ------------------------------------------- */}
      <IdentityPanel specimen={specimen} species={species} />

      {/* Directly under the name, because it is what the name makes you ask. */}
      {specimen.speciesId && <SpeciesBrief speciesId={specimen.speciesId} />}

      {/* --- Size and price (PRD 4.5) ------------------------------------- */}
      {/*
        Spec 039. The market reference and the price-fit verdict are gone from
        here: both answer "what do fish LIKE THIS sell for", which is the
        species' question and is already answered on the species page. What you
        paid, where and when stays above, because that is a fact about this
        exact animal and lives nowhere else.
      */}

      {/*
        Spec 039. Discovery removed: a tier is how rare the SPECIES is, and it
        is identical for every specimen of it. The badges are on the species
        page, where the question belongs; the reveal ceremony and its snapshot
        are untouched.
      */}

      {/* --- Story (PRD 4.7) ---------------------------------------------- */}
      <section className="panel">
        <h2 className="sec-head">Story</h2>
        <StoryForm specimenId={id} />
        <ul className="list" style={{ marginTop: 'var(--space-4)' }}>
          {encounters?.map((e, i) => (
            <li key={e.id}>
              <p className="xs faint data" style={{ marginBottom: 'var(--space-1)' }}>
                Chapter {i + 1} · {new Date(e.observedAt).toLocaleString()}
              </p>
              {/* Spec 039: the note edits here, where it is read. Previously
                  only the LATEST chapter's note was reachable, and only
                  through the edit form - so a note on an older chapter could
                  be read and never corrected. */}
              <InlineNote
                label={`Note on chapter ${i + 1}`}
                value={e.notes}
                empty="No note on this chapter yet."
                onSave={(v) => updateCatch({ specimenId: id, encounterId: e.id, notes: v ?? null })}
              />
            </li>
          ))}
        </ul>
      </section>

      {/*
        Spec 039. "Edit this catch" is gone. Every field it held now edits
        where it is displayed - the label, the date, the shop and the count in
        the header, the note on each chapter in the Story below. FR-C03 is
        unchanged in what it permits and changed in how it is reached.
      */}

      {placementPanel}

      {/* --- Delete. Last, and behind a confirmation that states the cost. -- */}
      <DeleteCatch
        specimenId={id}
        name={specimen.nickname ?? specimen.rawLabel ?? 'this catch'}
        onDeleted={() => navigate('/')}
      />
      </>
      )}
    </div>
  );
}

/**
 * Bring a catch home - deliberately two steps.
 *
 * This used to commit on the select's onChange, which made choosing a tank
 * from a dropdown silently create a holding, a dated residency and an
 * "acquired" life event, and flip the specimen to resident. The only feedback
 * was the section disappearing. Since catches held in a tank cannot be
 * deleted, one stray tap also permanently blocked removing that catch.
 *
 * So the tank choice is now just a choice, and a labelled button does the
 * writing - after saying in words what it is about to record.
 */
function BringHome({ specimenId, aquariums, defaultQuantity }: {
  specimenId: string;
  aquariums: Array<{ id: string; name: string }>;
  defaultQuantity?: number;
}) {
  const [tankId, setTankId] = useState('');
  const [qty, setQty] = useState(String(defaultQuantity ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const chosen = aquariums.find((t) => t.id === tankId);
  const n = Number(qty);
  const validQty = Number.isInteger(n) && n >= 1;

  return (
    <>
      <label htmlFor="acquire-tank">Bring into</label>
      <select id="acquire-tank" value={tankId} onChange={(e) => setTankId(e.target.value)}>
        <option value="">Choose a tank…</option>
        {aquariums.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {chosen && (
        <>
          {/* acquireSpecimen has always accepted a quantity; this screen was
              calling it without one and silently recording 1. Defaults to
              however many the encounter says you saw, rather than asking a
              question the record has already answered. */}
          <div style={{ marginTop: 'var(--space-3)' }}>
            <label htmlFor="acquire-qty">How many</label>
            <input
              id="acquire-qty" inputMode="numeric" value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>

          <p className="panel__note panel__note--tight">
            Records that you own {validQty && n > 1 ? `${n} of these` : 'this fish'} and that
            {validQty && n > 1 ? ' they live' : ' it lives'} in {chosen.name} from today. It then
            appears in that tank, and the catch can no longer be deleted.
          </p>
          {error && <p className="warn">{error}</p>}
          <button
            type="button" className="btn btn--primary" disabled={busy || !validQty}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await acquireSpecimen(specimenId, chosen.id, { quantity: n });
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.error('[stock] bring home failed', { specimenId, tankId: chosen.id, quantity: n, error: message });
                setError(message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Recording…' : `Add to ${chosen.name}`}
          </button>
        </>
      )}
    </>
  );
}

/**
 * Put a holding that exists but lives nowhere into a tank.
 *
 * The case the old screen could not reach at all: an imported opening-balance
 * row whose residency was closed, or a holding minted by adding a photo. The
 * fish is already recorded as yours, so this opens a residency on the holding
 * it has rather than minting a second one.
 */
function PlaceHolding({ holdingId, aquariums, defaultQuantity }: {
  holdingId: string;
  aquariums: Array<{ id: string; name: string }>;
  defaultQuantity?: number;
}) {
  const [tankId, setTankId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const chosen = aquariums.find((t) => t.id === tankId);
  void defaultQuantity; // the holding already carries its own count

  return (
    <>
      <label htmlFor="place-tank">This one is yours already. Put it in</label>
      <select id="place-tank" value={tankId} onChange={(e) => setTankId(e.target.value)}>
        <option value="">Choose a tank…</option>
        {aquariums.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {chosen && (
        <>
          <p className="panel__note panel__note--tight">
            Records that it lives in {chosen.name} from today. The count it already carries is kept.
          </p>
          {error && <p className="warn">{error}</p>}
          <button
            type="button" className="btn btn--primary" disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await moveHolding(holdingId, chosen.id);
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.error('[stock] place failed', { holdingId, tankId: chosen.id, error: message });
                setError(message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Recording…' : `Put in ${chosen.name}`}
          </button>
        </>
      )}
    </>
  );
}



/**
 * Delete a catch that should not exist - a mis-tap, a duplicate, test data.
 *
 * Two-step on purpose, and the second step is not a generic "are you sure":
 * it names what goes with it, because the cascade reaches photos, prices and
 * the reveal. Where the fish is in a tank or has a memorial, the repository
 * refuses and the reason is shown instead of a button.
 */
function DeleteCatch({ specimenId, name, onDeleted }: {
  specimenId: string; name: string; onDeleted: () => void;
}) {
  const [plan, setPlan] = useState<DeleteCatchPlan | undefined>();
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    setPlan(await planDeleteCatch(specimenId));
    setBusy(false);
  }

  async function confirmDelete() {
    setBusy(true);
    const result = await deleteCatch(specimenId);
    setBusy(false);
    if (result.allowed) onDeleted();
    else setPlan(result);
  }

  const parts = plan ? [
    plan.media && `${plan.media} photo${plan.media === 1 ? '' : 's'}`,
    plan.prices && `${plan.prices} price note${plan.prices === 1 ? '' : 's'}`,
    plan.assessments && `${plan.assessments} tank screening${plan.assessments === 1 ? '' : 's'}`,
    plan.reveals && 'its reveal',
    plan.identifications && 'its identification history',
  ].filter(Boolean) as string[] : [];

  return (
    <section className="panel">
      <h2 className="sec-head">Delete</h2>
      {!plan && (
        <>
          <p className="panel__note" style={{ marginTop: 0 }}>
            For a catch that should not exist: a mis-tap, a duplicate, test data. A fish you were
            wrong about does not need deleting; correct its identity instead.
          </p>
          <button type="button" className="btn" onClick={() => void ask()} disabled={busy}
            style={{ marginTop: 'var(--space-3)' }}>
            Delete this catch…
          </button>
        </>
      )}

      {plan && !plan.allowed && (
        <>
          <p style={{ marginBottom: 'var(--space-3)' }}>{plan.reason}</p>
          <button type="button" className="btn btn--ghost" onClick={() => setPlan(undefined)}>Back</button>
        </>
      )}

      {plan && plan.allowed && (
        <>
          <p style={{ marginBottom: 'var(--space-2)' }}>
            Permanently delete <strong>{name}</strong>
            {parts.length > 0 && <> and {parts.join(', ')}</>}. This cannot be undone.
          </p>
          {/* The consequence that used to be a refusal. Stated in its own
              line rather than folded into the list above, and naming the tanks
              rather than counting them, because "also removes it from 2 tanks"
              is a number to accept on faith. */}
          {/* Fish Heaven, named on its own line.
​
              This used to be a refusal - "that record is deliberately
              permanent" - and it is the heaviest thing the cascade takes, so
              it does not get folded into the comma-list above with the price
              notes. A memorial is a fish you mourned; if it is going, that
              should be the sentence you read, not a clause. */}
          {plan.memorials > 0 && (
            <p className="warn panel__note--tight">
              Its {plan.memorials === 1 ? 'memorial' : `${plan.memorials} memorials`} in Fish Heaven
              {plan.principles > 0 && (
                <>, and the {plan.principles === 1 ? 'principle' : `${plan.principles} principles`} you
                  wrote from {plan.principles === 1 ? 'it' : 'them'},</>
              )}
              {' '}will be removed too.
            </p>
          )}
          {plan.holdings > 0 && (
            <p className="warn panel__note--tight">
              {plan.inTanks.length > 0
                ? <>
                    It will also be taken out of{' '}
                    {plan.inTanks.map((t, i) => (
                      <span key={t}>
                        {i > 0 && (i === plan.inTanks.length - 1 ? ' and ' : ', ')}
                        <strong>{t}</strong>
                      </span>
                    ))}.
                  </>
                : <>It will also be removed from your tank records.</>}
            </p>
          )}
          {plan.mediaSharedElsewhere > 0 && (
            <p className="panel__note panel__note--tight">
              {plan.mediaSharedElsewhere} photo{plan.mediaSharedElsewhere === 1 ? '' : 's'} also used by
              another catch will be kept.
            </p>
          )}
          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" className="btn btn--danger" onClick={() => void confirmDelete()} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete it'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setPlan(undefined)} disabled={busy}>
              Keep it
            </button>
          </div>
        </>
      )}
    </section>
  );
}


/**
 * The two things a record is called: what it is, and what you call it.
 *
 * Label is REQUIRED as of spec 005 - "all records must be identified". The
 * panel is always editable, including after confirmation. It used to collapse
 * into a sentence once confirmed, which meant the panel that made a
 * misidentification was the one place you could not correct it.
 *
 * `provisional` is the state for a fish genuinely absent from the catalog: the
 * store label is recorded verbatim and the record proceeds, but it is shown as
 * the weaker identification it is rather than being dressed up as a match.
 */
/**
 * The species profile, on the page where the fish actually is.
 *
 * WHAT WAS WRONG. The catch journal never linked to the species page - not
 * once, anywhere on 1,200 lines. Identify a fish, read its reveal, and you
 * land in a form with a name at the top and none of the facts behind it. In a
 * shop, holding the phone in front of the tank, the questions are "how big
 * does it get" and "what size tank", and the answers were two screens away
 * with no route to them.
 *
 * WHY BOTH INLINE AND A LINK. The four or five numbers that decide whether you
 * buy the fish are small enough to sit right here, so most of the time the
 * question is answered without going anywhere. The full profile - portrait
 * credits, card art, every store that sells it, the sourced quote behind each
 * care value - is a page, and stays one. ScrollMemory already restores this
 * page's scroll position on Back, so the round trip lands where it left.
 *
 * READS THE CATALOG, NOT THE SPECIES TABLE. The species table holds the 47
 * curated profiles; the catalog holds 2,176. The header above reads the
 * former, which is fine for a name and useless for care data that most of the
 * catalog only has in the latter.
 */
function SpeciesBrief({ speciesId }: { speciesId: string }) {
  const species: CatalogSpecies | undefined = CATALOG_BY_SPECIES.get(speciesId);
  if (!species) return null;

  const art = portraitAsset(speciesId);
  const facts = [
    species.adultSizeIn !== undefined
      && { k: 'Adult size', v: `${Math.round(species.adultSizeIn * 10) / 10}"` },
    species.minVolumeGal !== undefined
      && { k: 'Minimum tank', v: formatVolume({ value: species.minVolumeGal, unit: 'gal' }) },
    species.aggression && { k: 'Temperament', v: species.aggression },
    species.tempMinC !== undefined && species.tempMaxC !== undefined
      && { k: 'Temperature', v: `${species.tempMinC}\u2013${species.tempMaxC}\u00b0C` },
    species.waterZone && { k: 'Water column', v: species.waterZone.replace('-', ' ') },
    species.predationTags.length > 0 && { k: 'Predation', v: species.predationTags.join(', ') },
  ].filter((f): f is { k: string; v: string } => Boolean(f));

  return (
    <section className="panel">
      <div className="spread" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 className="sec-head" style={{ margin: 0 }}>About this species</h2>
        {/* One tap out, and Back lands you here again. */}
        <Link to={`/species/${speciesId}`} className="prompt__act">
          Full profile <CaretRightIcon size={14} aria-hidden="true" />
        </Link>
      </div>

      <div className="brief">
        {art && <img className="brief__art" src={art} alt="" loading="lazy" />}
        <div className="grow">
          {facts.length > 0 ? (
            <dl className="kv">
              {facts.map((f) => (
                <div key={f.k} style={{ display: 'contents' }}>
                  <dt>{f.k}</dt>
                  <dd>{f.v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            /* Named, not blank. The absence has a cause, and the full profile
               says the same thing at greater length. */
            <p className="panel__note" style={{ marginTop: 0 }}>
              Nobody has recorded how big this gets or what it needs. It is in the catalog because
              a store listed it, and nothing here is guessed from the family.
            </p>
          )}
        </div>
      </div>

      {/* The line that earns its place in a shop: what the tag might call it. */}
      {species.aliases.length > 0 && (
        <p className="panel__note panel__note--tight">Also sold as: {species.aliases.join(', ')}</p>
      )}
    </section>
  );
}

function IdentityPanel({ specimen, species }: {
  specimen: Specimen;
  species?: { commonName: string; scientificName?: string };
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  const confirmed = specimen.identityStatus === 'user-confirmed';
  const provisional = specimen.identityStatus === 'provisional';

  /**
   * The same corpus and the same ranking the capture flow uses (spec 007).
   *
   * This searched `db.species` until now - the 47 seeded care profiles - so
   * correcting a misidentified fish could reach 47 of 2,176 species, and this
   * is the ONLY screen that can repair a wrong identity (FR-I06).
   */
  const corpus = useSearchableSpecies();
  const matches = useMemo(
    () => (query.trim() ? identifyFromText(query, corpus) : []),
    [query, corpus],
  );

  async function confirm(speciesId: string) {
    setBusy(true);
    // Provisional for a species the keeper invented; see identityStatusFor().
    // This call site asserted `user-confirmed` unconditionally before spec 007,
    // which already contradicted submitUserSpecies() one module over.
    await assertIdentity({
      specimenId: specimen.id, speciesId, source: 'user', status: identityStatusFor(speciesId),
    });
    setQuery('');
    setChanging(false);
    setBusy(false);
  }

  const searching = !confirmed || changing;

  return (
    <section className="panel">
      <h2 className="sec-head">Identity</h2>

      <div>
        <label htmlFor="species-search">
          Label <span className="req" aria-hidden="true">*</span>
          <span className="visually-hidden"> (required)</span>
        </label>

        {confirmed && species && !changing && (
          <div className="tankrow" style={{ marginTop: 'var(--space-2)' }}>
            <span className="grow">
              <span className="tankrow__name">{species.commonName}</span>
              {species.scientificName && (
                <span className="tankrow__meta sci" style={{ display: 'block' }}>{species.scientificName}</span>
              )}
            </span>
            <button type="button" className="prompt__act" onClick={() => setChanging(true)}>
              Change
            </button>
          </div>
        )}

        {searching && (
          <>
            <input
              id="species-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="jaguar cichlid, managuensis, managuense…"
            />
            {matches.map(({ species: s }) => (
              <button
                key={s.speciesId}
                type="button"
                className="tankrow"
                disabled={busy}
                onClick={() => void confirm(s.speciesId)}
              >
                <span className="grow">
                  <span className="tankrow__name">{s.commonName}</span>
                  {s.scientificName && <span className="tankrow__meta sci" style={{ display: 'block' }}>{s.scientificName}</span>}
                </span>
              </button>
            ))}
            {changing && (
              <button type="button" className="prompt__act" onClick={() => { setChanging(false); setQuery(''); }}>
                Keep {species?.commonName ?? 'the current label'}
              </button>
            )}
          </>
        )}
      </div>

      {provisional && (
        <p className="panel__note">
          Recorded as <strong>{specimen.rawLabel}</strong>, which is what the tag said. Nothing in the
          catalog matched it, so this is the store&apos;s word rather than a confirmed species. Search
          above if it turns up later.
        </p>
      )}
      {confirmed && (
        <p className="panel__note">
          You confirmed this yourself. No confidence percentage is recorded, because none was measured.
        </p>
      )}

      {/* Spec 040: the nickname moved up into the fact block. Identity is
          about which SPECIES this is; what you call the animal is one of its
          own facts and belongs with the others. */}
    </section>
  );
}

/** Sentinel for the "add one" row, which is not a place id. */
const NEW_SHOP = '__new__';

function PriceForm({ specimenId, speciesId, encounterId, places }: {
  specimenId: string; speciesId?: string; encounterId?: string;
  /** Shops noted before, offered for reuse so the second visit is one tap. */
  places: Array<{ id: string; name: string }>;
}) {
  const [asking, setAsking] = useState('');
  const [size, setSize] = useState('');
  const [shopId, setShopId] = useState('');
  const [addingShop, setAddingShop] = useState(false);
  const [newShop, setNewShop] = useState('');
  const [saving, setSaving] = useState(false);

  // Same normalisation resolveShop uses, so what the form promises is what the
  // write actually does.
  const fold = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  const matchedExisting = addingShop && newShop.trim()
    ? places.find((pl) => fold(pl.name) === fold(newShop))
    : undefined;

  async function save() {
    setSaving(true);
    const observedSize = size ? { value: Number(size), unit: 'in' as const, estimate: true } : undefined;
    if (encounterId && observedSize) await db.encounters.update(encounterId, { observedSize });
    let recorded;
    if (asking) {
      // recordPrice still accepts memberPrice and paidPrice. The form stopped
      // asking; the store did not stop having member pricing, and a record
      // written before this change keeps its figure.
      recorded = await recordPrice({
        specimenId, speciesId, encounterId,
        askingPrice: Number(asking),
        observedSize,
        // A picked shop goes by id. A typed one goes by name and resolveShop
        // creates it - or reuses the match the form warned about above.
        ...(addingShop
          ? { shopName: newShop.trim() || undefined }
          : { placeId: shopId || undefined }),
      });
    }
    setAsking(''); setSize('');

    /*
     * The shop is deliberately NOT cleared. Recording two fish from one visit
     * is the normal case, and re-picking the shop every time is the kind of
     * small friction that stops people logging the second one.
     *
     * The id comes from the write, not from a lookup in `places`. That prop is
     * a live query and has not necessarily refreshed by the time this runs, so
     * searching it for the shop just created is a race that loses quietly -
     * the picker would fall back to "Not noted" and the next record would go
     * down shopless.
     */
    if (addingShop && recorded?.placeId) {
      setShopId(recorded.placeId);
      setAddingShop(false);
      setNewShop('');
    }
    setSaving(false);
  }

  return (
    <div className="stack">
      <div className="capture">
        <div>
          <label htmlFor="asking">Asking price</label>
          <input
            id="asking" inputMode="decimal" value={asking}
            onChange={(e) => setAsking(e.target.value)}
            // Spec 039: no market figure here either. It was a placeholder
            // rather than a value, but it is still the species' market on a
            // form about what THIS fish cost.
            placeholder="100"
          />
        </div>
        <div className="capture--wide">
          <label htmlFor="size">Approximate size (inches)</label>
          <input id="size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="6" />
        </div>
      </div>

      {/* Pick a shop, or add one.
​
          A datalist was the first attempt and it was the wrong shape: it looks
          like a plain text box, so the shops you have already saved are
          invisible until you start typing one - which is exactly when you no
          longer need them. A select shows them, and native pickers on a phone
          are a wheel rather than a dropdown, which is the better control for
          standing in a shop one-handed.

          Adding stays in the same control instead of behind a separate button.
          Nothing in this app could create a Place at all until now, so "the
          shop I am standing in is not on the list" is the common case, not the
          edge one, and it should not cost a hunt for somewhere else to press. */}
      <div>
        <label htmlFor="shop">Shop <span className="faint">(optional)</span></label>
        <select
          id="shop"
          value={addingShop ? NEW_SHOP : shopId}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_SHOP) { setAddingShop(true); setShopId(''); }
            else { setAddingShop(false); setShopId(v); setNewShop(''); }
          }}
        >
          <option value="">Not noted</option>
          {places.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
          <option value={NEW_SHOP}>＋ Add a shop…</option>
        </select>

        {addingShop && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <label htmlFor="new-shop" className="visually-hidden">Name of the new shop</label>
            <input
              id="new-shop"
              value={newShop}
              onChange={(e) => setNewShop(e.target.value)}
              placeholder="Old Town Aquarium"
              autoComplete="off"
              autoFocus
            />
            {/* Saying so beats silently folding it: a name that matches a shop
                you already have will reuse it, and you should know that before
                you press Record rather than wonder where the duplicate went. */}
            {matchedExisting && (
              <p className="xs faint" style={{ marginBottom: 0 }}>
                Matches <strong>{matchedExisting.name}</strong>, which you already have. It will be
                used rather than added twice.
              </p>
            )}
          </div>
        )}
      </div>
      <button type="button" onClick={() => void save()} disabled={saving || (!asking && !size)}>
        Record
      </button>
      <p className="xs faint" style={{ marginBottom: 0 }}>
        No price tag? Leave it blank. Blank means unknown, not free.
      </p>
    </div>
  );
}

function StoryForm({ specimenId }: { specimenId: string }) {
  const [text, setText] = useState('');
  return (
    <div className="stack">
      <div>
        <label htmlFor="story">Add a chapter</label>
        <textarea
          id="story" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Why this one mattered."
        />
      </div>
      <button
        type="button"
        disabled={!text.trim()}
        onClick={async () => { await addEncounterChapter(specimenId, { notes: text.trim() }); setText(''); }}
      >
        Save chapter
      </button>
    </div>
  );
}

/**
 * The answer, in one sentence, before any of the working.
 *
 * The denominator is the tanks that were CHECKED, and the tanks that could not
 * answer are counted separately rather than folded in as failures. "Fits none
 * of your 6 tanks" when four of them are unmeasured is a false negative
 * dressed as a result, and this app does not do that in either direction.
 */
function lede(verdicts: Verdict[]): string {
  const n = verdicts.length;
  const fits = verdicts.filter((v) => v === 'suitable').length;
  const conditional = verdicts.filter((v) => v === 'conditional').length;
  const unknown = verdicts.filter((v) => v === 'insufficient-data').length;
  const answerable = n - unknown;

  if (answerable === 0) {
    return `None of your ${n} tank${n === 1 ? '' : 's'} has enough recorded for this to be judged.`;
  }

  const head = fits > 0
    ? `Fits ${fits} of your ${answerable} answerable tank${answerable === 1 ? '' : 's'}.`
    : conditional > 0
      ? `Fits none outright; ${conditional} would work with care.`
      : `Fits none of your ${answerable} answerable tank${answerable === 1 ? '' : 's'}.`;

  const tail = unknown > 0
    ? ` ${unknown} tank${unknown === 1 ? '' : 's'} cannot answer yet.`
    : '';

  return head + tail;
}


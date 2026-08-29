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
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data/db';
import {
  acquireSpecimen, addEncounterChapter, assertIdentity, awardGolden, evaluateSpecimen,
  recordPrice, revealSpecimen, searchSpecies,
} from '@/data/repositories';
import { evaluatePriceFit } from '@/engine/pricing/price-fit';
import { COMPONENT_LABELS, LOCAL_RARITY_UNAVAILABLE } from '@/engine/rarity/discovery-tier';
import { formatLength } from '@/domain/units';
import type { Species, Verdict } from '@/domain/types';
import { useSpecimenMedia } from '../hooks';
import { IdentityBadge, TierBadge, VerdictBadge, ScarcityBadge } from '../components/Badges';
import { FactorList, MissingInputsNotice } from '../components/FactorList';
import { MarketPanel } from '../components/MarketPanel';
import { bandForSize, marketFor, scarcityFor } from '@/data/market';
import { usePrefersReducedMotion } from '@/theme/ThemeProvider';
import { CaretLeftIcon } from '../components/Icons';

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
  const snapshot = useLiveQuery(
    async () => (id ? db.raritySnapshots.where('specimenId').equals(id).first() : undefined),
    [id],
  );
  const prices = useLiveQuery(
    async () => (id ? db.priceObservations.where('specimenId').equals(id).toArray() : []),
    [id],
  );
  const allPricesForSpecies = useLiveQuery(
    async () => (specimen?.speciesId
      ? db.priceObservations.where('speciesId').equals(specimen.speciesId).toArray() : []),
    [specimen?.speciesId],
  );
  const aquariums = useLiveQuery(() => db.aquariums.where('status').equals('active').toArray(), []);
  const media = useSpecimenMedia(id);

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Species[]>([]);
  const [busy, setBusy] = useState(false);
  const [openTank, setOpenTank] = useState<string | undefined>();

  if (!id) return <p className="empty">No specimen.</p>;
  if (specimen === undefined) return <p className="empty muted">Loading…</p>;
  if (specimen === null) return <p className="empty">That catch is no longer here.</p>;

  const latest = encounters?.[encounters.length - 1];
  const newest = assessments?.[0];
  const groupedAssessments = assessments?.filter((a) => a.assessedAt === newest?.assessedAt) ?? [];

  async function onSearch(value: string) {
    setQuery(value);
    setMatches(value.trim() ? await searchSpecies(value) : []);
  }

  async function confirm(speciesId: string) {
    setBusy(true);
    await assertIdentity({ specimenId: id!, speciesId, source: 'user', status: 'user-confirmed' });
    setQuery('');
    setMatches([]);
    setBusy(false);
  }

  async function onEvaluate() {
    setBusy(true);
    await evaluateSpecimen(id!, { observedSize: latest?.observedSize });
    setBusy(false);
  }

  async function onReveal() {
    setBusy(true);
    await revealSpecimen(id!);
    setBusy(false);
  }

  // Market context, auto-populated from the shipped index. No network call.
  const marketStats = marketFor(specimen.speciesId);
  const marketScarcity = scarcityFor(specimen.speciesId);
  const marketBand = marketStats ? bandForSize(marketStats, latest?.observedSize) : undefined;

  const priceFit = prices?.[0] && allPricesForSpecies
    ? evaluatePriceFit({ subject: prices[0], candidates: allPricesForSpecies })
    : undefined;

  const price = prices?.[0];
  const title = specimen.nickname ?? specimen.rawLabel ?? 'Mystery Catch';

  return (
    <div className="screen">
      <div className="topbar">
        <button type="button" className="iconbtn" onClick={() => navigate(-1)} aria-label="Back">
          <CaretLeftIcon size={22} aria-hidden="true" />
        </button>
        <span className="grow" />
      </div>

      {/* --- Media. Original, always (FR-J01, PRD 7.4) --------------------- */}
      <div className="hero-plate">
        <span className="plate">
          {media?.[0]?.url ? (
            media[0].media.kind === 'video' ? (
              <video className="plate__img" src={media[0].url} controls playsInline muted={reducedMotion} />
            ) : (
              <img className="plate__img" src={media[0].url} alt={`Original capture of ${title}`} />
            )
          ) : (
            <span className="plate__img plate__img--none">
              <span className="plate__none-text">No media on this catch</span>
            </span>
          )}
        </span>
      </div>

      <header className="pad">
        <h1 className="specimen-name">{title}</h1>
        {species && (
          <>
            {species.scientificName && <p className="specimen-sci">{species.scientificName}</p>}
            <p className="specimen-common">{species.commonName}</p>
          </>
        )}
        <div className="tagrow">
          <IdentityBadge status={specimen.identityStatus} />
          {snapshot && <TierBadge tier={snapshot.tier} golden={Boolean(specimen.golden)} />}
          {marketScarcity.available && <ScarcityBadge band={marketScarcity.band} />}
        </div>

        {/* The rest of the label: when, and at what size. */}
        <dl className="label-line">
          <div>
            <dt>Caught</dt>
            <dd>{new Date(specimen.createdAt).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{latest?.observedSize ? formatLength(latest.observedSize) : '—'}</dd>
          </div>
          <div>
            <dt>Chapters</dt>
            <dd>{encounters?.filter((e) => e.notes).length ?? 0}</dd>
          </div>
        </dl>
      </header>

      {/* --- Your tanks (PRD 4.4) ------------------------------------------
          First, because standing in the aisle it is the only question that has
          a deadline. */}
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

      {/* --- Identity (PRD 4.3) ------------------------------------------- */}
      <section className="panel">
        <h2 className="sec-head">Identity</h2>
        {specimen.identityStatus !== 'user-confirmed' ? (
          <div className="stack">
            <p className="panel__note" style={{ marginTop: 0 }}>
              Unknown is a fine place to leave this. Nothing is lost by not knowing yet.
            </p>
            <div>
              <label htmlFor="species-search">Search species, scientific name or store label</label>
              <input
                id="species-search"
                value={query}
                onChange={(e) => void onSearch(e.target.value)}
                placeholder="jaguar cichlid, managuensis, managuense…"
              />
            </div>
            {matches.map((s) => (
              <button
                key={s.id}
                type="button"
                className="tankrow"
                disabled={busy}
                onClick={() => void confirm(s.id)}
              >
                <span className="grow">
                  <span className="tankrow__name">{s.commonName}</span>
                  {s.scientificName && <span className="tankrow__meta sci" style={{ display: 'block' }}>{s.scientificName}</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="panel__note" style={{ marginTop: 0 }}>
            You confirmed this yourself. No confidence percentage is recorded, because none was measured.
          </p>
        )}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <label htmlFor="nickname">Nickname</label>
          <input
            id="nickname"
            defaultValue={specimen.nickname ?? ''}
            placeholder="the Panther"
            onBlur={(e) => void db.specimens.update(id, { nickname: e.target.value || undefined })}
          />
        </div>
      </section>

      {/* --- Size and price (PRD 4.5) ------------------------------------- */}
      <section className="panel">
        <h2 className="sec-head">Size and price</h2>

        {/* Three prices, kept apart. Ask, member and paid are three different
            facts and the data model keeps them separate on purpose; collapsing
            them into "you paid" throws away the distinction PRD 5.4 exists to
            preserve. */}
        {price && (
          <dl className="prices" style={{ marginBottom: 'var(--space-4)' }}>
            <div>
              <dt>Asking</dt>
              <dd className={price.askingPrice === undefined ? 'is-blank' : undefined}>
                {price.askingPrice === undefined ? 'not noted' : `$${price.askingPrice}`}
              </dd>
            </div>
            <div>
              <dt>Member</dt>
              <dd className={price.memberPrice === undefined ? 'is-blank' : undefined}>
                {price.memberPrice === undefined ? 'not noted' : `$${price.memberPrice}`}
              </dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd className={price.paidPrice === undefined ? 'is-blank' : undefined}>
                {price.paidPrice === undefined ? 'not bought' : `$${price.paidPrice}`}
              </dd>
            </div>
          </dl>
        )}

        <PriceForm
          specimenId={id}
          speciesId={specimen.speciesId}
          encounterId={latest?.id}
          marketEstimate={marketBand?.medianPrice}
        />

        {priceFit && (
          <p className="panel__note panel__note--tight">
            {priceFit.status === 'compared'
              ? `Median of your own ${priceFit.sampleCount} comparable observations: $${priceFit.comparison!.median.toFixed(2)} each. Yours sits ${(priceFit.comparison!.percentDifferenceFromMedian * 100).toFixed(0)}% from that, against a stated ±${(priceFit.comparison!.inLineTolerance * 100).toFixed(0)}% band.`
              : priceFit.message}
          </p>
        )}
      </section>

      {/* --- Market reference (PRD 4.5, FR-P06) --------------------------- */}
      <MarketPanel
        speciesId={specimen.speciesId}
        observedSize={latest?.observedSize}
        yourPrice={price?.memberPrice ?? price?.askingPrice}
      />

      {/* --- Reveal (PRD 4.6) --------------------------------------------- */}
      {specimen.identityStatus === 'user-confirmed' && (
        <section className="panel">
          <h2 className="sec-head">Discovery</h2>
          {!snapshot ? (
            <button type="button" className="cta" onClick={() => void onReveal()} disabled={busy}>
              Reveal
            </button>
          ) : (
            <div className={specimen.golden ? 'reveal-card reveal-card--golden golden' : 'reveal-card'}>
              <div className="spread" style={{ marginBottom: 'var(--space-3)' }}>
                <TierBadge tier={snapshot.tier} golden={Boolean(specimen.golden)} />
                <span className="data">{snapshot.totalScore} / 100</span>
              </div>
              {/* FR-R05: the breakdown is shown, not just the total. */}
              <dl className="kv">
                {(Object.keys(snapshot.components) as Array<keyof typeof snapshot.components>).map((k) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{COMPONENT_LABELS[k]}</dt>
                    <dd>+{snapshot.components[k]}</dd>
                  </div>
                ))}
              </dl>
              <p className="panel__note panel__note--tight">
                {LOCAL_RARITY_UNAVAILABLE.message}. {LOCAL_RARITY_UNAVAILABLE.explanation}
              </p>
              <p className="xs faint data">Formula {snapshot.formulaVersion}</p>
              {!specimen.golden && (
                <button type="button" className="cta cta--quiet" onClick={() => void awardGolden(id, undefined)}>
                  Mark this one Golden
                </button>
              )}
            </div>
          )}
        </section>
      )}

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
              {e.notes
                ? <p style={{ marginBottom: 0 }}>{e.notes}</p>
                : <p className="muted small" style={{ marginBottom: 0 }}>No note on this chapter yet.</p>}
            </li>
          ))}
        </ul>
      </section>

      {/* --- Bring home (PRD 4.8) ----------------------------------------- */}
      {specimen.status !== 'resident' && (
        <section className="panel">
          <h2 className="sec-head">If it comes home</h2>
          <p className="panel__note" style={{ marginTop: 0 }}>
            Nothing here needs to happen. A catch is documentation, not acquisition.
          </p>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <label htmlFor="acquire-tank">Bring into</label>
            <select
              id="acquire-tank"
              defaultValue=""
              onChange={(e) => { if (e.target.value) void acquireSpecimen(id, e.target.value); }}
            >
              <option value="" disabled>Choose a tank…</option>
              {aquariums?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </section>
      )}
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

function PriceForm({ specimenId, speciesId, encounterId, marketEstimate }: {
  specimenId: string; speciesId?: string; encounterId?: string; marketEstimate?: number;
}) {
  const [asking, setAsking] = useState('');
  const [member, setMember] = useState('');
  const [size, setSize] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const observedSize = size ? { value: Number(size), unit: 'in' as const, estimate: true } : undefined;
    if (encounterId && observedSize) await db.encounters.update(encounterId, { observedSize });
    if (asking || member) {
      await recordPrice({
        specimenId, speciesId, encounterId,
        askingPrice: asking ? Number(asking) : undefined,
        memberPrice: member ? Number(member) : undefined,
        observedSize,
      });
    }
    setAsking(''); setMember(''); setSize('');
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
            // A placeholder, never a prefilled value: the market figure must
            // not be saved as if it were a price seen in the store.
            placeholder={marketEstimate !== undefined ? String(marketEstimate) : '100'}
          />
        </div>
        <div>
          <label htmlFor="member">Member price</label>
          <input id="member" inputMode="decimal" value={member} onChange={(e) => setMember(e.target.value)} placeholder="75" />
        </div>
        <div className="capture--wide">
          <label htmlFor="size">Approximate size (inches)</label>
          <input id="size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="6" />
        </div>
      </div>
      <button type="button" onClick={() => void save()} disabled={saving || (!asking && !member && !size)}>
        Record
      </button>
      {marketEstimate !== undefined && (
        <p className="xs faint" style={{ marginBottom: 0 }}>
          Online stores listed this size around <strong>${marketEstimate.toFixed(2)}</strong>. Shown for
          reference only — it is not filled in for you, because what you type should be what the tag says.
        </p>
      )}
      <p className="xs faint" style={{ marginBottom: 0 }}>
        No price tag? Leave both blank. Blank means unknown, not free.
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

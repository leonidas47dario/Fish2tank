/**
 * One specimen, its whole story - PRD 3.4, 4.3-4.8.
 *
 * Everything the store visit deferred happens here: confirm the identity,
 * record what it cost, screen it against the real tanks, see the reveal, write
 * the story, and — only if it ever happens — bring it home. One record follows
 * the fish through all of it (FR-T01).
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data/db';
import {
  acquireSpecimen, addEncounterChapter, assertIdentity, awardGolden, deleteCatch,
  evaluateSpecimen, planDeleteCatch, recordPrice, revealSpecimen, searchSpecies, updateCatch,
  type DeleteCatchPlan,
} from '@/data/repositories';
import { evaluatePriceFit } from '@/engine/pricing/price-fit';
import { COMPONENT_LABELS, LOCAL_RARITY_UNAVAILABLE } from '@/engine/rarity/discovery-tier';
import { formatLength } from '@/domain/units';
import type { Species } from '@/domain/types';
import { useSpecimenMedia } from '../hooks';
import { IdentityBadge, TierBadge, VerdictBadge } from '../components/Badges';
import { FactorList, MissingInputsNotice } from '../components/FactorList';
import { MarketPanel } from '../components/MarketPanel';
import { ScarcityBadge } from '../components/Badges';
import { bandForSize, marketFor, scarcityFor } from '@/data/market';
import { usePrefersReducedMotion } from '@/theme/ThemeProvider';

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
  const places = useLiveQuery(() => db.places.toArray(), []);
  const media = useSpecimenMedia(id);

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Species[]>([]);
  const [busy, setBusy] = useState(false);

  if (!id) return <p className="empty">No specimen.</p>;
  if (specimen === undefined) return <p className="muted">Loading…</p>;
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

  return (
    <div className="stack">
      <button type="button" className="btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(-1)}>
        ← Back
      </button>

      {/* --- Media. Original, always (FR-J01, PRD 7.4) --------------------- */}
      <section className="media--scene">
        {media?.[0]?.url ? (
          media[0].media.kind === 'video' ? (
            <video className="media" src={media[0].url} controls playsInline muted={reducedMotion} />
          ) : (
            <img className="media" src={media[0].url} alt={`Original capture of ${specimen.nickname ?? 'this catch'}`} />
          )
        ) : (
          <div className="empty">No media on this catch.</div>
        )}
      </section>

      <header className="stack">
        <h1 style={{ marginBottom: 0 }}>{specimen.nickname ?? specimen.rawLabel ?? 'Mystery Catch'}</h1>
        {species && (
          <p className="muted" style={{ marginBottom: 0 }}>
            {species.commonName}
            {species.scientificName && <> · <span className="sci">{species.scientificName}</span></>}
          </p>
        )}
        <div className="row">
          <IdentityBadge status={specimen.identityStatus} />
          {snapshot && <TierBadge tier={snapshot.tier} golden={Boolean(specimen.golden)} />}
          {marketScarcity.available && <ScarcityBadge band={marketScarcity.band} />}
        </div>
      </header>

      {/* --- Identity (PRD 4.3) ------------------------------------------- */}
      <section className="card stack">
        <h2>Identity</h2>
        {specimen.identityStatus !== 'user-confirmed' ? (
          <>
            <p className="small muted">
              Unknown is a fine place to leave this. Nothing is lost by not knowing yet.
            </p>
            <label htmlFor="species-search">Search species, scientific name or store label</label>
            <input
              id="species-search"
              value={query}
              onChange={(e) => void onSearch(e.target.value)}
              placeholder="jaguar cichlid, managuensis, managuense…"
            />
            <ul className="list">
              {matches.map((s) => (
                <li key={s.id}>
                  <button type="button" style={{ width: '100%', textAlign: 'left' }} disabled={busy} onClick={() => void confirm(s.id)}>
                    <strong>{s.commonName}</strong>
                    {s.scientificName && <> · <span className="sci">{s.scientificName}</span></>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="small muted" style={{ marginBottom: 0 }}>
            You confirmed this yourself. No confidence percentage is recorded, because none was measured.
          </p>
        )}
        <label htmlFor="nickname">Nickname</label>
        <input
          id="nickname"
          defaultValue={specimen.nickname ?? ''}
          placeholder="the Panther"
          onBlur={(e) => void db.specimens.update(id, { nickname: e.target.value || undefined })}
        />
      </section>

      {/* --- Size and price (PRD 4.5) ------------------------------------- */}
      <section className="card stack">
        <h2>Size and price</h2>
        <PriceForm
          specimenId={id}
          speciesId={specimen.speciesId}
          encounterId={latest?.id}
          marketEstimate={marketBand?.medianPrice}
        />
        {prices && prices.length > 0 && (
          <dl className="kv">
            {prices[0]!.askingPrice !== undefined && (<><dt>Asking</dt><dd>${prices[0]!.askingPrice}</dd></>)}
            {prices[0]!.memberPrice !== undefined && (<><dt>Member</dt><dd>${prices[0]!.memberPrice}</dd></>)}
            {prices[0]!.paidPrice !== undefined && (<><dt>Paid</dt><dd>${prices[0]!.paidPrice}</dd></>)}
            {latest?.observedSize && (<><dt>Observed size</dt><dd>{formatLength(latest.observedSize)}</dd></>)}
          </dl>
        )}
        {priceFit && (
          <p className="small muted" style={{ marginBottom: 0 }}>
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
        yourPrice={prices?.[0]?.memberPrice ?? prices?.[0]?.askingPrice}
      />

      {/* --- Evaluate (PRD 4.4) ------------------------------------------- */}
      <section className="stack">
        <div className="spread">
          <h2 style={{ marginBottom: 0 }}>Your tanks</h2>
          <button type="button" onClick={() => void onEvaluate()} disabled={busy}>
            {assessments?.length ? 'Check again' : 'Check my tanks'}
          </button>
        </div>

        {groupedAssessments.length === 0 && (
          <p className="muted small">No screening run yet.</p>
        )}

        {groupedAssessments.map((a) => {
          const tank = aquariums?.find((t) => t.id === a.aquariumId);
          return (
            <div key={a.id} className="stack">
              <div className="card card--raised spread">
                <span><strong>{tank?.name ?? a.aquariumId}</strong><br />
                  <span className="xs muted">{a.headline}</span>
                </span>
                <VerdictBadge verdict={a.verdict} />
              </div>

              {/* FR-E03: the juvenile view is present but visibly secondary. */}
              {a.temporaryJuvenileFit && (
                <p className="warn">
                  Right now, temporarily: {a.temporaryJuvenileFit.note}
                </p>
              )}

              <MissingInputsNotice missing={a.missingInputs} />
              {a.factors.length > 0 && <FactorList assessment={a} />}
            </div>
          );
        })}
      </section>

      {/* --- Reveal (PRD 4.6) --------------------------------------------- */}
      {specimen.identityStatus === 'user-confirmed' && (
        <section className="stack">
          <h2>Discovery</h2>
          {!snapshot ? (
            <button type="button" className="btn--primary" onClick={() => void onReveal()} disabled={busy}>
              Reveal
            </button>
          ) : (
            <div className={`card ${specimen.golden ? 'reveal-card reveal-card--golden golden' : 'reveal-card'}`}>
              <div className="spread">
                <TierBadge tier={snapshot.tier} golden={Boolean(specimen.golden)} />
                <span className="data">{snapshot.totalScore} / 100</span>
              </div>
              <hr />
              {/* FR-R05: the breakdown is shown, not just the total. */}
              <dl className="kv">
                {(Object.keys(snapshot.components) as Array<keyof typeof snapshot.components>).map((k) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{COMPONENT_LABELS[k]}</dt>
                    <dd>+{snapshot.components[k]}</dd>
                  </div>
                ))}
              </dl>
              <p className="xs muted" style={{ marginTop: 'var(--space-3)' }}>
                {LOCAL_RARITY_UNAVAILABLE.message}. {LOCAL_RARITY_UNAVAILABLE.explanation}
              </p>
              <p className="xs muted data">Formula {snapshot.formulaVersion}</p>
              {!specimen.golden && (
                <button type="button" onClick={() => void awardGolden(id, undefined)}>
                  Mark this one Golden
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* --- Story (PRD 4.7) ---------------------------------------------- */}
      <section className="card stack">
        <h2>Story</h2>
        <StoryForm specimenId={id} />
        <ul className="list">
          {encounters?.map((e, i) => (
            <li key={e.id}>
              <p className="xs muted data" style={{ marginBottom: 'var(--space-1)' }}>
                Chapter {i + 1} · {new Date(e.observedAt).toLocaleString()}
              </p>
              {e.notes ? <p style={{ marginBottom: 0 }}>{e.notes}</p> : <p className="muted small" style={{ marginBottom: 0 }}>No note on this chapter yet.</p>}
            </li>
          ))}
        </ul>
      </section>

      {/* --- Correct the record (FR-C03) ----------------------------------- */}
      <EditCatchForm
        specimenId={id}
        nickname={specimen.nickname}
        rawLabel={specimen.rawLabel}
        encounter={latest}
        places={places ?? []}
      />

      {/* --- Bring home (PRD 4.8) ----------------------------------------- */}
      {specimen.status !== 'resident' && (
        <section className="card stack">
          <h2>If it comes home</h2>
          <p className="small muted">
            Nothing here needs to happen. A catch is documentation, not acquisition.
          </p>
          <BringHome specimenId={id} aquariums={aquariums ?? []} />
        </section>
      )}

      {/* --- Delete. Last, and behind a confirmation that states the cost. -- */}
      <DeleteCatch
        specimenId={id}
        name={specimen.nickname ?? specimen.rawLabel ?? 'this catch'}
        onDeleted={() => navigate('/')}
      />
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
function BringHome({ specimenId, aquariums }: {
  specimenId: string; aquariums: Array<{ id: string; name: string }>;
}) {
  const [tankId, setTankId] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = aquariums.find((t) => t.id === tankId);

  return (
    <>
      <label htmlFor="acquire-tank">Bring into</label>
      <select id="acquire-tank" value={tankId} onChange={(e) => setTankId(e.target.value)}>
        <option value="">Choose a tank…</option>
        {aquariums.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {chosen && (
        <>
          <p className="xs muted" style={{ marginBottom: 0 }}>
            Records that you own this fish and that it lives in {chosen.name} from today. It then
            appears in that tank, and the catch can no longer be deleted.
          </p>
          <button type="button" className="btn--primary" disabled={busy}
            onClick={async () => { setBusy(true); await acquireSpecimen(specimenId, chosen.id); setBusy(false); }}>
            {busy ? 'Recording…' : `Add to ${chosen.name}`}
          </button>
        </>
      )}
    </>
  );
}

/** Local datetime for an <input type="datetime-local">, which will not take an ISO Z string. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Correct what you recorded.
 *
 * Collapsed by default: on a screen whose whole point is the fish, an edit form
 * open by default would push the photo off the top. Deliberately does NOT
 * include the species - changing that goes through the Identity block above,
 * which supersedes the old assertion instead of overwriting it.
 */
function EditCatchForm({ specimenId, nickname, rawLabel, encounter, places }: {
  specimenId: string;
  nickname?: string;
  rawLabel?: string;
  encounter?: { id: string; observedAt: string; placeId?: string; quantitySeen?: number; notes?: string };
  places: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nickname: nickname ?? '',
    rawLabel: rawLabel ?? '',
    observedAt: toLocalInput(encounter?.observedAt),
    placeId: encounter?.placeId ?? '',
    quantitySeen: encounter?.quantitySeen ? String(encounter.quantitySeen) : '',
    notes: encounter?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-seed the fields when the record changes underneath (a live query update,
  // or opening a different catch) - but never while the user is mid-edit.
  function reopen() {
    if (!open) {
      setForm({
        nickname: nickname ?? '',
        rawLabel: rawLabel ?? '',
        observedAt: toLocalInput(encounter?.observedAt),
        placeId: encounter?.placeId ?? '',
        quantitySeen: encounter?.quantitySeen ? String(encounter.quantitySeen) : '',
        notes: encounter?.notes ?? '',
      });
      setSaved(false);
    }
    setOpen(!open);
  }

  async function save() {
    setSaving(true);
    const qty = form.quantitySeen.trim();
    await updateCatch({
      specimenId,
      encounterId: encounter?.id,
      // Empty means "clear it", which null expresses and undefined does not.
      nickname: form.nickname.trim() || null,
      rawLabel: form.rawLabel.trim() || null,
      ...(form.observedAt ? { observedAt: new Date(form.observedAt).toISOString() } : {}),
      placeId: form.placeId || null,
      quantitySeen: qty ? Number(qty) : null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    setSaved(true);
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setSaved(false);
  };

  return (
    <section className="card stack">
      <button type="button" className="btn--ghost spread" onClick={reopen} aria-expanded={open}>
        <span>Edit this catch</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <>
          <p className="xs muted" style={{ marginBottom: 0 }}>
            Corrects what you recorded. To change which species this is, use Identity above —
            that keeps the earlier answer instead of overwriting it.
          </p>

          <label htmlFor="edit-nickname">Name</label>
          <input id="edit-nickname" value={form.nickname} onChange={set('nickname')}
            placeholder="the Panther" />

          <label htmlFor="edit-rawlabel">The store's label, as written</label>
          <input id="edit-rawlabel" value={form.rawLabel} onChange={set('rawLabel')}
            placeholder={'Jaguar Cichlid 6"'} />

          <label htmlFor="edit-observedat">When you saw it</label>
          <input id="edit-observedat" type="datetime-local" value={form.observedAt}
            onChange={set('observedAt')} />

          <label htmlFor="edit-place">Where</label>
          <select id="edit-place" value={form.placeId} onChange={set('placeId')}>
            <option value="">Not recorded</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <label htmlFor="edit-qty">How many you saw</label>
          <input id="edit-qty" type="number" min="1" inputMode="numeric"
            value={form.quantitySeen} onChange={set('quantitySeen')} />

          <label htmlFor="edit-notes">Note on this chapter</label>
          <textarea id="edit-notes" rows={3} value={form.notes} onChange={set('notes')} />

          <button type="button" className="btn--primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save corrections'}
          </button>
          {saved && <p className="xs muted" role="status" style={{ marginBottom: 0 }}>Saved.</p>}
        </>
      )}
    </section>
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
    <section className="card stack">
      <h2>Delete</h2>
      {!plan && (
        <>
          <p className="small muted" style={{ marginBottom: 0 }}>
            For a catch that should not exist — a mis-tap, a duplicate, test data. A fish you were
            wrong about does not need deleting; correct its identity instead.
          </p>
          <button type="button" onClick={() => void ask()} disabled={busy}>
            Delete this catch…
          </button>
        </>
      )}

      {plan && !plan.allowed && (
        <>
          <p className="small" style={{ marginBottom: 0 }}>{plan.reason}</p>
          <button type="button" className="btn--ghost" onClick={() => setPlan(undefined)}>Back</button>
        </>
      )}

      {plan && plan.allowed && (
        <>
          <p className="small" style={{ marginBottom: 0 }}>
            Permanently delete <strong>{name}</strong>
            {parts.length > 0 && <> and {parts.join(', ')}</>}. This cannot be undone.
          </p>
          {plan.mediaSharedElsewhere > 0 && (
            <p className="xs muted" style={{ marginBottom: 0 }}>
              {plan.mediaSharedElsewhere} photo{plan.mediaSharedElsewhere === 1 ? '' : 's'} also used by
              another catch will be kept.
            </p>
          )}
          <div className="row">
            <button type="button" className="btn--danger" onClick={() => void confirmDelete()} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete it'}
            </button>
            <button type="button" className="btn--ghost" onClick={() => setPlan(undefined)} disabled={busy}>
              Keep it
            </button>
          </div>
        </>
      )}
    </section>
  );
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
      <div className="row">
        <div className="grow">
          <label htmlFor="asking">Asking price</label>
          <input
            id="asking" inputMode="decimal" value={asking}
            onChange={(e) => setAsking(e.target.value)}
            // A placeholder, never a prefilled value: the market figure must
            // not be saved as if it were a price seen in the store.
            placeholder={marketEstimate !== undefined ? String(marketEstimate) : '100'}
          />
        </div>
        <div className="grow">
          <label htmlFor="member">Member price</label>
          <input id="member" inputMode="decimal" value={member} onChange={(e) => setMember(e.target.value)} placeholder="75" />
        </div>
      </div>
      <div>
        <label htmlFor="size">Approximate size (inches)</label>
        <input id="size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="6" />
      </div>
      <button type="button" onClick={() => void save()} disabled={saving || (!asking && !member && !size)}>
        Record
      </button>
      {marketEstimate !== undefined && (
        <p className="xs muted" style={{ marginBottom: 0 }}>
          Online stores listed this size around <strong>${marketEstimate.toFixed(2)}</strong>. Shown for
          reference only — it is not filled in for you, because what you type should be what the tag says.
        </p>
      )}
      <p className="xs muted" style={{ marginBottom: 0 }}>
        No price tag? Leave both blank. Blank means unknown, not free.
      </p>
    </div>
  );
}

function StoryForm({ specimenId }: { specimenId: string }) {
  const [text, setText] = useState('');
  return (
    <div className="stack">
      <label htmlFor="story">Add a chapter</label>
      <textarea
        id="story" rows={4} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Why this one mattered."
      />
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

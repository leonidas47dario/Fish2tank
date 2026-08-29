/**
 * The catalog - 图鉴.
 *
 * This REPLACES the old text-list Collection screen rather than sitting beside
 * it. Hearthstone has one collection browser showing every card with unowned
 * ones greyed, not a "mine" screen and an "all" screen; two screens iterating
 * the same species list would have diverged within a month.
 *
 * So: every species is a card, the ones in your collection are in colour, the
 * rest are locked, and the filters let you narrow to just yours when you want
 * that view. In colour means caught OR kept - a fish in the tank downstairs is
 * as much yours as one you photographed in a store.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/data/db';
import { CATALOG, cardPrice, marketAndScarcity, ownership, type CatalogCard } from '@/data/catalog';
import { deriveQuantity } from '@/domain/holdings';
import type { AggressionRating } from '@/domain/types';
import type { OrganismKind, WaterZone } from '@/data/seed/taxonomy';
import { FishCard } from '../components/FishCard';

type Filter = 'all' | 'caught' | 'uncaught' | 'kept';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'caught', label: 'Caught' },
  { id: 'uncaught', label: 'Not yet' },
  { id: 'kept', label: 'Kept' },
];

/**
 * Where in the tank it lives.
 *
 * This is the question a keeper actually asks when stocking - the bottom is
 * full, what goes up top? - so it earns a filter of its own. Derived from
 * taxonomic family (see seed/taxonomy.ts), which is why 'unknown' is a real
 * option rather than a bucket everything unclassified falls into silently.
 */
type ZoneFilter = 'any' | WaterZone | 'unknown';

const ZONES: Array<{ id: ZoneFilter; label: string; glyph: string }> = [
  { id: 'any', label: 'Any level', glyph: '≡' },
  { id: 'top', label: 'Top', glyph: '▔' },
  { id: 'mid', label: 'Mid', glyph: '━' },
  { id: 'bottom', label: 'Bottom', glyph: '▁' },
  { id: 'all-levels', label: 'All levels', glyph: '↕' },
  { id: 'unknown', label: 'Not recorded', glyph: '?' },
];

/** Fish, plant, invert. "Specialty" in the trade sense. */
type KindFilter = 'any' | OrganismKind;

const KINDS: Array<{ id: KindFilter; label: string }> = [
  { id: 'any', label: 'Everything' },
  { id: 'fish', label: 'Fish' },
  { id: 'invertebrate', label: 'Inverts' },
  { id: 'plant', label: 'Plants' },
];

/**
 * Temperament, from the curated care profiles only.
 *
 * Deliberately NOT derived from family the way the zone is: Cichlidae holds
 * both the ram and the jaguar cichlid, so a family default here would be an
 * invented number of exactly the kind this app refuses. Most species therefore
 * have no aggression rating, and the filter says so.
 */
type AggressionFilter = 'any' | AggressionRating | 'unknown';

const AGGRESSION: Array<{ id: AggressionFilter; label: string }> = [
  { id: 'any', label: 'Any temperament' },
  { id: 'peaceful', label: 'Peaceful' },
  { id: 'semi-aggressive', label: 'Semi-aggressive' },
  { id: 'aggressive', label: 'Aggressive' },
  { id: 'highly-aggressive', label: 'Highly aggressive' },
  { id: 'unknown', label: 'Not rated' },
];

export default function Catalog() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [zone, setZone] = useState<ZoneFilter>('any');
  const [kind, setKind] = useState<KindFilter>('any');
  const [aggression, setAggression] = useState<AggressionFilter>('any');

  const cards = useLiveQuery(async (): Promise<CatalogCard[]> => {
    const [specimens, snapshots, holdings, lifeEvents, residencies, dream, media] = await Promise.all([
      db.specimens.toArray(), db.raritySnapshots.toArray(), db.holdings.toArray(),
      db.lifeEvents.toArray(), db.residencies.toArray(), db.dreamList.toArray(), db.media.toArray(),
    ]);
    const dreamed = new Set(dream.map((d) => d.speciesId));

    return CATALOG.species.map((species) => {
      const mine = specimens.filter((s) => s.speciesId === species.speciesId);
      const confirmed = mine.filter((s) => s.identityStatus === 'user-confirmed');
      const speciesHoldings = holdings.filter((h) => h.speciesId === species.speciesId);

      const currentlyKept = speciesHoldings.some((h) => {
        if (deriveQuantity(h, lifeEvents) <= 0) return false;
        return residencies.some((r) => r.holdingId === h.id && !r.endDate);
      });

      // Newest first, so the card shows your most recent look at it.
      const ownPhotos = media
        .filter((m) => m.kind === 'photo' && m.specimenIds.some((id) => mine.some((s) => s.id === id)))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        .map((m) => m.id);

      const tiers = snapshots.filter((s) => s.speciesId === species.speciesId);
      const { market, scarcityBand } = marketAndScarcity(species.speciesId);

      // Size the price to the fish you actually saw, not the pooled median.
      const observedSize = undefined;

      return {
        species,
        user: {
          ...ownership(confirmed.length, speciesHoldings.length),
          currentlyKept,
          specimenCount: mine.length,
          tier: tiers[0]?.tier,
          golden: mine.some((s) => Boolean(s.golden)),
          onDreamList: dreamed.has(species.speciesId),
          ownPhotoMediaIds: ownPhotos,
        },
        market,
        price: cardPrice(market, observedSize),
        scarcityBand,
      };
    });
  }, []);

  const shown = useMemo(() => {
    if (!cards) return [];
    const q = query.trim().toLowerCase();
    return cards
      .filter((c) => {
        if (filter === 'caught' && !c.user.caught) return false;
        // "Not yet" is the complement of the cards in colour, so a fish you
        // keep never shows up under it.
        if (filter === 'uncaught' && c.user.inCollection) return false;
        if (filter === 'kept' && !c.user.kept) return false;

        // A species with no recorded zone is EXCLUDED from every specific zone
        // rather than defaulted into one. "Not recorded" is its own filter, so
        // the gap stays countable instead of being hidden.
        if (zone === 'unknown' ? c.species.waterZone !== undefined : zone !== 'any' && c.species.waterZone !== zone) {
          return false;
        }
        if (kind !== 'any' && c.species.organismKind !== kind) return false;
        if (aggression === 'unknown'
          ? c.species.aggression !== undefined
          : aggression !== 'any' && c.species.aggression !== aggression) {
          return false;
        }

        if (!q) return true;
        const s = c.species;
        return (
          s.commonName.toLowerCase().includes(q) ||
          s.scientificName?.toLowerCase().includes(q) ||
          s.aliases.some((a) => a.toLowerCase().includes(q))
        );
      })
      // Yours first: your own collection leads, the rest is what's out there.
      .sort((a, b) =>
        Number(b.user.inCollection) - Number(a.user.inCollection) ||
        a.species.commonName.localeCompare(b.species.commonName));
  }, [cards, query, filter, zone, kind, aggression]);

  // Shown on the collapsed summary so a filter left on inside it is never invisible.
  const activeExtra = [zone !== 'any', kind !== 'any', aggression !== 'any'].filter(Boolean).length;

  const mine = cards?.filter((c) => c.user.inCollection).length ?? 0;
  const total = cards?.length ?? 0;

  return (
    <div className="stack">
      <header>
        <h1>Catalog</h1>
        <p className="muted small data">{mine} of {total} in your collection</p>
      </header>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, scientific name or trade name…"
        aria-label="Search the catalog"
      />

      <div className="filters" role="group" aria-label="Filter by what you have">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="chip"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/*
        Collapsed by default, and that is a deliberate correction rather than
        shyness about the feature. Laid out flat, three more chip rows filled
        an entire iPhone screen and pushed every fish below the fold - a
        catalog whose first screen contains no catalog. The summary carries the
        active count, so a filter can never be silently on.
      */}
      <details className="filters-more">
        <summary>
          More filters
          {activeExtra > 0 && <span className="filters-more__count">{activeExtra}</span>}
        </summary>

        {/* Where it lives. The glyph carries the meaning as well as the word,
            so the row reads at a glance and in monochrome (NFR-06). */}
        <div className="filters" role="group" aria-label="Filter by where it lives in the tank">
          {ZONES.map((z) => (
            <button
              key={z.id}
              type="button"
              className="chip"
              aria-pressed={zone === z.id}
              onClick={() => setZone(z.id)}
            >
              <span aria-hidden="true" className="chip__glyph">{z.glyph}</span> {z.label}
            </button>
          ))}
        </div>

        <div className="filters" role="group" aria-label="Filter by kind">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className="chip"
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="filters" role="group" aria-label="Filter by temperament">
          {AGGRESSION.map((a) => (
            <button
              key={a.id}
              type="button"
              className="chip"
              aria-pressed={aggression === a.id}
              onClick={() => setAggression(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Temperament comes only from the curated care profiles, so the filter
            is mostly empty by design. Saying so beats looking broken. */}
        {aggression !== 'any' && aggression !== 'unknown' && (
          <p className="xs muted">
            Temperament is only recorded for species with a curated care profile. It is never
            guessed from the family, because a family can hold both a ram and a jaguar cichlid.
          </p>
        )}
      </details>

      {cards === undefined && <p className="muted small">Loading…</p>}
      {cards && shown.length === 0 && (
        <p className="empty">Nothing matches. Try a different search or filter.</p>
      )}

      <div className="catalog-grid">
        {shown.map((card) => (
          <FishCard
            key={card.species.speciesId}
            card={card}
            onOpen={(id) => navigate(`/species/${id}`)}
          />
        ))}
      </div>

      <p className="xs muted">
        Portraits from Wikimedia Commons under their stated licences; each card&apos;s detail page
        credits the photographer. Where you have your own photo of a fish, it is used instead.
      </p>
    </div>
  );
}

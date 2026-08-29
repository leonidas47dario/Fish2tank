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
import { FishCard } from '../components/FishCard';

type Filter = 'all' | 'caught' | 'uncaught' | 'kept';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'caught', label: 'Caught' },
  { id: 'uncaught', label: 'Not yet' },
  { id: 'kept', label: 'Kept' },
];

export default function Catalog() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

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
  }, [cards, query, filter]);

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

      <div className="filters">
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

/**
 * The catalog - 图鉴.
 *
 * This REPLACES the old text-list Collection screen rather than sitting beside
 * it. Hearthstone has one collection browser showing every card with unowned
 * ones greyed, not a "mine" screen and an "all" screen; two screens iterating
 * the same species list would have diverged within a month.
 *
 * So: every species is a tile, the ones in your collection are in colour, the
 * rest are desaturated, and the filters let you narrow to just yours when you
 * want that view. In colour means caught OR kept - a fish in the tank
 * downstairs is as much yours as one you photographed in a store.
 *
 * Three things changed in the redesign, all of them measured:
 *
 *   - Two up, not one. One tile per row made the rendered page 583,302px
 *     tall, about 700 phone screens.
 *   - The tiles window themselves. 2,178 species is 1,089 rows, and every one
 *     of them used to be laid out, styled and painted on first render.
 *   - The default order is no longer alphabetical. Alphabetical opens the
 *     library on the African Clawed Frog and fills the first screen with
 *     species that have no portrait and no care data - the app at its least
 *     able to say anything.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import {
  CATALOG, cardPrice, marketAndScarcity, ownership, portraitAsset, pricesBySpecies,
  type CatalogCard,
} from '@/data/catalog';
import { MARKET_INDEX } from '@/data/market';
import { loadProfile } from '@/data/profile';
import { deriveQuantity } from '@/domain/holdings';
import type { AggressionRating, WaterType } from '@/domain/types';
import type { OrganismKind, WaterZone } from '@/data/seed/taxonomy';
import { Tile } from '../components/Tile';
import { MagnifyingGlassIcon, SlidersHorizontalIcon, XIcon } from '../components/Icons';

type Filter = 'all' | 'caught' | 'uncaught' | 'kept';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'caught', label: 'Caught' },
  { id: 'uncaught', label: 'Not yet' },
  { id: 'kept', label: 'Kept' },
];

/**
 * Fresh, brackish or salt - and the one filter that is ON by default.
 *
 * WHY IT DEFAULTS. Every tank the owner keeps is freshwater, and 868 of the
 * 2,178 species in the catalog are reef stock that arrived with LiveAquaria's
 * marine catalogue. Opening the library on a wall of clownfish and Acropora
 * makes it somebody else's hobby. Defaulting to freshwater makes the first
 * screen the owner's own.
 *
 * WHY IT IS NOT IN THE FILTER SHEET. Everything in there starts at 'any', so
 * a collapsed sheet can only ever hide a filter the user turned on themselves.
 * This one starts on, and a default that quietly removes 40% of the catalog
 * from behind a fold is exactly the failure the sheet's own comment warns
 * about. So it sits in the open, it says how much it is hiding, and when a
 * search would have matched on the other side of it, it says that too.
 *
 * Brackish is its own value rather than being folded into either side: eight
 * species are sold as brackish and nothing else, and a brackish fish is not a
 * freshwater fish. Species nobody tagged are "not recorded" and are excluded
 * from every specific choice rather than defaulted into one - the same rule
 * the water-column zone follows.
 */
type SalinityFilter = 'any' | WaterType | 'unknown';

const SALINITY: Array<{ id: SalinityFilter; label: string }> = [
  { id: 'freshwater', label: 'Fresh' },
  { id: 'brackish', label: 'Brackish' },
  { id: 'marine', label: 'Salt' },
  { id: 'unknown', label: 'Unrecorded' },
  // "Any water", not "All": the ownership row below already has an "All" chip,
  // and two buttons with the same name is ambiguous to anyone navigating by
  // label. It also matches how the other neutral options read - "Any level",
  // "Any temperament".
  { id: 'any', label: 'Any water' },
];

/** True when a card's salinity passes the current choice. */
function matchesSalinity(waterType: WaterType | undefined, s: SalinityFilter) {
  if (s === 'any') return true;
  if (s === 'unknown') return waterType === undefined;
  return waterType === s;
}

/**
 * How the grid is ordered, as an explicit control with an honest default.
 *
 * `documented` leads with the fish this app can actually tell you something
 * about - yours first, then the ones with a portrait. That is the fix for
 * opening on a screen of grey placeholders, and it claims nothing.
 *
 * `stock` is deliberately NOT the default, tempting as it is for shopping. The
 * in-stock flag comes from an unscheduled scrape of mail-order stores and much
 * of that dataset is sold-out back catalogue years old. Ordering the entire
 * library by it silently asserts a present tense the data cannot support, so
 * it is opt-in and prints its own date when chosen.
 */
type Sort = 'documented' | 'stock' | 'alpha';

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'documented', label: 'Yours first' },
  { id: 'stock', label: 'In stock' },
  { id: 'alpha', label: 'A–Z' },
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

const ZONES: Array<{ id: ZoneFilter; label: string }> = [
  { id: 'any', label: 'Any level' },
  { id: 'top', label: 'Top' },
  { id: 'mid', label: 'Mid' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'all-levels', label: 'All levels' },
  { id: 'unknown', label: 'Not recorded' },
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

const NUM = new Intl.NumberFormat();

export default function Catalog() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('documented');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [zone, setZone] = useState<ZoneFilter>('any');
  const [kind, setKind] = useState<KindFilter>('any');
  const [aggression, setAggression] = useState<AggressionFilter>('any');
  // The only filter that does not start at 'any'. See SALINITY above.
  const [salinity, setSalinity] = useState<SalinityFilter>('freshwater');

  const cards = useLiveQuery(async (): Promise<CatalogCard[]> => {
    const [specimens, snapshots, holdings, lifeEvents, residencies, dream, media, prices, profile] =
      await Promise.all([
        db.specimens.toArray(), db.raritySnapshots.toArray(), db.holdings.toArray(),
        db.lifeEvents.toArray(), db.residencies.toArray(), db.dreamList.toArray(), db.media.toArray(),
        // One read of the whole table, grouped once, rather than a query per
        // species: this builds 2,176 cards on every change.
        db.priceObservations.toArray(), loadProfile(),
      ]);
    const dreamed = new Set(dream.map((d) => d.speciesId));
    const ownPrices = pricesBySpecies(prices);
    const currency = profile.settings.currency;

    return CATALOG.species.map((species) => {
      const mine = specimens.filter((s) => s.speciesId === species.speciesId);
      const confirmed = mine.filter((s) => s.identityStatus === 'user-confirmed');
      const speciesHoldings = holdings.filter((h) => h.speciesId === species.speciesId);

      const currentlyKept = speciesHoldings.some((h) => {
        if (deriveQuantity(h, lifeEvents) <= 0) return false;
        return residencies.some((r) => r.holdingId === h.id && !r.endDate);
      });

      // Newest first, so the tile shows your most recent look at it.
      const ownPhotos = media
        .filter((m) => m.kind === 'photo' && m.specimenIds.some((id) => mine.some((s) => s.id === id)))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        .map((m) => m.id);

      const tiers = snapshots.filter((s) => s.speciesId === species.speciesId);
      const { market, scarcityBand } = marketAndScarcity(species.speciesId, {
        prices: ownPrices.get(species.speciesId) ?? [],
        currency,
      });

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
        // "Not yet" is the complement of the tiles in colour, so a fish you
        // keep never shows up under it.
        if (filter === 'uncaught' && c.user.inCollection) return false;
        if (filter === 'kept' && !c.user.kept) return false;

        // A species with no recorded zone is EXCLUDED from every specific zone
        // rather than defaulted into one. "Not recorded" is its own filter, so
        // the gap stays countable instead of being hidden.
        if (zone === 'unknown' ? c.species.waterZone !== undefined : zone !== 'any' && c.species.waterZone !== zone) {
          return false;
        }
        // Same rule as the zone: no recorded salinity means excluded from
        // every specific choice, never defaulted into one.
        if (!matchesSalinity(c.species.waterType, salinity)) return false;

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
      .sort((a, b) => {
        const alpha = a.species.commonName.localeCompare(b.species.commonName);
        // Yours leads in every order. Your own collection is the one thing on
        // this screen that is unambiguously about you.
        const yours = Number(b.user.inCollection) - Number(a.user.inCollection);
        if (sort === 'alpha') return yours || alpha;
        if (sort === 'stock') {
          return yours
            || Number((b.market?.inStock ?? 0) > 0) - Number((a.market?.inStock ?? 0) > 0)
            || alpha;
        }
        // documented: yours, then the ones this app can actually picture.
        return yours
          || Number(Boolean(portraitAsset(b.species.speciesId)))
             - Number(Boolean(portraitAsset(a.species.speciesId)))
          || alpha;
      });
  }, [cards, query, filter, sort, zone, kind, aggression, salinity]);

  /**
   * What the water filter is keeping off the screen, counted rather than
   * described, and broken down COMPLETELY.
   *
   * The app's first rule is that it never hides a fact without saying so, and
   * this filter is on before the user touches anything. A partial breakdown
   * would be its own small dishonesty - naming 38 unrecorded species while
   * silently omitting the 868 marine ones - so every excluded bucket is
   * listed, and the parts always sum to the total.
   *
   * Counted against the WHOLE library, not against the current search: this
   * line explains the standing filter, and a number that moved with the search
   * box would be answering a different question than the one it asks.
   */
  const hiddenBySalinity = useMemo(() => {
    if (!cards || salinity === 'any') return null;
    const buckets: Array<{ id: SalinityFilter; label: string }> = [
      { id: 'freshwater', label: 'freshwater' },
      { id: 'brackish', label: 'brackish' },
      { id: 'marine', label: 'saltwater' },
      { id: 'unknown', label: 'with no salinity recorded' },
    ];
    const parts = buckets
      .filter((b) => b.id !== salinity)
      .map((b) => ({
        label: b.label,
        n: cards.filter((c) => matchesSalinity(c.species.waterType, b.id)).length,
      }))
      .filter((b) => b.n > 0);
    const total = parts.reduce((sum, b) => sum + b.n, 0);
    return total === 0 ? null : { total, parts };
  }, [cards, salinity]);

  // Shown on the collapsed summary so a filter left on inside it is never invisible.
  const activeExtra = [zone !== 'any', kind !== 'any', aggression !== 'any'].filter(Boolean).length;

  /** Real counts on the chips, so a filter says what it costs before you tap it. */
  const counts = useMemo(() => ({
    all: cards?.length ?? 0,
    caught: cards?.filter((c) => c.user.caught).length ?? 0,
    uncaught: cards?.filter((c) => !c.user.inCollection).length ?? 0,
    kept: cards?.filter((c) => c.user.kept).length ?? 0,
  }), [cards]);

  const mine = cards?.filter((c) => c.user.inCollection).length ?? 0;
  const narrowed = Boolean(query.trim()) || filter !== 'all' || activeExtra > 0;

  /** Back to the screen you get on a cold open, water filter at its default. */
  function clearEverything() {
    setQuery(''); setFilter('all'); setZone('any'); setKind('any');
    setAggression('any'); setSalinity('freshwater');
  }

  return (
    <div className="screen catalog-scroll">
      {/*
        The pinned block holds the CONTROLS. An earlier pass pinned a bar
        containing only the title and the count, while search and filters -
        the only things on this screen anyone reaches for twice - scrolled
        away within one flick of a thousand rows.
      */}
      <div className="sticky">
        <div className="topbar">
          <h1 className="topbar__title">Catalog</h1>
          {/* Your collection against the library, which is the number a
              collector is actually tracking — until something narrows the
              list, at which point how much is left is the more useful one. */}
          <span className="topbar__count">
            {narrowed
              ? `${NUM.format(shown.length)} of ${NUM.format(counts.all)}`
              : `${NUM.format(mine)} / ${NUM.format(counts.all)}`}
          </span>
        </div>

        <div className="searchbar">
          <div className="search">
            <MagnifyingGlassIcon size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, scientific name or trade name"
              aria-label="Search the catalog"
            />
            {query && (
              <button type="button" className="iconbtn" onClick={() => setQuery('')} aria-label="Clear search">
                <XIcon size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/*
          Salinity sits above the ownership row because it scopes the whole
          library: "which of these could ever go in one of my tanks" comes
          before "which of them have I caught". It is pinned rather than
          filed in the sheet because it is the one filter that is already on
          when you arrive - see SALINITY.
        */}
        <div className="chips" role="group" aria-label="Filter by fresh or salt water">
          {SALINITY.map((w) => (
            <button
              key={w.id}
              type="button"
              className="chip"
              aria-pressed={salinity === w.id}
              onClick={() => setSalinity(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="chips" role="group" aria-label="Filter by what you have">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="chip__n">{NUM.format(counts[f.id])}</span>
            </button>
          ))}
        </div>
      </div>

      {hiddenBySalinity && (
        <p className="asof">
          {NUM.format(hiddenBySalinity.total)} species hidden:{' '}
          {hiddenBySalinity.parts.map((b) => `${NUM.format(b.n)} ${b.label}`).join(', ')}. Salinity is
          vendor-tagged, never inferred from the fish.
        </p>
      )}

      {/*
        Not pinned, and one row rather than two. Sort and the secondary filters
        are things you touch once a session; inside the sticky block they cost
        about 180px of an 844px viewport permanently, and on separate rows the
        filter button sat alone eating 70px of the first screen.
      */}
      <div className="sortline">
        <button
          type="button"
          className="chip"
          aria-expanded={sheetOpen}
          aria-controls="filter-sheet"
          onClick={() => setSheetOpen((v) => !v)}
        >
          <SlidersHorizontalIcon size={16} aria-hidden="true" />
          Filters
          {activeExtra > 0 && <span className="filters-more__count">{activeExtra}</span>}
        </button>
        <span>
          {SORTS.map((s, i) => (
            <span key={s.id}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <button
                type="button"
                aria-pressed={sort === s.id}
                onClick={() => setSort(s.id)}
                style={sort === s.id
                  ? { color: 'var(--color-text)', fontWeight: 'var(--weight-semibold)' }
                  : undefined}
              >
                {s.label}
              </button>
            </span>
          ))}
        </span>
      </div>

      {/* Stock is the most perishable field in the app. If it is ordering the
          library, it states its own age rather than implying a present tense
          the scrape cannot support. */}
      {sort === 'stock' && (
        <p className="asof">
          Stock as last collected on {MARKET_INDEX.builtAt.slice(0, 10)}, across{' '}
          {MARKET_INDEX.sources.length} mail-order stores. Much of that dataset is sold-out back
          catalogue, so treat this as an ordering, not a promise.
        </p>
      )}

      {sheetOpen && (
        <div className="filters-more">
          <div className="sheet" id="filter-sheet">
          <fieldset className="sheet__group">
            <legend className="sheet__legend">Where it lives</legend>
            <p className="sheet__why">
              Derived from taxonomic family, so &ldquo;not recorded&rdquo; is a real answer rather than a
              bucket for everything unclassified.
            </p>
            <div className="sheet__chips" role="group" aria-label="Filter by where it lives in the tank">
              {ZONES.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  className="chip"
                  aria-pressed={zone === z.id}
                  onClick={() => setZone(z.id)}
                >
                  {z.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="sheet__group">
            <legend className="sheet__legend">Kind</legend>
            <div className="sheet__chips" role="group" aria-label="Filter by kind">
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
          </fieldset>

          <fieldset className="sheet__group">
            <legend className="sheet__legend">Temperament</legend>
            {/* Temperament comes only from the curated care profiles, so the
                filter is mostly empty by design. Saying so beats looking broken. */}
            <p className="sheet__why">
              Only recorded for the species with a curated care profile. It is never guessed from the
              family, because a family can hold both a ram and a jaguar cichlid.
            </p>
            <div className="sheet__chips" role="group" aria-label="Filter by temperament">
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
          </fieldset>

            <div className="sheet__foot">
              {activeExtra > 0 && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => { setZone('any'); setKind('any'); setAggression('any'); }}
                >
                  Clear {activeExtra} filter{activeExtra === 1 ? '' : 's'}
                </button>
              )}
              <button
                type="button"
                className="chip"
                style={{ marginLeft: 'auto' }}
                onClick={() => setSheetOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shaped like the grid it is standing in for, rather than the word
          "Loading…" where 2,178 tiles are about to be. */}
      {cards === undefined && (
        <div className="catalog-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="tile">
              <div className="skel skel--plate" />
              <div className="skel skel--line" style={{ width: '80%' }} />
              <div className="skel skel--line" style={{ width: '55%' }} />
            </div>
          ))}
        </div>
      )}
      {cards === undefined && <p className="visually-hidden" role="status">Loading the catalog</p>}

      {cards && shown.length === 0 && (
        <div className="state">
          <p className="state__head">Nothing matches</p>
          <p className="state__body">
            {query
              ? <>No species matches &ldquo;{query}&rdquo;{activeExtra > 0 && ' with those filters'}.</>
              : 'No species matches those filters.'}
          </p>
          <button type="button" className="state__act" onClick={clearEverything}>
            Clear everything
          </button>
        </div>
      )}

      <div className="catalog-grid">
        {shown.map((card) => (
          <Tile key={card.species.speciesId} card={card} />
        ))}
      </div>

      <p className="pad xs faint">
        Portraits come from Wikimedia Commons under their stated licences, from vendor product
        listings, or from the open web; each species page names its source. Where you have your own
        photo of a fish, it is used instead.
      </p>
    </div>
  );
}

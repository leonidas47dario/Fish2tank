/**
 * The catalog: every species, joined with what you know about it.
 *
 * Three sources meet here and none of them should know about the others:
 *   - catalog.json   the species dimension + its licensed portrait (from the warehouse)
 *   - market-index   price and availability (from the vendor ETL)
 *   - IndexedDB      what YOU have caught, kept and photographed
 */
import type { CurrencyCode, Id, PriceObservation, WaterType } from '@/domain/types';
import type { OrganismKind, WaterZone } from './seed/taxonomy';
import catalogJson from './seed/marts/catalog.json';
import { CANONICAL_BY_SYNONYM } from './seed/species-overrides';
import { marketFor, scarcityFor, bandForSize, MARKET_INDEX } from './market';
import { blendOwnPrices } from '@/engine/pricing/own-prices';
import type { MarketSpeciesStats } from './market';

export interface CatalogPortrait {
  url: string;
  /** Which credit line to render. See spec 002. */
  provenance: 'wikimedia' | 'vendor' | 'web';
  /** Present for Wikimedia images only; vendor and web photos have none. */
  license?: string;
  artist?: string;
  attributionUrl?: string;
  width?: number;
  height?: number;
}

/** The care fields the backfill can source, and therefore can credit. */
export type CareField = 'adultSizeIn' | 'minVolumeGal' | 'aggression' | 'tempC'
  // Spec 045.
  | 'ph' | 'hardnessDgh' | 'tankBaseIn';

export interface CatalogSpecies {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  aliases: string[];
  adultSizeIn?: number;
  minVolumeGal?: number;
  aggression?: string;
  tempMinC?: number;
  tempMaxC?: number;

  /*
   * Spec 045, from Seriously Fish. Each is absent for every species SF does
   * not cover, which is most of the catalog - the screen renders a section
   * only when a value backs it, never a blank row.
   */
  /**
   * Which end of the fish `adultSizeIn` was measured to.
   *
   * Load-bearing rather than trivia: the field has meant nose-to-tail-tip for
   * some species and nose-to-tail-base for others with no way to tell which,
   * and a compatibility engine mixing the two is quietly wrong for every
   * deep-bodied fish.
   */
  lengthBasis?: 'SL' | 'TL' | 'unstated';
  phMin?: number;
  phMax?: number;
  hardnessMinDgh?: number;
  hardnessMaxDgh?: number;
  /** The footprint. A volume alone does not give it: a 14-gal tall is not 24x12. */
  tankBaseLengthIn?: number;
  tankBaseWidthIn?: number;
  /**
   * Seriously Fish's own six-measure rating - an editorial judgement, not a
   * measured figure, and labelled as such wherever it is drawn.
   */
  difficulty?: Array<{ measure: string; word: string }>;

  predationTags: string[];
  sourceLabel?: string;
  sourceUrl?: string;
  /**
   * Where each backfilled care value came from, keyed by field. Present only
   * for species filled in by the spec 003 backfill, where size may come from
   * Wikipedia and tank volume from a store, so a single species-level credit
   * would be wrong about one of them.
   */
  careSources?: Partial<Record<CareField, { source: string; url?: string }>>;
  portrait?: CatalogPortrait;
  /** Taxonomic family, and what it implies. Derived — see seed/taxonomy.ts. */
  family?: string;
  waterZone?: WaterZone;
  organismKind?: OrganismKind;
  habitatNote?: string;
  /**
   * Fresh, brackish or salt, from what the vendors selling it tag. Absent
   * means nobody said, which is not a claim that it is freshwater.
   */
  waterType?: WaterType;
  /**
   * A name a keeper submitted and a reviewer approved, rather than one derived
   * from a vendor listing. Read by the quality gate, and worth saying on the
   * card: this entry has a person behind it, not a source document.
   */
  curated?: boolean;
}

interface CatalogMart {
  schemaVersion: number;
  builtAt: string;
  species: CatalogSpecies[];
}

export const CATALOG = catalogJson as unknown as CatalogMart;

/**
 * Portraits bundled at build time by `npm run portraits`.
 *
 * Referencing Wikimedia URLs directly meant the catalog could not draw itself
 * without a network, which for an offline-first PWA is a failure of the core
 * promise (NFR-02) rather than a degraded state. These are local, versioned
 * and ~25KB each. The remote URL is still kept on the mart, but only as the
 * attribution link.
 */
const BUNDLED_PORTRAITS = import.meta.glob('./seed/assets/portraits/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export function portraitAsset(speciesId: string): string | undefined {
  return BUNDLED_PORTRAITS[`./seed/assets/portraits/${speciesId}.jpg`];
}

/**
 * Species by id, INCLUDING the ids that folded into one (spec 008).
 *
 * A merge drops the non-canonical row from the mart, and a specimen recorded
 * before that merge still points at the dropped id. Without an entry for it,
 * every lookup here misses and a real, correctly-identified fish renders as
 * though it had no species at all - the app would appear to have forgotten a
 * catch because a taxonomist moved a genus.
 *
 * So each folded id is also a key, pointing at the row that survived. Callers
 * need no redirect logic and cannot forget to apply one, which matters because
 * there are a dozen of them and only some would have been found in review.
 */
export const CATALOG_BY_SPECIES = new Map(CATALOG.species.map((s) => [s.speciesId, s]));
for (const [folded, canonical] of CANONICAL_BY_SYNONYM) {
  const row = CATALOG_BY_SPECIES.get(canonical);
  if (row && !CATALOG_BY_SPECIES.has(folded)) CATALOG_BY_SPECIES.set(folded, row);
}

/**
 * Present a locally-submitted species as a catalog entry the UI can render.
 *
 * A species a keeper typed in is not in catalog.json, so every lookup keyed on
 * CATALOG_BY_SPECIES misses it and the record it belongs to renders as though
 * the fish had no identity at all. This adapts the local row into the same
 * shape, with every sourced field deliberately absent: there is no adult size,
 * no aggression rating, no portrait and no water type, because nobody has
 * sourced them. The card's own "not enough data" handling then tells the truth
 * rather than a shape full of zeroes doing it badly.
 */
export function catalogShapeForLocal(species: {
  id: string; commonName: string; scientificName?: string; aliases?: string[];
}): CatalogSpecies {
  return {
    speciesId: species.id,
    commonName: species.commonName,
    scientificName: species.scientificName,
    aliases: species.aliases ?? [],
    predationTags: [],
  };
}

/** Whether an id belongs to a species this keeper added rather than the catalog. */
export function isUserSubmittedId(speciesId: string): boolean {
  return speciesId.startsWith('sp_user_');
}

/**
 * What picking a species off a search result actually asserts (FR-I01).
 *
 * "User confirmed" means "this is that catalog species". For a name the keeper
 * invented there is no catalog species to mean, so the strongest honest state
 * is provisional - the rule `submitUserSpecies()` already follows when it
 * creates the row.
 *
 * Shared by both identify surfaces on purpose. It was a ternary duplicated
 * across two screens for about ten minutes, and in that time the two disagreed:
 * the same submitted species was recorded `user-confirmed` from one screen and
 * `provisional` from the other. Spec 007 exists because two screens doing the
 * same thing drift; this is that, in miniature.
 */
export function identityStatusFor(speciesId: string): 'provisional' | 'user-confirmed' {
  return isUserSubmittedId(speciesId) ? 'provisional' : 'user-confirmed';
}

/**
 * Every species a keeper can search for, from both places they live (spec 007).
 *
 * There are two species libraries and neither is complete. `catalog.json` has
 * all 2,176 derived species and no user submissions; `db.species` has the 47
 * seeded care profiles plus whatever this keeper typed in when the catalog had
 * never heard of their fish. Searching either one alone misses something real,
 * which is exactly the bug this exists to close: the specimen "Change identity"
 * panel searched the table and could reach 47 species, while the capture flow
 * searched the mart and could not see the keeper's own.
 *
 * The seeded 47 are dropped rather than merged, because the ETL adopts the
 * curated id where one exists - `sp_jaguar_cichlid` is a mart row, not
 * `sp_parachromis_managuensis` - so every seeded row is already here under the
 * same id. Adding them back would list the same fish twice and make the user
 * guess which one is real. Verified as a test, not assumed: passing the seeded
 * Jaguar Cichlid yields one entry, not two.
 *
 * FR-I02 (manual species search).
 */
export function searchableSpecies(
  localSpecies: readonly { id: string; commonName: string; scientificName?: string;
    aliases?: string[]; origin?: string }[],
): CatalogSpecies[] {
  const submitted = localSpecies.filter(
    (s) => s.origin === 'user-submitted' && !CATALOG_BY_SPECIES.has(s.id),
  );
  return [...CATALOG.species, ...submitted.map(catalogShapeForLocal)];
}

/** What the user has done with this species. Everything here is personal. */
export interface CatalogUserState {
  /** Confirmed at least one specimen of it, from an encounter. */
  caught: boolean;
  /** Has, or has had, one at home. */
  kept: boolean;
  /**
   * The card's "owned" state: you have met this species or you keep it.
   *
   * Not the same as `caught`. A fish imported as an opening balance has a
   * holding and no specimen (FR-T02), so keying the lock on `caught` alone
   * greyed out every fish in the tanks downstairs. The lock means "you have
   * never had this species", which is what the card metaphor actually claims.
   */
  inCollection: boolean;
  currentlyKept: boolean;
  specimenCount: number;
  /** Highest tier ever revealed for this species. */
  tier?: string;
  golden: boolean;
  onDreamList: boolean;
  /** Your own photos of it, newest first. */
  ownPhotoMediaIds: Id[];
}

/**
 * Whether a species is yours, and how.
 *
 * Defined once because two screens build this state from the same tables, and
 * the Catalog exists precisely because a second screen doing the same
 * derivation drifts from the first. `inCollection` is the card's lock: a fish
 * imported as an opening balance has holdings and no specimen (FR-T02), so a
 * lock keyed on `caught` alone greys out everything in your own tanks.
 */
export function ownership(confirmedSpecimens: number, holdings: number) {
  const caught = confirmedSpecimens > 0;
  const kept = holdings > 0;
  return { caught, kept, inCollection: caught || kept };
}

export interface CatalogCard {
  species: CatalogSpecies;
  user: CatalogUserState;
  market?: MarketSpeciesStats;
  /** Median price at the size you saw it, else the pooled median. */
  price?: number;
  scarcityBand?: string;
}

/**
 * Which image a card should show.
 *
 * Defaults to your own photo when you have one, because the product's whole
 * claim is that the exact specimen matters more than the species. The stock
 * portrait is the fallback, and an explicit preference always wins.
 */
export type CardArt =
  | { kind: 'own'; mediaId: Id }
  | { kind: 'portrait'; src: string; credit: CatalogPortrait }
  | { kind: 'none' };

/**
 * Which picture to draw, given a species and a pool of your own photos.
 *
 * Split out from `resolveCardArt` in spec 021 so a tank tile can ask the same
 * question over a NARROWER pool: the photos of one fish, not of every fish of
 * that species. The tank grid used to ignore your photos entirely and always
 * draw the reference portrait, which is the opposite of principle P3, and two
 * fish of one species in two tanks are two faces rather than one.
 *
 * `species` is optional because a tank can hold a fish nobody has identified -
 * the importer produces exactly that - and such a fish has no portrait to fall
 * back to, only whatever you photographed.
 */
export function chooseArt(
  species: Pick<CatalogSpecies, 'speciesId' | 'portrait'> | undefined,
  ownMediaIds: Id[],
  pref: { artSource: 'own' | 'portrait'; preferredMediaId?: Id } | undefined,
): CardArt {
  const wantsPortrait = pref?.artSource === 'portrait';

  if (!wantsPortrait && ownMediaIds.length > 0) {
    const chosen = pref?.preferredMediaId && ownMediaIds.includes(pref.preferredMediaId)
      ? pref.preferredMediaId
      : ownMediaIds[0]!;
    return { kind: 'own', mediaId: chosen };
  }

  const src = species ? portraitAsset(species.speciesId) : undefined;
  if (src && species?.portrait) {
    return { kind: 'portrait', src, credit: species.portrait };
  }
  // Asked for the portrait but none is bundled: fall back to their own photo
  // rather than showing a silhouette they can improve on.
  if (ownMediaIds.length > 0) return { kind: 'own', mediaId: ownMediaIds[0]! };
  return { kind: 'none' };
}

export function resolveCardArt(
  card: CatalogCard,
  pref: { artSource: 'own' | 'portrait'; preferredMediaId?: Id } | undefined,
): CardArt {
  return chooseArt(card.species, card.user.ownPhotoMediaIds, pref);
}

/**
 * Price to show on the card's cost gem.
 *
 * Undefined when the index has listings but too few sized ones to estimate
 * from. The gem stays empty and the species page shows the vendors instead - a
 * card is a glance, and a glance has no room to say "one listing, unsized".
 */
export function cardPrice(market: MarketSpeciesStats | undefined, sizeIn?: number): number | undefined {
  if (!market?.price) return undefined;
  if (sizeIn !== undefined) {
    const band = bandForSize(market, { value: sizeIn, unit: 'in' });
    if (band) return band.medianPrice;
  }
  return market.price.median;
}

/**
 * The market for a species, with the keeper's own logged prices counted in.
 *
 * One entry point for every screen that shows a price - a card, a species
 * page, a tank's total - because a figure that differs between two screens is
 * worse than no figure at all. Callers that have no observations to hand pass
 * none and get exactly what they got before.
 *
 * Scarcity is deliberately NOT affected. It is a statement about how many
 * shops stock a fish, and one keeper writing down a price is not a shop; see
 * own-prices.ts for what the blend does and does not claim.
 */
export function marketAndScarcity(
  speciesId: string,
  own?: { prices: PriceObservation[]; currency: CurrencyCode },
) {
  const vendor = marketFor(speciesId);
  const market = own
    ? blendOwnPrices(vendor, own.prices, {
        speciesId,
        currency: own.currency,
        minimumSampleCount: MARKET_INDEX.minimumSampleCount,
      })
    : vendor;
  const scarcity = scarcityFor(speciesId);
  return { market, scarcityBand: scarcity.available ? scarcity.band : undefined };
}

/** Group a flat table of observations by species, ready for the blend. */
export function pricesBySpecies(observations: PriceObservation[]): Map<string, PriceObservation[]> {
  const by = new Map<string, PriceObservation[]>();
  for (const o of observations) {
    if (!o.speciesId) continue;
    const list = by.get(o.speciesId);
    if (list) list.push(o);
    else by.set(o.speciesId, [o]);
  }
  return by;
}

/** The stored rows a card is derived from. Whoever has them can build one. */
export interface CatalogCardRows {
  specimens: Array<{ id: Id; identityStatus: string; golden?: unknown }>;
  holdings: Array<{ id: Id }>;
  /** Holding ids that still hold live fish and sit in an open tank. */
  keptHoldingIds: Set<Id>;
  snapshots: Array<{ tier: CatalogUserState['tier'] }>;
  ownPhotoMediaIds: Id[];
  onDreamList: boolean;
}

/**
 * Assemble a card from stored rows.
 *
 * A pure function rather than a hook because the two screens that need a card
 * fetch different amounts around it - the species page already has these rows
 * for other reasons, and re-querying them behind a hook would double its work.
 * Extracting the ASSEMBLY and leaving the fetching to the caller keeps one
 * definition of what a card means without imposing one way of loading it.
 *
 * Worth keeping shared: Plate.tsx records that the last time two screens
 * derived card art separately, they drifted.
 */
export function buildCatalogCard(species: CatalogSpecies, rows: CatalogCardRows): CatalogCard {
  const confirmed = rows.specimens.filter((s) => s.identityStatus === 'user-confirmed');
  const { market, scarcityBand } = marketAndScarcity(species.speciesId);
  return {
    species,
    user: {
      ...ownership(confirmed.length, rows.holdings.length),
      currentlyKept: rows.holdings.some((h) => rows.keptHoldingIds.has(h.id)),
      specimenCount: rows.specimens.length,
      tier: rows.snapshots[0]?.tier,
      golden: rows.specimens.some((s) => Boolean(s.golden)),
      onDreamList: rows.onDreamList,
      ownPhotoMediaIds: rows.ownPhotoMediaIds,
    },
    market,
    price: cardPrice(market),
    scarcityBand,
  };
}

/**
 * The sentence under a portrait, which differs by where the picture came from.
 *
 * A Wikimedia file is used under a stated licence and credits its
 * photographer. A vendor listing photo has no licence at all and is used by
 * the owner's decision (spec 002), so it names the shop plainly instead of
 * borrowing the shape of a licence line. Dressing the second up as the first
 * would be the actual dishonesty here, so provenance decides the sentence and
 * the presence of a `license` field never overrides it.
 */
export function portraitCredit(p: CatalogPortrait): string {
  if (p.provenance === 'wikimedia' && p.license) {
    return p.artist ? `${p.artist}, ${p.license}` : p.license;
  }
  if (p.provenance === 'vendor' && p.artist) return `Photo: ${p.artist} (product listing)`;
  if (p.artist) return `Photo: ${p.artist}`;
  return 'Source not recorded';
}

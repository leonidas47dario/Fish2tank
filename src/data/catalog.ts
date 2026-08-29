/**
 * The catalog: every species, joined with what you know about it.
 *
 * Three sources meet here and none of them should know about the others:
 *   - catalog.json   the species dimension + its licensed portrait (from the warehouse)
 *   - market-index   price and availability (from the vendor ETL)
 *   - IndexedDB      what YOU have caught, kept and photographed
 */
import type { Id } from '@/domain/types';
import type { OrganismKind, WaterZone } from './seed/taxonomy';
import catalogJson from './seed/marts/catalog.json';
import { marketFor, scarcityFor, bandForSize } from './market';
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
export type CareField = 'adultSizeIn' | 'minVolumeGal' | 'aggression' | 'tempC';

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

export const CATALOG_BY_SPECIES = new Map(CATALOG.species.map((s) => [s.speciesId, s]));

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

export function resolveCardArt(
  card: CatalogCard,
  pref: { artSource: 'own' | 'portrait'; preferredMediaId?: Id } | undefined,
): CardArt {
  const own = card.user.ownPhotoMediaIds;
  const wantsPortrait = pref?.artSource === 'portrait';

  if (!wantsPortrait && own.length > 0) {
    const chosen = pref?.preferredMediaId && own.includes(pref.preferredMediaId)
      ? pref.preferredMediaId
      : own[0]!;
    return { kind: 'own', mediaId: chosen };
  }

  const src = portraitAsset(card.species.speciesId);
  if (src && card.species.portrait) {
    return { kind: 'portrait', src, credit: card.species.portrait };
  }
  // Asked for the portrait but none is bundled: fall back to their own photo
  // rather than showing a silhouette they can improve on.
  if (own.length > 0) return { kind: 'own', mediaId: own[0]! };
  return { kind: 'none' };
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

export function marketAndScarcity(speciesId: string) {
  const market = marketFor(speciesId);
  const scarcity = scarcityFor(speciesId);
  return { market, scarcityBand: scarcity.available ? scarcity.band : undefined };
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

/**
 * The catalog: every species, joined with what you know about it.
 *
 * Three sources meet here and none of them should know about the others:
 *   - catalog.json   the species dimension + its licensed portrait (from the warehouse)
 *   - market-index   price and availability (from the vendor ETL)
 *   - IndexedDB      what YOU have caught, kept and photographed
 */
import type { Id } from '@/domain/types';
import catalogJson from './seed/marts/catalog.json';
import { marketFor, scarcityFor, bandForSize } from './market';
import type { MarketSpeciesStats } from './market';

export interface CatalogPortrait {
  url: string;
  license: string;
  artist?: string;
  attributionUrl?: string;
  width?: number;
  height?: number;
}

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
  portrait?: CatalogPortrait;
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
  /** Confirmed at least one specimen of it. The "owned" state of the card. */
  caught: boolean;
  /** Has, or has had, one at home. */
  kept: boolean;
  currentlyKept: boolean;
  specimenCount: number;
  /** Highest tier ever revealed for this species. */
  tier?: string;
  golden: boolean;
  onDreamList: boolean;
  /** Your own photos of it, newest first. */
  ownPhotoMediaIds: Id[];
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

/** Price to show on the card's cost gem. */
export function cardPrice(market: MarketSpeciesStats | undefined, sizeIn?: number): number | undefined {
  if (!market) return undefined;
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

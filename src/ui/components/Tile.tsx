/**
 * One species in the catalog grid.
 *
 * This replaces the collectible-card treatment, and the reason is data rather
 * than taste. That card was built around three coloured discs holding price,
 * adult size and minimum tank - the three numbers a keeper decides on - laid
 * over the photograph in the corners a card game trains the eye to check.
 *
 * The catalog has adult size and minimum tank for 47 of 2,178 species. Nine
 * tiles in ten drew a card format whose whole structure was three numbers, and
 * had none of them. What the format promised and what the library contains
 * were not the same shape.
 *
 * So: the photograph is the tile, the facts sit under it in one line, and a
 * fact that does not exist is simply not drawn. Nothing here is inferred, and
 * nothing is a placeholder for something that will never arrive.
 */
import { Link } from 'react-router-dom';
import type { CatalogCard } from '@/data/catalog';
import { formatVolume } from '@/domain/units';
import { Plate, useCardArt } from './Plate';

/** Rarity is a word above Uncommon and nothing at all below it. */
const SHOWN_TIERS = new Set(['rare', 'epic', 'legendary']);

/**
 * Where in the tank it lives, in three legible letters.
 *
 * The shipped card drew this as a 7px three-segment pip. It said the right
 * thing and could not be read at tile scale, which makes it decoration.
 */
const ZONE_SHORT: Record<string, string> = {
  top: 'top',
  mid: 'mid',
  bottom: 'btm',
  'all-levels': 'all',
};
const ZONE_LABEL: Record<string, string> = {
  top: 'Top dweller',
  mid: 'Mid-water',
  bottom: 'Bottom dweller',
  'all-levels': 'Swims all levels',
};

export function Tile({ card }: { card: CatalogCard }) {
  const { species, user } = card;
  const { art, ownUrl } = useCardArt(card);
  const tier = user.tier && SHOWN_TIERS.has(user.tier) ? user.tier : undefined;

  return (
    <Link className="tile" to={`/species/${species.speciesId}`}>
      <Plate
        speciesId={species.speciesId}
        art={art}
        ownUrl={ownUrl}
        locked={!user.inCollection}
        // Only ever on a fish that is yours, so the mark means something when
        // it appears. 43 in colour among 2,178 is the collection conceit.
        owned={user.currentlyKept ? 'Kept' : user.inCollection ? 'Caught' : undefined}
      />

      <span className="tile__text">
        <span className="tile__name">{species.commonName}</span>
        <span className="tile__textrow">
          {species.scientificName && <span className="tile__sci">{species.scientificName}</span>}
          {tier && (
            <span className={`tile__rarity tile__rarity--${tier}`}>
              {tier}
              <span className="visually-hidden"> discovery tier</span>
            </span>
          )}
        </span>
      </span>

      {/*
        Price, adult size, minimum tank - and the water column, right-aligned.
        Every cell is conditional. A tile that shows one of the four is telling
        the truth about a species the catalog knows one thing about; a tile
        that shows a dash in the other three is dressing an absence up as data.
      */}
      <span className="tile__stats">
        {card.price !== undefined && <b>${Math.round(card.price)}</b>}
        {species.adultSizeIn !== undefined && <span>{Math.round(species.adultSizeIn)} in</span>}
        {species.minVolumeGal !== undefined && (
          <span>{formatVolume({ value: species.minVolumeGal, unit: 'gal' })}</span>
        )}
        {species.waterZone && (
          <span className="tile__col" title={ZONE_LABEL[species.waterZone]}>
            {ZONE_SHORT[species.waterZone] ?? species.waterZone}
            <span className="visually-hidden"> — {ZONE_LABEL[species.waterZone]}</span>
          </span>
        )}
      </span>
    </Link>
  );
}

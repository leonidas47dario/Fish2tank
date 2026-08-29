/**
 * One species as a collectible card.
 *
 * The gem positions are borrowed from card games on purpose: cost top-left,
 * the creature's two stats in the bottom corners. For a fish those are the
 * market price, the adult size, and the minimum tank it needs - the three
 * numbers a keeper actually decides on, sitting where the format has already
 * trained people to look.
 *
 * Art follows principle P3, "the exact specimen matters": your own photo wins
 * over a stock portrait whenever you have one, and the preference is
 * per-species so you can fall back when your photo is a blur through algae.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { resolveCardArt, type CatalogCard } from '@/data/catalog';
import { formatVolume } from '@/domain/units';

interface Props {
  card: CatalogCard;
  onOpen?: (speciesId: string) => void;
}

const TIER_TONE: Record<string, string> = {
  familiar: 'var(--color-muted)',
  uncommon: 'var(--color-primary)',
  rare: 'var(--color-accent)',
  epic: 'var(--color-caution)',
  legendary: 'var(--color-legendary)',
};

export function FishCard({ card, onOpen }: Props) {
  const { species, user } = card;

  const pref = useLiveQuery(() => db.cardPrefs.get(species.speciesId), [species.speciesId]);
  const art = resolveCardArt(card, pref);

  // Your own photos live in IndexedDB as blobs, so they need an object URL.
  const ownUrl = useLiveQuery(async () => {
    if (art.kind !== 'own') return undefined;
    const media = await db.media.get(art.mediaId);
    if (!media) return undefined;
    const stored = await db.blobs.get(media.originalBlobKey);
    return stored ? URL.createObjectURL(stored.blob) : undefined;
  }, [art.kind === 'own' ? art.mediaId : undefined]);

  const locked = !user.caught;
  const label = `${species.commonName}${locked ? ', not yet caught' : ''}`;

  return (
    <button
      type="button"
      className={[
        'fish-card',
        locked ? 'fish-card--locked' : '',
        user.golden ? 'fish-card--golden' : '',
      ].filter(Boolean).join(' ')}
      aria-label={label}
      onClick={() => onOpen?.(species.speciesId)}
    >
      {art.kind === 'portrait' && (
        <img className="fish-card__art" src={art.src} alt="" loading="lazy" />
      )}
      {art.kind === 'own' && ownUrl && (
        <img className="fish-card__art" src={ownUrl} alt="" loading="lazy" />
      )}
      {(art.kind === 'none' || (art.kind === 'own' && !ownUrl)) && (
        // No licensed portrait and no photo of your own. A silhouette, rather
        // than a picture of a different fish.
        <span className="fish-card__art fish-card__art--none" aria-hidden="true">🐟</span>
      )}

      {locked && <span className="fish-card__lock" aria-hidden="true">🔒</span>}

      {/* Cost: what it goes for at the size you saw it. */}
      {card.price !== undefined && (
        <span className="gem gem--cost" title="Typical market price">
          ${Math.round(card.price)}
        </span>
      )}
      {/* Attack-equivalent: how big it gets. */}
      {species.adultSizeIn !== undefined && (
        <span className="gem gem--size" title="Adult size">
          {Math.round(species.adultSizeIn)}&quot;
        </span>
      )}
      {/* Health-equivalent: what it demands of you. */}
      {species.minVolumeGal !== undefined && (
        <span className="gem gem--volume" title="Minimum tank">
          {formatVolume({ value: species.minVolumeGal, unit: 'gal' })}
        </span>
      )}

      {user.tier && (
        <span className="fish-card__tier" style={{ color: TIER_TONE[user.tier] ?? 'var(--color-muted)' }}>
          {user.tier}
        </span>
      )}
      {art.kind === 'own' && ownUrl && <span className="fish-card__own">your photo</span>}

      <span className="fish-card__scrim">
        <span className="fish-card__name">{species.commonName}</span>
        {species.scientificName && <span className="fish-card__sci">{species.scientificName}</span>}
      </span>
    </button>
  );
}

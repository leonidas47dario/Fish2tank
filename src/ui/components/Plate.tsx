/**
 * A portrait, on its plate.
 *
 * A photograph never sits directly on the canvas in this app. It sits on a
 * mat whose colour is derived from that photograph's own border ring at build
 * time (scripts/derive-plates.mjs -> theme/plates.css), addressed by the
 * `data-species` attribute set below.
 *
 * That is the whole reason `object-fit: contain` is affordable. 1,011
 * portraits arrive at every aspect ratio a photographer ever used, and `cover`
 * on a fixed box crops through the middle of a long horizontal animal - the
 * old 3:4 card kept about 37% of a 3:2 photograph's width, head and tail
 * outside the frame. `contain` shows the whole fish and leaves a letterbox,
 * and the letterbox is a near-neutral tint of the image itself, so on the 70%
 * of the library that is full-bleed you cannot see where the photo ends.
 *
 * Three distinct states, deliberately not merged:
 *   - a portrait, or your own photo of the fish
 *   - no portrait exists       (1,167 of 2,178 species; permanent)
 *   - the portrait failed to load (transient; an offline-first app meets this)
 */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blobFor, db } from '@/data/db';
import { resolveCardArt, type CardArt, type CatalogCard } from '@/data/catalog';
import { useBlobUrl } from '../blob-url';
import { FishIcon, ImageBrokenIcon, LockIcon } from './Icons';

/**
 * Which image this card shows, and an object URL if it is one of yours.
 *
 * Extracted from the card component because three screens need the same
 * answer, and the last time two of them derived it separately they drifted.
 */
export function useCardArt(
  card: CatalogCard,
  /**
   * Ignore the stored preference and use this instead.
   *
   * For the reveal, which forces `portrait`. Everywhere else your own photo
   * wins by default (principle P3, "the exact specimen matters") and that is
   * right - but the reveal is unlocking the SPECIES in the catalog, so the
   * catalog's picture is the subject. Showing the snapshot you just took makes
   * the ceremony a slideshow of a photo you have already seen.
   *
   * resolveCardArt still falls back to your own photo when no portrait is
   * bundled, which is 1,167 of 2,178 species.
   */
  override?: { artSource: 'own' | 'portrait' },
): { art: CardArt; ownUrl?: string } {
  const stored = useLiveQuery(
    () => db.cardPrefs.get(card.species.speciesId),
    [card.species.speciesId],
  );
  const art = resolveCardArt(card, override ?? stored);

  // Your own photos live in IndexedDB as bytes. The query yields the blob and
  // useBlobUrl owns the URL, so a scroll through the catalog cannot leak one
  // pinned photo per own-photo tile.
  const blob = useLiveQuery(async () => {
    if (art.kind !== 'own') return undefined;
    const media = await db.media.get(art.mediaId);
    if (!media) return undefined;
    return blobFor(await db.blobs.get(media.originalBlobKey));
  }, [art.kind === 'own' ? art.mediaId : undefined]);

  return { art, ownUrl: useBlobUrl(blob) };
}

interface Props {
  speciesId: string;
  art: CardArt;
  ownUrl?: string;
  /** Empty by default: on a tile the name is right there in the text below. */
  alt?: string;
  /** Never had this species. Desaturated and padlocked, but still identifiable. */
  locked?: boolean;
  /** The one mark ever painted on a photograph, and only when it is yours. */
  owned?: string;
  className?: string;
}

export function Plate({ speciesId, art, ownUrl, alt = '', locked, owned, className }: Props) {
  const [failed, setFailed] = useState(false);
  const src = art.kind === 'portrait' ? art.src : art.kind === 'own' ? ownUrl : undefined;

  // A new src is a new chance. Without this a card that failed once stays
  // failed after the user swaps to their own photo.
  useEffect(() => setFailed(false), [src]);

  return (
    <span
      className={['plate', locked ? 'plate--locked' : '', className].filter(Boolean).join(' ')}
      data-species={speciesId}
    >
      {owned && <span className="plate__owned">{owned}</span>}

      {/* The lock the Drawer rebuild dropped, restored.
​
          It is the collection conceit made visible: greyscale alone says "this
          image is dull", a padlock says "this one is not yours yet", and the
          second is the thing the catalog is actually for. Back as a Phosphor
          icon rather than the 🔒 it used to be, because that emoji is exactly
          the class of typed glyph the rebuild removed for having no rendering
          at all on two of five platforms.

          It carries its own text. Before the rebuild the card's aria-label
          ended with "not in your collection" and the glyph could be decorative;
          the current tile says no such thing, so a lock that were aria-hidden
          would leave "have I got this one" as a fact you can only get by
          looking - desaturation and a padlock, both visual, and nothing else
          (NFR-06). */}
      {locked && src && !failed && (
        <span className="plate__lock">
          <LockIcon size={20} aria-hidden="true" />
          <span className="visually-hidden">Not in your collection</span>
        </span>
      )}

      {src && !failed && (
        <img
          className="plate__img"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}

      {src && failed && (
        // Different from "no portrait exists", and says so. Conflating the two
        // tells a user offline in a shop basement that a picture they have
        // seen before is gone for good.
        <span className="plate__img plate__img--failed">
          <ImageBrokenIcon size={22} aria-hidden="true" />
          <span className="plate__none-text">Picture didn&apos;t load</span>
        </span>
      )}

      {!src && (
        <span className="plate__img plate__img--none">
          <FishIcon size={20} aria-hidden="true" />
          <span className="plate__none-text">No portrait</span>
        </span>
      )}
    </span>
  );
}

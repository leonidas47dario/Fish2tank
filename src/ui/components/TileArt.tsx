/**
 * One tile's photograph, loaded on its own - spec 053.
 *
 * WHY THIS EXISTS. The shared tank page is fast for one reason: it never waits
 * for anything before painting. Each tile is an ordinary `<img src>` and the
 * browser streams them independently. The owner's tank did the opposite -
 * `useTankResidents` read every fish's blob in a serial loop inside one
 * `useLiveQuery`, so nothing on the screen rendered until the last photograph
 * of the last fish had been read out of IndexedDB and decoded.
 *
 * This component is the fix: it owns ONE media, at ONE size - its query, its
 * object URL and its lifetime - so a grid of thirty paints at once and the
 * photographs land as they arrive.
 *
 * `loading="lazy"` for the same reason it works on the shared page: a fish you
 * have not scrolled to costs nothing. The empty box is drawn immediately and
 * holds the tile's shape, so nothing reflows when the picture lands.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { readMediaBlob } from '@/data/media/read';
import type { RenditionSize } from '@/data/media/renditions';
import { useCachedBlobUrl } from '../blob-url';
import { mediaCacheKey } from '../media-cache';
import type { Id } from '@/domain/types';

export function TileArt({ mediaId, alt = '', size = 'thumbnail', className }: {
  mediaId: Id;
  alt?: string;
  /**
   * `thumbnail` for a grid tile. Spec 036 sized a 320px thumbnail for a box of
   * 107 CSS px; a tile is 150-190, so this is 1.7-2.1x rather than 3x - sharp
   * on a 2x screen, softer on a 3x one, and worth it for a grid that appears
   * at once. Anything drawn large still passes `preview`.
   */
  size?: RenditionSize;
  className?: string;
}) {
  const blob = useLiveQuery(async () => {
    const media = await db.media.get(mediaId);
    if (!media) return null;
    return (await readMediaBlob(media, size)) ?? null;
  }, [mediaId, size]);

  /* Spec 055. Keyed by what the picture IS, so scrolling away and back reuses
     the same URL and the browser reuses its decoded image. */
  const url = useCachedBlobUrl(mediaCacheKey(mediaId, size), blob ?? undefined);

  // The box is drawn whether or not the picture has arrived, so the grid does
  // not reflow underneath the reader when it does.
  if (!url) {
    return <span className={`${className ?? ''} tank-tile__art--empty`} aria-hidden="true">◍</span>;
  }
  return <img className={className} src={url} alt={alt} loading="lazy" />;
}

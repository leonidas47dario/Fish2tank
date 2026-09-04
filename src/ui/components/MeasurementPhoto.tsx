/**
 * The photograph a size was read from - spec 047.
 *
 * `HoldingMeasurement.mediaId` has recorded which photograph a size came from
 * since spec 037, and nothing ever showed it: *"if a measurement is associated
 * with a photo, I should be able to click into the size to see the photo"*.
 *
 * MOUNTED ONLY WHILE OPEN, which is the whole performance story. The query and
 * the object URL live and die with this component, so a timeline of thirty
 * measurements reads no blobs at all until one is tapped - rather than every
 * row pulling a photograph out of IndexedDB on render.
 *
 * `preview`, NOT `thumbnail`. Spec 036's rule is that a thumbnail suits a box
 * of 107 CSS px or less, and this is drawn at the full width of the column.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { readMediaBlob } from '@/data/media/read';
import { useBlobUrl } from '../blob-url';
import type { Id } from '@/domain/types';

export function MeasurementPhoto({ mediaId, alt }: { mediaId: Id; alt: string }) {
  const blob = useLiveQuery(async () => {
    const media = await db.media.get(mediaId);
    if (!media) return null;
    return (await readMediaBlob(media, 'preview')) ?? null;
  }, [mediaId]);

  const url = useBlobUrl(blob ?? undefined);

  // Three states, told apart on purpose: still reading, read and there is
  // nothing there, and read and here it is. The middle one is a photograph
  // that was deleted with the measurement's link left behind, which spec 033's
  // delete path clears - but a copy of the app that has not synced yet can
  // still be looking at one.
  if (blob === undefined) return <p className="xs muted timeline__shot">Opening…</p>;
  if (blob === null) return <p className="xs muted timeline__shot">That photograph is no longer here.</p>;

  return (
    <figure className="timeline__shot">
      {url && <img src={url} alt={alt} />}
    </figure>
  );
}

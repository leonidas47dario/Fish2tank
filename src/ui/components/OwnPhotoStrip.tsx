/**
 * Your own pictures of one species, and which of them is the card's face.
 *
 * Object URLs are created in an effect and revoked when the set changes, not
 * created inline during render: a blob URL leaks its blob for the lifetime of
 * the document, and on a screen that re-renders on every Dexie write that adds
 * up to the photo library sitting in memory twice.
 */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blobFor, db } from '@/data/db';
import type { Id } from '@/domain/types';

interface Props {
  mediaIds: Id[];
  selected?: Id;
  onPick: (mediaId: Id) => void;
}

export function OwnPhotoStrip({ mediaIds, selected, onPick }: Props) {
  const key = mediaIds.join(',');

  const blobs = useLiveQuery(async () => {
    const media = await db.media.bulkGet(mediaIds);
    const found: Array<{ id: Id; blob: Blob }> = [];
    for (const m of media) {
      if (!m) continue;
      const blob = blobFor(await db.blobs.get(m.originalBlobKey));
      if (blob) found.push({ id: m.id, blob });
    }
    return found;
  }, [key]);

  const [urls, setUrls] = useState<Array<{ id: Id; url: string }>>([]);

  useEffect(() => {
    if (!blobs) return;
    const made = blobs.map((b) => ({ id: b.id, url: URL.createObjectURL(b.blob) }));
    setUrls(made);
    return () => made.forEach((m) => URL.revokeObjectURL(m.url));
  }, [blobs]);

  if (urls.length === 0) return null;

  return (
    <div className="photo-strip">
      {urls.map(({ id, url }) => (
        <button
          key={id}
          type="button"
          className={`photo-strip__item${id === selected ? ' photo-strip__item--on' : ''}`}
          aria-pressed={id === selected}
          aria-label={id === selected ? 'Card art, selected' : 'Use this photo as the card art'}
          onClick={() => onPick(id)}
        >
          <img src={url} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

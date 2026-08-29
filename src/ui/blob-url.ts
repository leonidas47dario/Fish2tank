/**
 * Object URLs for media held in IndexedDB, created and revoked in one place.
 *
 * `URL.createObjectURL` pins its blob for the lifetime of the document. Every
 * screen in this app reads media through `useLiveQuery`, which re-runs on any
 * write to the tables it touches, so a URL minted inline during render leaks a
 * whole photo per write and there is no upper bound on how many.
 *
 * There were four hand-rolled versions of this before, and two of them leaked -
 * including one sitting next to a comment in the file that explained precisely
 * why leaking is a problem. That is the argument for a hook rather than a
 * convention: the correct version has to be the easy one to reach for.
 *
 * Revocation is deferred by a frame. A cleanup that revokes synchronously can
 * pull the URL out from under an <img> that the browser has not finished
 * decoding, or a download the user just started, which is the difference
 * between a leak and a blank picture.
 */
import { useEffect, useState } from 'react';
import type { Id } from '@/domain/types';

/** Long enough for a paint, short enough that nothing accumulates. */
const REVOKE_DELAY_MS = 1000;

export function revokeSoon(url: string) {
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * One object URL for one blob.
 *
 * Returns `undefined` while the blob is still being read, which is a different
 * state from "there is no blob" and callers are expected to tell them apart.
 */
export function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => {
      /* Clear the src BEFORE the URL dies, so no <img> is ever pointed at a
         revoked URL. An earlier version returned early when the query went
         back to undefined and left the old, already-revoked URL rendering. */
      setUrl(undefined);
      revokeSoon(made);
    };
  }, [blob]);

  return url;
}

/** The same, for a keyed set. The key is what decides when to re-mint. */
export function useBlobUrls<T extends { id: Id; blob: Blob }>(
  items: T[] | undefined,
): Array<{ id: Id; url: string }> {
  const [urls, setUrls] = useState<Array<{ id: Id; url: string }>>([]);

  useEffect(() => {
    if (!items) {
      setUrls([]);
      return;
    }
    const made = items.map((i) => ({ id: i.id, url: URL.createObjectURL(i.blob) }));
    setUrls(made);
    return () => {
      setUrls([]);
      for (const m of made) revokeSoon(m.url);
    };
  }, [items]);

  return urls;
}

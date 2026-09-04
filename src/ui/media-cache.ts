/**
 * Object URLs that survive a remount - spec 055.
 *
 * THE PROBLEM. A keeper's own photograph is a Blob in IndexedDB, and every
 * mount minted a fresh object URL for it. A NEW OBJECT URL IS A NEW CACHE KEY
 * TO THE BROWSER, so the JPEG was decoded again from nothing even though the
 * identical bytes had been decoded a moment earlier. `useLiveQuery` re-runs on
 * any write to a table it read, so one photo finishing its sync re-decoded
 * every own-photo card on the catalog at once.
 *
 * WHY THIS IS NOT JUST A MAP. `URL.createObjectURL` pins its Blob for the
 * lifetime of the document, so a cache that never revokes is BUG-13 - the
 * 752 MB leak this project already shipped once, measured at 74 URLs created
 * and 0 revoked.
 *
 * AND WHY IT IS NOT JUST AN LRU. The catalog renders all 2,176 cards at once
 * (ENH-03), so every own-photo card is mounted simultaneously. A size-capped
 * cache would revoke URLs that are on screen, and the fix would present as
 * broken images.
 *
 * So it is REFERENCE-COUNTED: a URL is revoked only when nothing is using it
 * AND it has aged out of a bounded idle list. Both halves are load-bearing -
 * refcounting alone grows without limit, eviction alone breaks live images.
 *
 * No React in here on purpose. The rule that decides when bytes are freed is
 * then testable, rather than observable only by watching memory.
 */

/**
 * How many unused URLs to keep before revoking the oldest.
 *
 * These are thumbnails (spec 053), so forty of them is on the order of a
 * megabyte - small enough not to matter, large enough that scrolling a list
 * back and forth never re-decodes.
 */
export const IDLE_LIMIT = 40;

interface Entry {
  url: string;
  /** How many mounted components are currently displaying this URL. */
  refs: number;
}

const entries = new Map<string, Entry>();
/** Keys with `refs === 0`, oldest first. The only things eligible for revoking. */
let idle: string[] = [];

/** Injected in tests; the real one pins a Blob until revoked. */
interface UrlApi {
  create: (blob: Blob) => string;
  revoke: (url: string) => void;
}
const browserUrls: UrlApi = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

export function mediaCacheKey(mediaId: string, size: string): string {
  return `${mediaId}:${size}`;
}

/**
 * Take a URL for these bytes, minting one only if nothing holds it already.
 *
 * The caller MUST pair this with `release`. The blob is used only on a miss,
 * so a hit costs nothing and - the point of the whole exercise - hands back
 * the SAME string, which is what lets the browser reuse its decoded image.
 */
export function acquire(key: string, blob: Blob, urls: UrlApi = browserUrls): string {
  const existing = entries.get(key);
  if (existing) {
    existing.refs += 1;
    // No longer idle: something is using it again.
    idle = idle.filter((k) => k !== key);
    return existing.url;
  }
  const url = urls.create(blob);
  entries.set(key, { url, refs: 1 });
  return url;
}

/**
 * Give up one use of a URL.
 *
 * Reaching zero does not free it - that is the whole reason a remount is
 * cheap. It joins the idle list, and only falls off the end of that.
 */
export function release(key: string, urls: UrlApi = browserUrls): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;

  entry.refs = 0;
  idle = idle.filter((k) => k !== key);
  idle.push(key);

  while (idle.length > IDLE_LIMIT) {
    const oldest = idle.shift()!;
    const dead = entries.get(oldest);
    // Belt and braces: never revoke something that was re-acquired between
    // joining the list and reaching the front of it.
    if (!dead || dead.refs > 0) continue;
    entries.delete(oldest);
    urls.revoke(dead.url);
  }
}

/** For tests, and for a full erase. Frees everything, referenced or not. */
export function resetMediaCache(urls: UrlApi = browserUrls): void {
  for (const entry of entries.values()) urls.revoke(entry.url);
  entries.clear();
  idle = [];
}

/** What the cache is holding. Tests assert on this; nothing else should. */
export function mediaCacheStats(): { held: number; idle: number; referenced: number } {
  let referenced = 0;
  for (const e of entries.values()) if (e.refs > 0) referenced += 1;
  return { held: entries.size, idle: idle.length, referenced };
}

import { beforeEach, describe, expect, it } from 'vitest';
import {
  acquire, IDLE_LIMIT, mediaCacheKey, mediaCacheStats, release, resetMediaCache,
} from './media-cache';

/**
 * Spec 055. The rule that decides when photograph bytes are freed.
 *
 * Two failure modes are being guarded against, and they pull in opposite
 * directions. Never revoking is BUG-13 - the 752 MB leak this project shipped
 * once. Revoking too eagerly breaks an image that is still on screen, because
 * the catalog mounts every own-photo card at the same time (ENH-03). A test
 * that only checked one of them would pass on a version that was badly wrong.
 */

const created: string[] = [];
const revoked: string[] = [];
let n = 0;
const urls = {
  create: () => { const u = `blob:test/${n++}`; created.push(u); return u; },
  revoke: (u: string) => { revoked.push(u); },
};
const blob = () => new Blob(['x']);

beforeEach(() => {
  resetMediaCache(urls);
  created.length = 0; revoked.length = 0; n = 0;
});

describe('media URL cache (spec 055)', () => {
  it('mints once and HANDS BACK THE SAME STRING on a second acquire', () => {
    // The same string is the whole point: a different URL is a different cache
    // key to the browser, which is what forced the re-decode.
    const a = acquire('m1:thumbnail', blob(), urls);
    const b = acquire('m1:thumbnail', blob(), urls);

    expect(a).toBe(b);
    expect(created).toHaveLength(1);
  });

  it('treats a different size as a different picture', () => {
    acquire(mediaCacheKey('m1', 'thumbnail'), blob(), urls);
    acquire(mediaCacheKey('m1', 'preview'), blob(), urls);

    expect(created).toHaveLength(2);
  });

  it('NEVER REVOKES A URL SOMETHING IS STILL USING', () => {
    const key = 'm1:thumbnail';
    acquire(key, blob(), urls);
    acquire(key, blob(), urls);

    release(key, urls);          // one of two users has gone

    expect(revoked).toEqual([]);
    expect(mediaCacheStats().referenced).toBe(1);
  });

  it('keeps an unused URL alive rather than freeing it immediately', () => {
    // This is what makes a remount cheap. Freeing on the last release would
    // make scrolling away and back cost a full decode again.
    const key = 'm1:thumbnail';
    const url = acquire(key, blob(), urls);
    release(key, urls);

    expect(revoked).toEqual([]);
    expect(acquire(key, blob(), urls)).toBe(url);
    expect(created).toHaveLength(1);
  });

  it('FREES THE OLDEST once more than the limit are unused', () => {
    for (let i = 0; i < IDLE_LIMIT + 3; i += 1) {
      const key = `m${i}:thumbnail`;
      acquire(key, blob(), urls);
      release(key, urls);
    }

    expect(revoked).toHaveLength(3);
    expect(revoked).toEqual(['blob:test/0', 'blob:test/1', 'blob:test/2']);
    expect(mediaCacheStats().held).toBe(IDLE_LIMIT);
  });

  it('STAYS BOUNDED under repeated mount/unmount of many photos', () => {
    // BUG-13's shape: navigate in and out repeatedly and watch it grow.
    for (let round = 0; round < 10; round += 1) {
      for (let i = 0; i < 30; i += 1) acquire(`m${i}:thumbnail`, blob(), urls);
      for (let i = 0; i < 30; i += 1) release(`m${i}:thumbnail`, urls);
    }

    expect(mediaCacheStats().held).toBeLessThanOrEqual(IDLE_LIMIT);
    // And nothing was minted twice: the second round onwards were all hits.
    expect(created).toHaveLength(30);
  });

  it('does not free a URL re-acquired while it sat in the idle list', () => {
    const key = 'm0:thumbnail';
    acquire(key, blob(), urls);
    release(key, urls);
    acquire(key, blob(), urls);          // picked up again, still idle-listed

    // Push far past the limit; the re-acquired one must survive.
    for (let i = 1; i < IDLE_LIMIT + 5; i += 1) {
      acquire(`m${i}:thumbnail`, blob(), urls);
      release(`m${i}:thumbnail`, urls);
    }

    expect(revoked).not.toContain('blob:test/0');
    expect(mediaCacheStats().referenced).toBe(1);
  });

  it('releasing something it never held is a no-op, not a crash', () => {
    expect(() => release('nope:thumbnail', urls)).not.toThrow();
  });

  it('reset frees everything, referenced or not', () => {
    acquire('m1:thumbnail', blob(), urls);
    acquire('m2:thumbnail', blob(), urls);

    resetMediaCache(urls);

    expect(revoked).toHaveLength(2);
    expect(mediaCacheStats()).toEqual({ held: 0, idle: 0, referenced: 0 });
  });
});

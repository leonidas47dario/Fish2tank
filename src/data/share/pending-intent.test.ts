/**
 * The intent that has to survive a sign-in redirect.
 *
 * The consuming-on-read rule is the one worth pinning down. Leaving the intent
 * behind would re-add a fish to somebody's Dream List on every later visit to
 * the shared page, which is the kind of defect that looks like the app has a
 * mind of its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPending, remember, takePending } from './pending-intent';

/** Node has no localStorage; this is the smallest thing that behaves like one. */
function fakeStorage(over: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    ...over,
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

const heart = { action: 'heart' as const, speciesId: 'sp_betta', returnTo: '/share/tok-1' };

describe('pending intent', () => {
  it('survives being written and read back', () => {
    remember(heart);

    expect(takePending()).toMatchObject({
      action: 'heart', speciesId: 'sp_betta', returnTo: '/share/tok-1',
    });
  });

  it('is consumed by reading, so it cannot fire twice', () => {
    remember(heart);

    expect(takePending()).toBeDefined();
    expect(takePending()).toBeUndefined();
  });

  it('reports nothing when there is nothing', () => {
    expect(takePending()).toBeUndefined();
  });

  it('discards an intent older than the sign-in window', () => {
    remember(heart);
    const sixteenMinutes = Date.now() + 16 * 60 * 1000;

    expect(takePending(sixteenMinutes)).toBeUndefined();
  });

  it('keeps one that is merely slow', () => {
    remember(heart);
    const fourteenMinutes = Date.now() + 14 * 60 * 1000;

    expect(takePending(fourteenMinutes)).toBeDefined();
  });

  it('discards junk rather than acting on it', () => {
    for (const junk of ['not json', '{}', '{"action":"delete-everything","speciesId":"x","returnTo":"/","at":1}']) {
      localStorage.setItem('fish2tank:share:pending-intent', junk);
      expect(takePending(), junk).toBeUndefined();
    }
  });

  it('can be dropped without being acted on', () => {
    remember(heart);
    clearPending();

    expect(takePending()).toBeUndefined();
  });

  /**
   * Safari in private mode throws on write. A heart that cannot be remembered
   * has to degrade to a heart that is not remembered, never to a page that
   * fell over in front of a stranger.
   */
  it('does not throw when the browser refuses to store anything', () => {
    vi.stubGlobal('localStorage', fakeStorage({
      setItem: () => { throw new DOMException('QuotaExceededError'); },
      getItem: () => { throw new DOMException('SecurityError'); },
    }));

    expect(() => remember(heart)).not.toThrow();
    expect(() => takePending()).not.toThrow();
    expect(takePending()).toBeUndefined();
  });
});

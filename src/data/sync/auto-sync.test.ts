import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoSync, DEBOUNCE_MS } from './auto-sync';
import type { MediaSyncBlocker, MediaSyncResult } from './media-sync';

const CLEAN: MediaSyncResult = {
  upload: { uploaded: 1, downloaded: 0, skipped: 0, failed: 0 },
  download: { uploaded: 0, downloaded: 0, skipped: 0, failed: 0 },
};

const ORDINARY_FAILURE: MediaSyncResult = {
  upload: { uploaded: 0, downloaded: 0, skipped: 0, failed: 1, firstError: 'network hiccup' },
};

const MISCONFIGURED: MediaSyncResult = {
  upload: {
    uploaded: 0, downloaded: 0, skipped: 0, failed: 28,
    firstError: '/presign/put failed: 404',
    configurationFault: true,
  },
};

/** A `run` that resolves what it is told to, and counts its calls. */
function harness(results: MediaSyncResult[] | MediaSyncResult = CLEAN) {
  const queue = Array.isArray(results) ? [...results] : undefined;
  const single = Array.isArray(results) ? undefined : results;
  const run = vi.fn(async () => queue ? (queue.shift() ?? CLEAN) : single!);
  let blocker: MediaSyncBlocker | undefined;
  const auto = createAutoSync({ run, blocked: () => blocker });
  return { auto, run, block: (b?: MediaSyncBlocker) => { blocker = b; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('automatic photo sync (spec 014)', () => {
  it('runs after a change, without anyone pressing anything', async () => {
    const { auto, run } = harness();
    auto.request('photos changed');
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
    expect(auto.state().lastReason).toBe('photos changed');
  });

  it('turns a burst of forty into one run', async () => {
    // Importing a catch writes an original, a preview and a thumbnail; a
    // multi-photo capture writes several of each. One run, not forty.
    const { auto, run } = harness();
    for (let i = 0; i < 40; i += 1) auto.request('photos changed');

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
  });

  it('never starts a second run on top of a first, and owes exactly one', async () => {
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<MediaSyncResult>((res) => {
      release = () => res(CLEAN);
    }));
    const auto = createAutoSync({ run, blocked: () => undefined });

    auto.request('first');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
    expect(auto.state().running).toBe(true);

    // Three arrive mid-run. They all want the same thing, so they are owed
    // one follow-up between them - and crucially, no amount of waiting starts
    // it while the first is still in flight. Two runs over one queue would
    // upload the same bytes twice and race each other's syncState writes.
    auto.request('a');
    auto.request('b');
    auto.request('c');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 4);
    expect(run).toHaveBeenCalledOnce();

    release();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(2);

    // And exactly one. Three requests do not become three runs.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 4);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs on the timer as well as on changes', async () => {
    const { auto, run } = harness();
    auto.setIntervalMinutes(30);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
    expect(auto.state().lastReason).toBe('every 30 minutes');

    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stops the timer on a configuration fault, and says why', async () => {
    // Spec 011's lesson: production promised a retry against a Worker that had
    // never been deployed. An unattended loop makes that worse - it fails
    // silently, on a schedule, on battery.
    const { auto, run } = harness(MISCONFIGURED);
    auto.setIntervalMinutes(30);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
    expect(auto.state().paused?.reason).toContain('404');

    // Two more scheduled runs' worth of time, and nothing happens.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).toHaveBeenCalledOnce();

    // A request is ignored too, not queued up behind the pause.
    auto.request('photos changed');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
  });

  it('resumes when told to, which is what the manual button does', async () => {
    const { auto, run } = harness([MISCONFIGURED, CLEAN]);
    auto.setIntervalMinutes(30);
    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);
    expect(auto.state().paused).toBeDefined();

    auto.resume();
    expect(auto.state().paused).toBeUndefined();

    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not stop for an ordinary failure', async () => {
    // A photo that failed on a bad connection is exactly what the timer is for.
    const { auto, run } = harness(ORDINARY_FAILURE);
    auto.setIntervalMinutes(30);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);

    expect(auto.state().paused).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps running on changes when the interval is off', async () => {
    const { auto, run } = harness();
    auto.setIntervalMinutes(0);

    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(run).not.toHaveBeenCalled();

    auto.request('photos changed');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
  });

  it('skips quietly while blocked, and does not pause', async () => {
    // Signed out, offline and not-configured all change on their own; the next
    // request finds them changed. Pausing for one would be wrong.
    const { auto, run, block } = harness();
    block('signed-out');

    auto.request('photos changed');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run).not.toHaveBeenCalled();
    expect(auto.state().paused).toBeUndefined();

    block(undefined);
    auto.request('signed in');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
  });

  it('survives a run that throws, and keeps going', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(CLEAN);
    const auto = createAutoSync({ run, blocked: () => undefined });
    auto.setIntervalMinutes(30);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);
    expect(auto.state().running).toBe(false);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stops cleanly', async () => {
    const { auto, run } = harness();
    auto.setIntervalMinutes(5);
    auto.request('photos changed');
    auto.stop();

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).not.toHaveBeenCalled();
  });
});

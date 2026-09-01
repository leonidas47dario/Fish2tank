/**
 * A shared tank republishing itself, and the two ways that goes wrong.
 *
 * The first is a stale page: an edit that a guest should see and does not.
 * The second is a write loop, which is the more dangerous one because it
 * looks like nothing at all from the app - it is only visible as a rising
 * operation count on somebody's bill.
 *
 * Spec 014 recorded a lesson worth repeating here: its in-flight-guard test
 * passed against the bug until it was strengthened to advance the clock WHILE
 * the first run was still open. The equivalent test below does that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoRepublish, tanksToRepublish, type CurrentState } from './auto-republish';
import type { ShareRecord } from '../db';

const share = (over: Partial<ShareRecord> = {}): ShareRecord => ({
  aquariumId: 'aq_1',
  token: 'tok-1',
  publishedAt: '2026-08-30T12:00:00.000Z',
  fingerprint: 'fp-1',
  photoIncluded: true,
  ...over,
});

const current = (entries: Record<string, CurrentState>) => new Map(Object.entries(entries));

describe('tanksToRepublish', () => {
  it('leaves an unchanged tank alone', () => {
    expect(tanksToRepublish({
      shares: [share()],
      current: current({ aq_1: { fingerprint: 'fp-1', hasPhoto: true } }),
      failed: new Map(),
    })).toEqual([]);
  });

  it('picks up a tank whose contents moved', () => {
    expect(tanksToRepublish({
      shares: [share()],
      current: current({ aq_1: { fingerprint: 'fp-2', hasPhoto: true } }),
      failed: new Map(),
    })).toEqual(['aq_1']);
  });

  it('picks up a tank whose photo finally synced', () => {
    expect(tanksToRepublish({
      shares: [share({ photoIncluded: false })],
      current: current({ aq_1: { fingerprint: 'fp-1', hasPhoto: true } }),
      failed: new Map(),
    })).toEqual(['aq_1']);
  });

  it('ignores a tank that is not shared at all', () => {
    expect(tanksToRepublish({
      shares: [],
      current: current({ aq_1: { fingerprint: 'fp-9', hasPhoto: false } }),
      failed: new Map(),
    })).toEqual([]);
  });

  /**
   * Deleting a tank and revoking its link are different acts. Guessing between
   * them here would either strand a public page or take one down unasked, so
   * a share whose tank has gone is left for a person to resolve.
   */
  it('does not act on a share whose tank no longer exists', () => {
    expect(tanksToRepublish({
      shares: [share()],
      current: new Map(),
      failed: new Map(),
    })).toEqual([]);
  });

  /**
   * The loop guard. Recording a failure writes to `shares`, the subscription
   * sees that write, and without this the pass would run again immediately and
   * fail again at whatever rate the network allows.
   */
  it('does not retry content that already failed', () => {
    expect(tanksToRepublish({
      shares: [share()],
      current: current({ aq_1: { fingerprint: 'fp-2', hasPhoto: true } }),
      failed: new Map([['aq_1', 'fp-2']]),
    })).toEqual([]);
  });

  it('tries again once the tank changes after a failure', () => {
    expect(tanksToRepublish({
      shares: [share()],
      current: current({ aq_1: { fingerprint: 'fp-3', hasPhoto: true } }),
      failed: new Map([['aq_1', 'fp-2']]),
    })).toEqual(['aq_1']);
  });

  it('handles several tanks at once', () => {
    expect(tanksToRepublish({
      shares: [share(), share({ aquariumId: 'aq_2', fingerprint: 'fp-a' })],
      current: current({
        aq_1: { fingerprint: 'fp-2', hasPhoto: true },
        aq_2: { fingerprint: 'fp-a', hasPhoto: false },
      }),
      failed: new Map(),
    })).toEqual(['aq_1']);
  });
});

describe('the republish scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function scheduler(over: Partial<Parameters<typeof createAutoRepublish>[0]> = {}) {
    const publish = vi.fn(async () => undefined);
    const auto = createAutoRepublish({
      due: async () => ['aq_1'],
      publish,
      blocked: () => undefined,
      debounceMs: 3_000,
      ...over,
    });
    return { auto, publish };
  }

  it('waits out the burst and writes once', async () => {
    const { auto, publish } = scheduler();

    for (let i = 0; i < 40; i += 1) auto.request('a fish went in');
    expect(publish).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  /**
   * The test spec 014 had to strengthen. Asserting the count after the run has
   * finished passes even when the guard is missing; the clock has to move
   * while the first pass is still open.
   */
  it('never runs two passes at once, and owes exactly one follow-up', async () => {
    let release: (() => void) | undefined;
    const publish = vi.fn(() => new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    }));
    const auto = createAutoRepublish({
      due: async () => ['aq_1'], publish, blocked: () => undefined, debounceMs: 3_000,
    });

    auto.request('first');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(auto.state().running).toBe(true);

    // Three more asks arrive mid-flight, and the clock keeps moving.
    auto.request('second');
    auto.request('third');
    await vi.advanceTimersByTimeAsync(30_000);
    auto.request('fourth');
    expect(publish).toHaveBeenCalledTimes(1);

    release!();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all while blocked, and does not pause anything', async () => {
    const { auto, publish } = scheduler({ blocked: () => 'offline' });

    auto.request('a fish went in');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(publish).not.toHaveBeenCalled();
    expect(auto.state().running).toBe(false);
  });

  it('records a failure against the tank and keeps going', async () => {
    const { auto } = scheduler({
      due: async () => ['aq_1', 'aq_2'],
      publish: vi.fn(async (id: string) => {
        if (id === 'aq_1') throw new Error('403 origin not allowed');
        return undefined;
      }),
    });

    auto.request('a fish went in');
    await vi.advanceTimersByTimeAsync(3_000);

    // The second tank is published even though the first failed.
    expect(auto.state().failures.get('aq_1')).toMatch(/403 origin not allowed/);
    expect(auto.state().failures.has('aq_2')).toBe(false);
  });

  it('clears failures on resume, so the manual button can retry', async () => {
    const { auto } = scheduler({
      publish: vi.fn(async () => { throw new Error('nope'); }),
    });

    auto.request('a fish went in');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(auto.state().failures.size).toBe(1);

    auto.resume();
    expect(auto.state().failures.size).toBe(0);
  });

  it('survives the whole pass throwing', async () => {
    const { auto } = scheduler({ due: async () => { throw new Error('database is gone'); } });

    auto.request('a fish went in');
    await vi.advanceTimersByTimeAsync(3_000);

    expect(auto.state().running).toBe(false);
    expect(auto.state().lastRunAt).toBeDefined();
  });

  it('stops cleanly with a debounce pending', async () => {
    const { auto, publish } = scheduler();

    auto.request('a fish went in');
    auto.stop();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(publish).not.toHaveBeenCalled();
  });
});

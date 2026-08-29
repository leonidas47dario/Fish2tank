/**
 * Reveal cues.
 *
 * Runs in the node environment, which has no AudioContext and no
 * navigator.vibrate - which is exactly the case worth testing. These are
 * decoration over a saved record, and decoration that throws would take the
 * reveal down with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playBubbles, playStamp, resetAudioForTests, vibrateStamp } from './sound';

afterEach(() => {
  resetAudioForTests();
  vi.unstubAllGlobals();
});

describe('when muted', () => {
  it('never touches the audio API', () => {
    // The strongest form of "silent": the context is never even constructed.
    const Ctor = vi.fn();
    vi.stubGlobal('AudioContext', Ctor);
    playBubbles(true);
    playStamp(true);
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('never vibrates', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    vibrateStamp(true);
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('when the platform lacks the API', () => {
  it('stays silent instead of throwing', () => {
    // node has no AudioContext. Unmuted calls must still be safe.
    expect(() => playBubbles(false)).not.toThrow();
    expect(() => playStamp(false, true)).not.toThrow();
  });

  it('survives an AudioContext that throws on construction', () => {
    // Safari throws when one is built outside a user gesture.
    vi.stubGlobal('AudioContext', function Throwing() { throw new Error('needs a gesture'); });
    expect(() => playBubbles(false)).not.toThrow();
  });

  it('does not vibrate where navigator.vibrate is absent, as on iOS', () => {
    vi.stubGlobal('navigator', {});
    expect(() => vibrateStamp(false)).not.toThrow();
  });

  it('survives a vibrate blocked by permissions policy', () => {
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked'); } });
    expect(() => vibrateStamp(false)).not.toThrow();
  });
});

describe('when unmuted and supported', () => {
  /** Minimal AudioContext good enough to record what was scheduled. */
  function fakeAudio() {
    const started: number[] = [];
    const osc = () => ({
      type: 'sine',
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
      start: vi.fn((t: number) => started.push(t)),
      stop: vi.fn(),
    });
    const Ctor = vi.fn(function Fake(this: Record<string, unknown>) {
      this.currentTime = 0;
      this.destination = {};
      this.createOscillator = osc;
      this.createGain = () => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
      });
    });
    return { Ctor, started };
  }

  it('plays several staggered bubbles rather than one blip', () => {
    const { Ctor, started } = fakeAudio();
    vi.stubGlobal('AudioContext', Ctor);
    playBubbles(false);
    expect(started.length).toBeGreaterThan(2);
    // Staggered, not simultaneous — four identical blips at t=0 sound like a
    // machine rather than like water.
    expect(new Set(started).size).toBe(started.length);
  });

  it('gives golden an extra note', () => {
    const plain = fakeAudio();
    vi.stubGlobal('AudioContext', plain.Ctor);
    playStamp(false, false);
    const plainCount = plain.started.length;

    resetAudioForTests();
    const gold = fakeAudio();
    vi.stubGlobal('AudioContext', gold.Ctor);
    playStamp(false, true);
    expect(gold.started.length).toBeGreaterThan(plainCount);
  });

  it('reuses one context across cues', () => {
    // Browsers cap how many AudioContexts a page may hold.
    const { Ctor } = fakeAudio();
    vi.stubGlobal('AudioContext', Ctor);
    playBubbles(false);
    playStamp(false);
    expect(Ctor).toHaveBeenCalledTimes(1);
  });

  it('vibrates a longer pattern for golden', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    vibrateStamp(false, false);
    vibrateStamp(false, true);
    const [[plain], [golden]] = vibrate.mock.calls as [[number[]], [number[]]];
    expect(golden.length).toBeGreaterThan(plain.length);
  });
});

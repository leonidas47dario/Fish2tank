/**
 * Reveal cues: synthesized audio and haptics.
 *
 * PRD 7.5 asks for "optional haptic and sound" on the golden reveal. Everything
 * here is generated at runtime with oscillators rather than shipped as audio
 * files - no licensing question, nothing added to the bundle, and the tones can
 * be tuned by changing a number instead of re-recording.
 *
 * SILENCE IS THE DEFAULT. `muted` ships as true, so nothing here makes a noise
 * until the user turns it on. That is the right default for an app whose main
 * use is standing in someone's shop.
 *
 * EVERY BROWSER API HERE IS OPTIONAL. AudioContext does not exist in older
 * WebKit under that name and throws if constructed before a user gesture;
 * navigator.vibrate does not exist on iOS at all. A missing API must produce
 * silence, never an exception that takes the reveal down with it - the
 * ceremony is decoration, and decoration must not be able to break the record.
 */

type Ctor = typeof AudioContext;

/**
 * One context for the app, created lazily on first use.
 *
 * Browsers cap the number of AudioContexts and refuse to create one outside a
 * user gesture, so this is built on the first cue (which is always downstream
 * of a tap) and reused after.
 */
let ctx: AudioContext | undefined;
let unavailable = false;

function audio(): AudioContext | undefined {
  if (unavailable) return undefined;
  if (ctx) return ctx;
  try {
    const Ctor: Ctor | undefined =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctor) {
      unavailable = true;
      return undefined;
    }
    ctx = new Ctor();
    return ctx;
  } catch {
    // Constructed outside a gesture, or blocked by policy. Stop trying.
    unavailable = true;
    return undefined;
  }
}

interface ToneSpec {
  /** Hz at the start. */
  from: number;
  /** Hz at the end. A rising blip reads as a bubble, a falling one as a thud. */
  to: number;
  /** Seconds. */
  duration: number;
  /** Seconds from now. */
  delay?: number;
  /** Peak gain, 0-1. Kept low; this plays through a phone speaker. */
  peak?: number;
  type?: OscillatorType;
}

/**
 * One shaped tone.
 *
 * The gain envelope is the whole difference between a musical cue and a click:
 * a raw oscillator starting and stopping at full amplitude pops audibly, so
 * every tone ramps up over a few milliseconds and decays exponentially.
 */
function tone(spec: ToneSpec): void {
  const c = audio();
  if (!c) return;
  try {
    const t0 = c.currentTime + (spec.delay ?? 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    const peak = spec.peak ?? 0.06;

    osc.type = spec.type ?? 'sine';
    osc.frequency.setValueAtTime(spec.from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), t0 + spec.duration);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);

    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + spec.duration + 0.02);
  } catch {
    // A cue that cannot play is not an error worth surfacing.
  }
}

/** Short rising blips, like bubbles breaking the surface. */
export function playBubbles(muted: boolean): void {
  if (muted) return;
  // Slightly irregular spacing and pitch: four identical blips sound like a
  // machine, four scattered ones sound like water.
  const bubbles = [
    { from: 420, to: 760, delay: 0 },
    { from: 500, to: 900, delay: 0.07 },
    { from: 380, to: 700, delay: 0.13 },
    { from: 560, to: 1020, delay: 0.22 },
  ];
  for (const b of bubbles) {
    tone({ ...b, duration: 0.14, peak: 0.05 });
  }
}

/**
 * The tier stamp: a warm two-note chime, a fifth apart.
 *
 * Golden gets a third note on top, so the treatment is audibly different
 * without being a different sound.
 */
export function playStamp(muted: boolean, golden = false): void {
  if (muted) return;
  tone({ from: 523.25, to: 523.25, duration: 0.5, peak: 0.07, type: 'triangle' });
  tone({ from: 783.99, to: 783.99, duration: 0.55, delay: 0.09, peak: 0.06, type: 'triangle' });
  if (golden) {
    tone({ from: 1046.5, to: 1046.5, duration: 0.7, delay: 0.18, peak: 0.05, type: 'triangle' });
  }
}

/**
 * A short haptic on the stamp.
 *
 * Deliberately tied to the same mute switch as the audio rather than a
 * separate setting: both are "should this app make itself felt in a quiet
 * shop?", and one control for one question is the honest design.
 */
export function vibrateStamp(muted: boolean, golden = false): void {
  if (muted) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(golden ? [18, 40, 18, 40, 32] : [18, 40, 28]);
  } catch {
    // Unsupported or blocked by a permissions policy.
  }
}

/** Test seam: forget the cached context so a fresh one is built next time. */
export function resetAudioForTests(): void {
  ctx = undefined;
  unavailable = false;
}

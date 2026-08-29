/**
 * The species unlock ceremony - PRD 7.5.
 *
 * "Species unlock: short card rise, bubble burst, name reveal, and tier stamp;
 * target under three seconds and always skippable."
 *
 * Four beats on a timeline, not one animation, because the spec names four
 * distinct moments and the tier stamp has to land last - the tier is the
 * payoff, and it reads as a payoff only if the name got there first.
 *
 * THREE RULES THAT ARE NOT NEGOTIABLE, each covered by a test:
 *
 *   1. Skippable at any frame. Tap, click, Escape or the button all jump
 *      straight to the final state. FR-R04: "Reveal never blocks saving."
 *   2. Reduced motion means NO motion, not fast motion. The component mounts
 *      in its final state and no timers are ever set.
 *   3. The record already exists. `revealSpecimen()` has written the snapshot
 *      before this renders, so nothing here can fail in a way that loses data.
 *      This is decoration over a fact, and it is built so it cannot be
 *      anything else.
 *
 * NFR-06: tier is carried by text and shape as well as colour, so the reveal
 * still reads in greyscale.
 */
import { useEffect, useRef, useState } from 'react';
import type { RaritySnapshot } from '@/domain/types';
import { usePrefersReducedMotion, useTheme } from '@/theme/ThemeProvider';
import { playBubbles, playStamp, vibrateStamp } from '../sound';

/**
 * The beats, in order. Cumulative milliseconds from the start.
 *
 * The whole run finishes at 2,150ms, inside the PRD's three-second budget with
 * room for a slow phone to miss a few frames and still land in time.
 */
const BEATS = { card: 0, bubbles: 380, name: 900, tier: 1500, done: 2150 } as const;
type Beat = keyof typeof BEATS;

const ORDER: Beat[] = ['card', 'bubbles', 'name', 'tier', 'done'];

/** Fixed bubble geometry — random per render would make the test unrepeatable. */
const BUBBLES = [
  { left: 8, size: 10, delay: 0 }, { left: 20, size: 16, delay: 90 },
  { left: 31, size: 8, delay: 40 }, { left: 43, size: 20, delay: 150 },
  { left: 52, size: 12, delay: 70 }, { left: 61, size: 9, delay: 200 },
  { left: 70, size: 18, delay: 30 }, { left: 78, size: 11, delay: 130 },
  { left: 86, size: 14, delay: 180 }, { left: 93, size: 8, delay: 60 },
  { left: 15, size: 13, delay: 240 }, { left: 66, size: 10, delay: 260 },
];

interface Props {
  snapshot: RaritySnapshot;
  commonName: string;
  scientificName?: string;
  golden?: boolean;
  /** Fired once the ceremony reaches its final state, however it got there. */
  onDone?: () => void;
}

export function RevealCeremony({ snapshot, commonName, scientificName, golden, onDone }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const { muted } = useTheme();

  // Reduced motion starts finished. Not a shorter animation - none at all.
  const [beat, setBeat] = useState<Beat>(reducedMotion ? 'done' : 'card');
  const timers = useRef<number[]>([]);
  const announced = useRef(false);

  const finish = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    setBeat('done');
  };

  useEffect(() => {
    if (reducedMotion) return;
    timers.current = ORDER.slice(1).map((b) =>
      window.setTimeout(() => setBeat(b), BEATS[b]),
    );
    return () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, [reducedMotion]);

  // Cues ride the beats rather than the clock, so skipping does not leave a
  // chime playing over a finished card.
  useEffect(() => {
    if (reducedMotion) return;
    if (beat === 'bubbles') playBubbles(muted);
    if (beat === 'tier') {
      playStamp(muted, golden);
      vibrateStamp(muted, golden);
    }
  }, [beat, muted, golden, reducedMotion]);

  useEffect(() => {
    if (beat !== 'done' || announced.current) return;
    announced.current = true;
    onDone?.();
  }, [beat, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reached = (b: Beat) => ORDER.indexOf(beat) >= ORDER.indexOf(b);
  const running = beat !== 'done';

  return (
    /* Not a <button>: it wraps headings and a definition list, which a button
       may not contain. Explicit role and key handling instead. */
    <div
      className={[
        'reveal',
        golden ? 'reveal--golden' : '',
        reducedMotion ? 'reveal--still' : '',
      ].filter(Boolean).join(' ')}
      data-beat={beat}
      data-testid="reveal-ceremony"
      onClick={running ? finish : undefined}
      role={running ? 'button' : undefined}
      tabIndex={running ? 0 : undefined}
      onKeyDown={running ? (e) => { if (e.key === 'Enter' || e.key === ' ') finish(); } : undefined}
      aria-label={running ? 'Skip the reveal' : undefined}
    >
      {/* One live region announcing the outcome, not each beat. A screen
          reader should hear the result, not the choreography. */}
      <p className="visually-hidden" aria-live="polite">
        {reached('tier')
          ? `${commonName}. Discovery tier ${snapshot.tier}, ${snapshot.totalScore} out of 100.`
          : ''}
      </p>

      {!reducedMotion && reached('bubbles') && (
        <span className="reveal__bubbles" aria-hidden="true">
          {BUBBLES.map((b, i) => (
            <span
              key={i}
              className="reveal__bubble"
              style={{
                left: `${b.left}%`,
                width: `${b.size}px`,
                height: `${b.size}px`,
                animationDelay: `${b.delay}ms`,
              }}
            />
          ))}
        </span>
      )}

      <div className="reveal__card">
        {/* "New species" is read off the score component that awards it, not
            recomputed here — one source of truth for what counts as a first. */}
        <p className="reveal__eyebrow">
          {snapshot.components.firstConfirmedSpecies > 0 ? 'New species' : 'Caught again'}
        </p>

        <div className={`reveal__name ${reached('name') ? 'is-in' : ''}`}>
          <h2>{commonName}</h2>
          {scientificName && <p className="sci muted small">{scientificName}</p>}
        </div>

        <div className={`reveal__tier ${reached('tier') ? 'is-in' : ''}`}>
          {/* Glyph + word + score. Colour is the fourth cue, never the only one. */}
          <span className={`tier tier--${snapshot.tier}`}>
            <span aria-hidden="true">{golden ? '★' : '◆'}</span>
            {snapshot.tier}
          </span>
          <span className="data reveal__score">{snapshot.totalScore} / 100</span>
        </div>
      </div>

      {running && (
        <button type="button" className="btn--ghost xs reveal__skip" onClick={(e) => { e.stopPropagation(); finish(); }}>
          Skip
        </button>
      )}
    </div>
  );
}

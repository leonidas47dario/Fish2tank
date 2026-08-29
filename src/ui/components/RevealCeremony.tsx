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
import type { CatalogCard } from '@/data/catalog';
import { formatVolume } from '@/domain/units';
import { usePrefersReducedMotion, useTheme } from '@/theme/ThemeProvider';
import { playBubbles, playStamp, vibrateStamp } from '../sound';
import { Plate, useCardArt } from './Plate';

const ZONE_LABEL: Record<string, string> = {
  top: 'Top dweller', mid: 'Mid-water', bottom: 'Bottom dweller', 'all-levels': 'All levels',
};

/**
 * The care facts this species actually has.
 *
 * Built as a list rather than a fixed set of slots for the reason Tile.tsx
 * records: the catalog has both adult size and minimum tank for 92 of 2,178
 * species, so a fixed layout draws a gap on almost every fish. An absent fact
 * is not rendered at all - never a dash, never "unknown".
 */
function careFacts(species: CatalogCard['species']): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  if (species.adultSizeIn !== undefined) {
    facts.push({ label: 'Adult size', value: `${Math.round(species.adultSizeIn * 10) / 10}"` });
  }
  if (species.minVolumeGal !== undefined) {
    facts.push({
      label: 'Minimum tank',
      value: formatVolume({ value: species.minVolumeGal, unit: 'gal' }),
    });
  }
  if (species.aggression) facts.push({ label: 'Temperament', value: species.aggression });
  if (species.tempMinC !== undefined && species.tempMaxC !== undefined) {
    facts.push({ label: 'Temperature', value: `${species.tempMinC}–${species.tempMaxC}°C` });
  }
  if (species.waterZone) {
    facts.push({ label: 'Swims', value: ZONE_LABEL[species.waterZone] ?? species.waterZone });
  }
  return facts;
}

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
  /**
   * The rating, when there is one.
   *
   * Optional as of v0.3.0. 1,703 of 2,178 species have no shelf evidence, so
   * the common reveal has a profile and no tier - and that is a real outcome
   * to be shown, not a failure to be hidden. The ceremony still runs; the
   * fourth beat stamps a refusal instead of a tier.
   */
  snapshot?: RaritySnapshot;
  /** Why there is no tier. Present exactly when `snapshot` is absent. */
  unrated?: { reason: string; explanation: string };
  /** The species, so the reveal can show the profile and not just the name. */
  card: CatalogCard;
  /** Drives the eyebrow. A fact about the collection, not about the score. */
  isFirstOfSpecies: boolean;
  golden?: boolean;
  /** Fired once the ceremony reaches its final state, however it got there. */
  onDone?: () => void;
}

export function RevealCeremony({
  snapshot, unrated, card, isFirstOfSpecies, golden, onDone,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const { muted } = useTheme();
  const { art, ownUrl } = useCardArt(card);
  const species = card.species;
  const facts = careFacts(species);

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
          ? snapshot
            ? `${species.commonName}. Discovery tier ${snapshot.tier}, ${snapshot.totalScore} out of 100.`
            : `${species.commonName}. Not rated. ${unrated?.reason ?? ''}`
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
        <p className="reveal__eyebrow">{isFirstOfSpecies ? 'New species' : 'Caught again'}</p>

        {/* The profile, not just the name.
​
            Composed from Plate and the conditional fact line rather than the
            old collectible card, which the Drawer rebuild deleted for a
            measured reason (see Tile.tsx): its structure was three numbers and
            nineteen species in twenty have at most one of them. Every fact
            below is drawn only if it exists. Nothing is a placeholder. */}
        <div className={`reveal__name ${reached('name') ? 'is-in' : ''}`}>
          <Plate
            speciesId={species.speciesId}
            art={art}
            ownUrl={ownUrl}
            alt={`${species.commonName}`}
            className="reveal__plate"
          />
          <h2>{species.commonName}</h2>
          {species.scientificName && <p className="sci muted small">{species.scientificName}</p>}

          {facts.length > 0 && (
            <dl className="reveal__facts">
              {facts.map((f) => (
                <div key={f.label} className="reveal__fact">
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className={`reveal__tier ${reached('tier') ? 'is-in' : ''}`}>
          {snapshot ? (
            <>
              {/* Glyph + word + score. Colour is the fourth cue, never the only one. */}
              <span className={`tier tier--${snapshot.tier}`}>
                <span aria-hidden="true">{golden ? '★' : '◆'}</span>
                {snapshot.tier}
              </span>
              <span className="data reveal__score">{snapshot.totalScore} / 100</span>
            </>
          ) : (
            /* No tier, and the reason rather than a zero. A zero would read as
               "widely available", which is the opposite of what the silence
               means - see market-scarcity.ts, "Absence is not evidence". */
            <span className="tier tier--unrated">
              <span aria-hidden="true">◇</span>
              Not rated
            </span>
          )}
        </div>

        {!snapshot && unrated && (
          <p className={`reveal__unrated xs muted ${reached('tier') ? 'is-in' : ''}`}>
            {unrated.explanation}
          </p>
        )}
      </div>

      {running && (
        <button type="button" className="btn--ghost xs reveal__skip" onClick={(e) => { e.stopPropagation(); finish(); }}>
          Skip
        </button>
      )}
    </div>
  );
}

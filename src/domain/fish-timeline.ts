/**
 * A kept fish as one dated stream - ENH-12, spec 037.
 *
 * WHAT THIS IS. Four sources are already dated and three are already written
 * by the app: life events (`occurredOn`), photographs (`capturedAt`),
 * memorials (`occurredOn`), and now measurements (`observedOn`). Merging them
 * needs no new storage, which is why every existing collection gets a timeline
 * the day this ships without anybody entering anything.
 *
 * PURE, like everything in `domain/`. No clock, no database, no `Date.now()` -
 * `asOf` is passed in, so a span rendered from a stored snapshot is the same
 * number tomorrow.
 *
 * WHERE P6 BITES. Relative labels ("+1 month") need an acquisition date, and
 * the honest one is often missing. `holding.createdAt` is the tempting default
 * and is never used at any rung: for the 61 imported inventory rows it is the
 * minute a spreadsheet was read in 2026, so a fish kept three years would
 * render "together for 2 days". A plausible-looking number that is false is
 * exactly what P6 forbids.
 */
import type {
  CalendarDate, Holding, HoldingMeasurement, Id, KeeperNote, LengthMeasurement,
  LifeEvent, Media, Memorial, Residency,
} from './types';

export type TimelineEntryKind = 'event' | 'photo' | 'measurement' | 'note' | 'memorial';

export interface TimelineEntry {
  id: Id;
  kind: TimelineEntryKind;
  /** The calendar day this happened, as `YYYY-MM-DD`. */
  on: CalendarDate;
  event?: LifeEvent;
  media?: Media;
  measurement?: HoldingMeasurement;
  note?: KeeperNote;
  memorial?: Memorial;
}

/** Where an acquisition date came from, so the UI can say how sure it is. */
export type AnchorSource = 'recorded' | 'acquired-event' | 'first-photo';

export interface Anchor {
  on: CalendarDate;
  source: AnchorSource;
  /**
   * True when the date is only a LOWER BOUND - the fish existed by then, but
   * may have come home long before. Drives "photographed since March" rather
   * than "acquired in March", which would be a claim nobody made.
   */
  lowerBound: boolean;
}

/** `Media.capturedAt` is an instant; the timeline works in calendar days. */
export function dayOf(instant: string): CalendarDate {
  return instant.slice(0, 10);
}

/**
 * When this fish came home, and how much that answer is worth.
 *
 * The ladder, best evidence first. Returns `undefined` rather than guessing,
 * and the caller renders absolute dates only - which is the honest outcome for
 * an imported row nobody has dated.
 */
export function acquisitionAnchor(
  holding: Pick<Holding, 'acquiredOn'>,
  events: LifeEvent[],
  media: Media[],
): Anchor | undefined {
  if (holding.acquiredOn) {
    return { on: holding.acquiredOn, source: 'recorded', lowerBound: false };
  }

  const acquired = events
    .filter((e) => e.type === 'acquired')
    .map((e) => e.occurredOn)
    .sort()[0];
  if (acquired) return { on: acquired, source: 'acquired-event', lowerBound: false };

  const earliestPhoto = media.map((m) => dayOf(m.capturedAt)).sort()[0];
  if (earliestPhoto) return { on: earliestPhoto, source: 'first-photo', lowerBound: true };

  return undefined;
}

/**
 * Whole days between two calendar dates, or `undefined` when either is absent.
 *
 * NEVER NEGATIVE: a photograph dated before the acquisition it is measured
 * against is a data problem, and "together for -4 days" is worse than saying
 * nothing. Parsed as UTC so a timezone cannot shift a day boundary.
 */
export function daysBetween(from?: CalendarDate, to?: CalendarDate): number | undefined {
  if (!from || !to) return undefined;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  const days = Math.round((b - a) / 86_400_000);
  return days < 0 ? undefined : days;
}

/**
 * Everything known about one holding, newest first.
 *
 * Ties break by kind so a day holding several records reads in the order the
 * day happened: the event first, then what was seen, then what was measured.
 */
export function fishTimeline(input: {
  holdingId: Id;
  events: LifeEvent[];
  media: Media[];
  measurements: HoldingMeasurement[];
  memorials: Memorial[];
  /** Spec 046. Dated notes, which are observations like any other. */
  notes?: KeeperNote[];
}): TimelineEntry[] {
  const { holdingId } = input;

  const entries: TimelineEntry[] = [
    ...input.events
      .filter((e) => e.holdingId === holdingId)
      .map((e): TimelineEntry => ({ id: e.id, kind: 'event', on: e.occurredOn, event: e })),
    ...input.media
      .map((m): TimelineEntry => ({ id: m.id, kind: 'photo', on: dayOf(m.capturedAt), media: m })),
    ...input.measurements
      .filter((x) => x.holdingId === holdingId)
      .map((x): TimelineEntry => ({ id: x.id, kind: 'measurement', on: x.observedOn, measurement: x })),
    ...(input.notes ?? [])
      .filter((x) => x.holdingId === holdingId)
      .map((x): TimelineEntry => ({ id: x.id, kind: 'note', on: x.writtenOn, note: x })),
    ...input.memorials
      .filter((x) => x.holdingId === holdingId)
      .map((x): TimelineEntry => ({ id: x.id, kind: 'memorial', on: x.occurredOn, memorial: x })),
  ];

  // A day reads in the order it happened: the event, then what was seen, then
  // what was measured, then what was written about it, then the ending.
  const rank: Record<TimelineEntryKind, number> = {
    event: 0, photo: 1, measurement: 2, note: 3, memorial: 4,
  };

  return entries.sort((a, b) =>
    b.on.localeCompare(a.on) || rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id));
}

/**
 * The measurement a photo was taken from, keyed by photo - but ONLY when the
 * two happened on the same day.
 *
 * The point of pairing is that "photographed" and "2.6 in" on one day are one
 * fact, not two rows. THE SAME-DAY CONDITION IS NOT FUSSINESS: a measurement
 * links to a photo by `mediaId`, and nothing stops that photo having been
 * taken months earlier or later. Rendering the measurement on the photo's row
 * would then print it under a date on which nobody measured anything - which
 * is the same class of untruth P6 forbids, arrived at by a layout decision.
 *
 * When the dates differ the two stay separate rows, each under its own date,
 * which is what actually happened.
 */
export function measurementsByMedia(
  measurements: HoldingMeasurement[],
  media: Media[],
): Map<Id, HoldingMeasurement> {
  const dayById = new Map(media.map((m) => [m.id, dayOf(m.capturedAt)]));
  const byMedia = new Map<Id, HoldingMeasurement>();
  for (const m of measurements) {
    if (!m.mediaId) continue;
    if (dayById.get(m.mediaId) !== m.observedOn) continue;
    byMedia.set(m.mediaId, m);
  }
  return byMedia;
}

/**
 * First and last measurement, for FH-4.
 *
 * Returns both only when there are two DISTINCT observations: one measurement
 * is a size, not a growth, and reporting "grew 0 in" from a single data point
 * would be inventing a second one.
 */
export function lengthSpan(measurements: HoldingMeasurement[]): {
  first?: HoldingMeasurement; last?: HoldingMeasurement;
} {
  const withLength = [...measurements]
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn) || a.id.localeCompare(b.id));

  if (withLength.length === 0) return {};
  if (withLength.length === 1) return { first: withLength[0] };
  return { first: withLength[0], last: withLength[withLength.length - 1] };
}


/**
 * What a memorial page can say about a life - spec 046.
 *
 * PURE, and every field is optional on purpose: a fish with no acquisition
 * date has no span, and one measured once has no growth. Absent is the honest
 * answer and the page renders it as absent (P6), rather than reaching for a
 * plausible substitute.
 */
export interface LifeSummary {
  /** Where the start date came from, so the page can say how sure it is. */
  anchor?: Anchor;
  died: CalendarDate;
  /** Whole days together, only when BOTH ends are real. */
  days?: number;
  /** Two sizes, only when there are two measurements. Never a percentage. */
  grew?: { from: LengthMeasurement; to: LengthMeasurement };
  /** The last photograph taken, which is the one a keeper looks for. */
  lastPhoto?: Media;
  photos: number;
  /**
   * Tanks lived in, oldest first, deduplicated.
   *
   * FROM RESIDENCIES, NOT FROM MOVE EVENTS. Spec 046 read `fromAquariumId` and
   * `toAquariumId` off the life events, which records only the MOVES - so a
   * fish that lived in one tank its whole life and never moved had no tanks at
   * all, and the memorial page simply omitted the row. Residencies are what
   * actually record where a fish lived; a move is the transition between two
   * of them. Found by spec 048, which needed this row to link back to the
   * tank.
   */
  tanks: Id[];
}

export function summariseLife(input: {
  holding: Pick<Holding, 'acquiredOn'>;
  memorial: Memorial;
  events: LifeEvent[];
  media: Media[];
  measurements: HoldingMeasurement[];
  /** Where it actually lived. See `LifeSummary.tanks`. */
  residencies?: Residency[];
}): LifeSummary {
  const anchor = acquisitionAnchor(input.holding, input.events, input.media);
  const span = lengthSpan(input.measurements);

  const photos = [...input.media]
    .filter((m) => m.kind === 'photo')
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  /*
   * A lower-bound anchor still gives a span, because "at least this long" is
   * true and useful - the PAGE says which it is, using `anchor.lowerBound`.
   * Hiding it would lose a real fact to avoid a wording problem.
   */
  const days = daysBetween(anchor?.on, input.memorial.occurredOn);

  const tanks: Id[] = [];
  for (const r of [...(input.residencies ?? [])]
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))) {
    if (!tanks.includes(r.aquariumId)) tanks.push(r.aquariumId);
  }

  return {
    anchor,
    died: input.memorial.occurredOn,
    days,
    // Both ends, or nothing. One measurement is a size, not a growth.
    grew: span.first?.length && span.last?.length
      ? { from: span.first.length, to: span.last.length }
      : undefined,
    lastPhoto: photos[photos.length - 1],
    photos: photos.length,
    tanks,
  };
}

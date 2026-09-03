import { describe, expect, it } from 'vitest';
import {
  acquisitionAnchor, daysBetween, fishTimeline, lengthSpan, measurementsByMedia,
} from './fish-timeline';
import type { HoldingMeasurement, LifeEvent, Media, Memorial } from './types';

/**
 * Spec 037. The rules worth guarding are the ones about what the app is
 * allowed to CLAIM: which dates count as evidence, which are only a lower
 * bound, and which must never be used at all.
 */

const HOLDING = 'hold_1';

const event = (over: Partial<LifeEvent> & Pick<LifeEvent, 'id' | 'type' | 'occurredOn'>): LifeEvent => ({
  holdingId: HOLDING, quantityDelta: 0, createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const photo = (id: string, capturedAt: string): Media => ({
  id, kind: 'photo', specimenIds: [], originalBlobKey: `blob_${id}`, originalBytes: 1,
  mimeType: 'image/jpeg', capturedAt, syncState: 'synced',
});
const measured = (over: Partial<HoldingMeasurement> & Pick<HoldingMeasurement, 'id' | 'observedOn'>): HoldingMeasurement => ({
  holdingId: HOLDING, length: { value: 2, unit: 'in' },
  createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('acquisitionAnchor', () => {
  it('prefers what the keeper recorded', () => {
    const anchor = acquisitionAnchor(
      { acquiredOn: '2023-04-01' },
      [event({ id: 'e1', type: 'acquired', occurredOn: '2026-08-30' })],
      [photo('m1', '2024-01-01T00:00:00.000Z')],
    );

    expect(anchor).toEqual({ on: '2023-04-01', source: 'recorded', lowerBound: false });
  });

  it('falls back to an acquired event', () => {
    const anchor = acquisitionAnchor({}, [
      event({ id: 'e2', type: 'acquired', occurredOn: '2025-06-02' }),
      event({ id: 'e1', type: 'acquired', occurredOn: '2025-03-11' }),
    ], []);

    // The earliest, not whichever was stored first.
    expect(anchor).toEqual({ on: '2025-03-11', source: 'acquired-event', lowerBound: false });
  });

  it('MARKS A PHOTO DATE AS A LOWER BOUND, because it is not an acquisition', () => {
    // The fish existed by then. It may have come home years earlier. The UI
    // reads this flag to say "photographed since" rather than "acquired in".
    const anchor = acquisitionAnchor({}, [], [
      photo('m2', '2025-09-09T12:00:00.000Z'),
      photo('m1', '2025-03-04T08:00:00.000Z'),
    ]);

    expect(anchor).toEqual({ on: '2025-03-04', source: 'first-photo', lowerBound: true });
  });

  it('RETURNS NOTHING rather than reaching for createdAt', () => {
    // The whole point. `createdAt` for an imported row is the minute a
    // spreadsheet was read, which would render a three-year-old fish as
    // "together for 2 days" - plausible, and false.
    expect(acquisitionAnchor({}, [], [])).toBeUndefined();
  });

  it('ignores life events that are not an acquisition', () => {
    const anchor = acquisitionAnchor({}, [
      event({ id: 'e1', type: 'moved', occurredOn: '2025-01-01' }),
      event({ id: 'e2', type: 'deceased', occurredOn: '2025-02-01' }),
    ], []);

    expect(anchor).toBeUndefined();
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-01-01', '2026-03-02')).toBe(60);
  });

  it('REFUSES A NEGATIVE SPAN rather than rendering one', () => {
    // "Together for -4 days" is worse than saying nothing at all.
    expect(daysBetween('2026-05-01', '2026-04-27')).toBeUndefined();
  });

  it('is undefined when either end is missing', () => {
    expect(daysBetween(undefined, '2026-01-01')).toBeUndefined();
    expect(daysBetween('2026-01-01', undefined)).toBeUndefined();
  });

  it('does not let a timezone move a day boundary', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1);
  });
});

describe('fishTimeline', () => {
  const media = [photo('m1', '2026-01-03T09:00:00.000Z'), photo('m2', '2026-03-02T09:00:00.000Z')];
  const events = [
    event({ id: 'e1', type: 'acquired', occurredOn: '2026-01-03' }),
    event({ id: 'e2', type: 'moved', occurredOn: '2026-02-20' }),
  ];
  const measurements = [
    measured({ id: 'x1', observedOn: '2026-02-14', length: { value: 2.1, unit: 'in' } }),
  ];
  const memorials: Memorial[] = [{
    id: 'mem1', holdingId: HOLDING, occurredOn: '2026-04-19', quantity: 1,
    suspectedContributors: [], causeConfidence: 'unknown', createdAt: '2026-04-19T00:00:00.000Z',
  }];

  it('merges four sources into one stream, newest first', () => {
    const out = fishTimeline({ holdingId: HOLDING, events, media, measurements, memorials });

    expect(out.map((e) => [e.on, e.kind])).toEqual([
      ['2026-04-19', 'memorial'],
      ['2026-03-02', 'photo'],
      ['2026-02-20', 'event'],
      ['2026-02-14', 'measurement'],
      ['2026-01-03', 'event'],
      ['2026-01-03', 'photo'],
    ]);
  });

  it('puts the event before the photograph when both fall on one day', () => {
    const out = fishTimeline({ holdingId: HOLDING, events, media, measurements, memorials });
    const sameDay = out.filter((e) => e.on === '2026-01-03');

    expect(sameDay.map((e) => e.kind)).toEqual(['event', 'photo']);
  });

  it('never shows another holding\'s events, measurements or memorial', () => {
    const out = fishTimeline({
      holdingId: HOLDING,
      events: [...events, event({ id: 'e9', type: 'acquired', occurredOn: '2026-06-06', holdingId: 'hold_other' })],
      media: [],
      measurements: [...measurements, measured({ id: 'x9', observedOn: '2026-06-06', holdingId: 'hold_other' })],
      memorials: [...memorials, { ...memorials[0]!, id: 'mem9', holdingId: 'hold_other' }],
    });

    expect(out.map((e) => e.id)).not.toContain('e9');
    expect(out.map((e) => e.id)).not.toContain('x9');
    expect(out.map((e) => e.id)).not.toContain('mem9');
  });

  it('is empty for a fish with nothing recorded, rather than throwing', () => {
    expect(fishTimeline({
      holdingId: HOLDING, events: [], media: [], measurements: [], memorials: [],
    })).toEqual([]);
  });

  it('builds a timeline from photos alone, which is what every old record has', () => {
    // The reason this ships useful on day one: nobody has to enter anything.
    const out = fishTimeline({
      holdingId: HOLDING, events: [], media, measurements: [], memorials: [],
    });

    expect(out).toHaveLength(2);
    expect(out.every((e) => e.kind === 'photo')).toBe(true);
  });
});

describe('measurementsByMedia', () => {
  it('pairs a measurement with the photo it was read from', () => {
    const byMedia = measurementsByMedia(
      [
        measured({ id: 'x1', observedOn: '2026-02-14', mediaId: 'm1' }),
        measured({ id: 'x2', observedOn: '2026-03-01' }),
      ],
      [photo('m1', '2026-02-14T10:00:00.000Z')],
    );

    expect(byMedia.get('m1')?.id).toBe('x1');
    expect(byMedia.size).toBe(1);
  });

  it('REFUSES TO PAIR ACROSS DAYS, so nothing renders under a date nobody measured on', () => {
    // A measurement links to a photo by id, and nothing stops that photo
    // having been taken months earlier. Drawing "2.8 in" on the photo's row
    // would print it under a date on which nobody measured anything - the
    // same untruth P6 forbids, arrived at by a layout decision.
    const byMedia = measurementsByMedia(
      [measured({ id: 'x1', observedOn: '2026-04-04', mediaId: 'm1' })],
      [photo('m1', '2026-09-02T10:00:00.000Z')],
    );

    expect(byMedia.size).toBe(0);
  });

  it('does not pair a measurement whose photo is gone', () => {
    const byMedia = measurementsByMedia(
      [measured({ id: 'x1', observedOn: '2026-02-14', mediaId: 'deleted' })],
      [],
    );

    expect(byMedia.size).toBe(0);
  });
});

describe('lengthSpan', () => {
  it('gives both ends once there are two observations', () => {
    const span = lengthSpan([
      measured({ id: 'x2', observedOn: '2026-04-04', length: { value: 2.8, unit: 'in' } }),
      measured({ id: 'x1', observedOn: '2026-02-14', length: { value: 2.1, unit: 'in' } }),
    ]);

    expect(span.first?.id).toBe('x1');
    expect(span.last?.id).toBe('x2');
  });

  it('gives ONE END ONLY for a single observation, so nothing renders as growth', () => {
    // A size is not a growth. "Grew 0 in" would be inventing a second reading.
    const span = lengthSpan([measured({ id: 'x1', observedOn: '2026-02-14', length: { value: 2.1, unit: 'in' } })]);

    expect(span.first?.id).toBe('x1');
    expect(span.last).toBeUndefined();
  });

  it('is empty when there are no measurements at all', () => {
    expect(lengthSpan([])).toEqual({});
  });
});

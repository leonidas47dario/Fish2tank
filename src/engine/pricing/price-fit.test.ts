import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CONFIG, evaluatePriceFit, median } from './price-fit';
import type { PriceObservation } from '@/domain/types';

const SPECIES = 'sp_jaguar';

function obs(over: Partial<PriceObservation> & { id: string }): PriceObservation {
  return {
    speciesId: SPECIES,
    currency: 'USD',
    basis: 'each',
    packageQuantity: 1,
    observedAt: '2026-08-01T12:00:00.000Z',
    observedSize: { value: 6, unit: 'in' },
    source: 'in-store',
    askingPrice: 60,
    ...over,
  };
}

const subject = obs({
  id: 'p_subject',
  askingPrice: 100,
  memberPrice: 75,
  observedAt: '2026-08-27T15:00:00.000Z',
  observedSize: { value: 6, unit: 'in' },
});

describe('median helper', () => {
  it('handles odd counts', () => expect(median([3, 1, 2])).toBe(2));
  it('averages the middle pair on even counts', () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe('sample threshold (FR-P04)', () => {
  it('refuses to publish a median below the minimum sample count', () => {
    const r = evaluatePriceFit({ subject, candidates: [obs({ id: 'a' }), obs({ id: 'b' })] });
    expect(r.status).toBe('insufficient-comparison-data');
    expect(r.comparison).toBeUndefined();
    expect(r.message).toMatch(/Insufficient comparison data/);
  });

  it('always reports the sample count, even when it is too small', () => {
    const r = evaluatePriceFit({ subject, candidates: [obs({ id: 'a' })] });
    expect(r.sampleCount).toBe(1);
    expect(r.minimumSampleCount).toBe(DEFAULT_PRICE_CONFIG.minimumSampleCount);
  });

  it('publishes a median once the threshold is met', () => {
    const r = evaluatePriceFit({
      subject,
      candidates: [obs({ id: 'a', askingPrice: 60 }), obs({ id: 'b', askingPrice: 80 }), obs({ id: 'c', askingPrice: 70 })],
    });
    expect(r.status).toBe('compared');
    expect(r.comparison!.median).toBe(70);
    expect(r.comparison!.min).toBe(60);
    expect(r.comparison!.max).toBe(80);
  });

  it('shows the subject facts even when no comparison is possible', () => {
    const r = evaluatePriceFit({ subject, candidates: [] });
    expect(r.status).toBe('insufficient-comparison-data');
    expect(r.subject.sticker).toBe(100);
    expect(r.subject.memberPrice).toBe(75);
  });
});

describe('ask / member / paid stay separate (FR-P03)', () => {
  it('retains the jaguar example: $100 asking and $75 member, neither overwriting the other', () => {
    const r = evaluatePriceFit({ subject, candidates: [] });
    expect(r.subject.sticker).toBe(100);
    expect(r.subject.memberPrice).toBe(75);
    expect(r.subject.effective).toBe(75);
  });

  it('falls back to asking price when there is no membership price', () => {
    const r = evaluatePriceFit({ subject: obs({ id: 's', askingPrice: 50, memberPrice: undefined }), candidates: [] });
    expect(r.subject.effective).toBe(50);
  });

  it('keeps paid price distinct from both', () => {
    const r = evaluatePriceFit({ subject: obs({ id: 's', askingPrice: 100, memberPrice: 75, paidPrice: 70 }), candidates: [] });
    expect(r.subject.paidPrice).toBe(70);
    expect(r.subject.sticker).toBe(100);
  });
});

describe('basis normalization (FR-C06, FR-P04)', () => {
  it('converts a pair price to a per-fish price', () => {
    const r = evaluatePriceFit({
      subject: obs({ id: 's', askingPrice: 100, basis: 'pair', packageQuantity: 2, memberPrice: undefined }),
      candidates: [],
    });
    expect(r.subject.unitPrice).toBe(50);
  });

  it('converts a lot price to a per-fish price', () => {
    const r = evaluatePriceFit({
      subject: obs({ id: 's', askingPrice: 90, basis: 'lot', packageQuantity: 6, memberPrice: undefined }),
      candidates: [],
    });
    expect(r.subject.unitPrice).toBe(15);
  });

  it('excludes an observation with no package quantity rather than guessing', () => {
    const r = evaluatePriceFit({
      subject,
      candidates: [obs({ id: 'a', basis: 'lot', packageQuantity: 0 }), obs({ id: 'b' }), obs({ id: 'c' }), obs({ id: 'd' })],
    });
    expect(r.excluded).toContainEqual({ observationId: 'a', reason: 'missing-package-quantity' });
    expect(r.sampleCount).toBe(3);
  });

  it('compares a normalized pair price against per-fish observations', () => {
    const r = evaluatePriceFit({
      subject,
      candidates: [
        obs({ id: 'a', askingPrice: 140, basis: 'pair', packageQuantity: 2 }), // 70 each
        obs({ id: 'b', askingPrice: 70 }),
        obs({ id: 'c', askingPrice: 70 }),
      ],
    });
    expect(r.comparison!.median).toBe(70);
  });
});

describe('comparability filters (PRD 5.4)', () => {
  it('excludes a different species', () => {
    const r = evaluatePriceFit({ subject, candidates: [obs({ id: 'a', speciesId: 'sp_other' })] });
    expect(r.excluded).toContainEqual({ observationId: 'a', reason: 'different-species' });
  });

  it('excludes a different currency', () => {
    const r = evaluatePriceFit({ subject, candidates: [obs({ id: 'a', currency: 'EUR' })] });
    expect(r.excluded).toContainEqual({ observationId: 'a', reason: 'different-currency' });
  });

  it('excludes an observation outside the date window', () => {
    const r = evaluatePriceFit({ subject, candidates: [obs({ id: 'a', observedAt: '2020-01-01T00:00:00.000Z' })] });
    expect(r.excluded).toContainEqual({ observationId: 'a', reason: 'outside-date-window' });
  });

  it('excludes a specimen of a very different size', () => {
    // Subject is 6in; a 2in juvenile is 67% away, past the 50% tolerance.
    const r = evaluatePriceFit({ subject, candidates: [obs({ id: 'a', observedSize: { value: 2, unit: 'in' } })] });
    expect(r.excluded).toContainEqual({ observationId: 'a', reason: 'size-not-comparable' });
  });

  it('keeps a specimen inside the size tolerance', () => {
    const r = evaluatePriceFit({
      subject,
      candidates: [
        obs({ id: 'a', observedSize: { value: 4, unit: 'in' } }),
        obs({ id: 'b', observedSize: { value: 8, unit: 'in' } }),
        obs({ id: 'c', observedSize: { value: 6, unit: 'in' } }),
      ],
    });
    expect(r.sampleCount).toBe(3);
  });

  it('excludes rather than assumes when a size is unrecorded', () => {
    const r = evaluatePriceFit({ subject, candidates: [obs({ id: 'a', observedSize: undefined })] });
    expect(r.excluded).toContainEqual({ observationId: 'a', reason: 'size-unknown' });
  });

  it('compares across units: 15cm is the same fish as 6in', () => {
    const r = evaluatePriceFit({
      subject,
      candidates: [
        obs({ id: 'a', observedSize: { value: 15, unit: 'cm' } }),
        obs({ id: 'b', observedSize: { value: 15, unit: 'cm' } }),
        obs({ id: 'c', observedSize: { value: 15, unit: 'cm' } }),
      ],
    });
    expect(r.sampleCount).toBe(3);
  });

  it('reports every exclusion so the user can see what was left out (NFR-05)', () => {
    const r = evaluatePriceFit({
      subject,
      candidates: [obs({ id: 'a', speciesId: 'sp_other' }), obs({ id: 'b', currency: 'GBP' })],
    });
    expect(r.excluded).toHaveLength(2);
  });
});

describe('band classification (FR-P04)', () => {
  const three = [obs({ id: 'a', askingPrice: 100 }), obs({ id: 'b', askingPrice: 100 }), obs({ id: 'c', askingPrice: 100 })];

  it('calls a clearly cheap price below-market', () => {
    const r = evaluatePriceFit({ subject: obs({ id: 's', askingPrice: 50, memberPrice: undefined, observedAt: subject.observedAt }), candidates: three });
    expect(r.comparison!.band).toBe('below-market');
  });

  it('calls a price within the stated tolerance in-line', () => {
    const r = evaluatePriceFit({ subject: obs({ id: 's', askingPrice: 105, memberPrice: undefined, observedAt: subject.observedAt }), candidates: three });
    expect(r.comparison!.band).toBe('in-line');
  });

  it('calls a clearly expensive price above-market', () => {
    const r = evaluatePriceFit({ subject: obs({ id: 's', askingPrice: 200, memberPrice: undefined, observedAt: subject.observedAt }), candidates: three });
    expect(r.comparison!.band).toBe('above-market');
  });

  it('always returns the threshold that produced the band, so no badge is unexplained', () => {
    const r = evaluatePriceFit({ subject, candidates: three });
    expect(r.comparison!.inLineTolerance).toBe(DEFAULT_PRICE_CONFIG.inLineTolerance);
    expect(typeof r.comparison!.percentDifferenceFromMedian).toBe('number');
  });

  it('emits no band at all when the sample is too small', () => {
    const r = evaluatePriceFit({ subject, candidates: [obs({ id: 'a' })] });
    expect(r.comparison).toBeUndefined();
  });
});

describe('reported ranges', () => {
  it('reports the size and date range behind the comparison (FR-P02)', () => {
    const r = evaluatePriceFit({
      subject,
      candidates: [
        obs({ id: 'a', observedAt: '2026-03-01T00:00:00.000Z', observedSize: { value: 4, unit: 'in' } }),
        obs({ id: 'b', observedAt: '2026-06-01T00:00:00.000Z', observedSize: { value: 6, unit: 'in' } }),
        obs({ id: 'c', observedAt: '2026-08-01T00:00:00.000Z', observedSize: { value: 8, unit: 'in' } }),
      ],
    });
    expect(r.comparison!.dateRange.earliest).toBe('2026-03-01T00:00:00.000Z');
    expect(r.comparison!.dateRange.latest).toBe('2026-08-01T00:00:00.000Z');
    expect(Math.round(r.comparison!.sizeRange!.minCm)).toBe(10);
    expect(Math.round(r.comparison!.sizeRange!.maxCm)).toBe(20);
  });

  it('stamps the config version onto the result', () => {
    expect(evaluatePriceFit({ subject, candidates: [] }).configVersion).toBe(DEFAULT_PRICE_CONFIG.version);
  });
});

describe('the Panther price scenario (PRD 10 step 4)', () => {
  it('records $100 asking / $75 member and refuses a verdict from one comparison', () => {
    // Ryan's single manual comparison: a smaller $50 J4 specimen.
    const j4 = obs({ id: 'p_j4', askingPrice: 50, observedSize: { value: 4, unit: 'in' }, source: 'online-manual' });
    const r = evaluatePriceFit({ subject, candidates: [j4] });

    expect(r.subject.sticker).toBe(100);
    expect(r.subject.memberPrice).toBe(75);
    expect(r.sampleCount).toBe(1);
    expect(r.status).toBe('insufficient-comparison-data');
    expect(r.comparison).toBeUndefined();
  });
});

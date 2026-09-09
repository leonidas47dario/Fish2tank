/**
 * Spec 058. The two rules this source exists to enforce - a commercially usable
 * licence and an exact binomial - are the ones with a real failure behind them,
 * so they get the coverage.
 */
import { describe, expect, it } from 'vitest';
import {
  fetchInaturalistPortrait, findTaxon, largeVariant, photographerFrom, pickPhoto,
  type InatObservation,
} from './inaturalist';

/** Recorded from the real API on 2026-09-04 for Chrysiptera taupou. */
const photo = (over: Record<string, unknown> = {}) => ({
  id: 391804705,
  url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/391804705/square.jpg',
  license_code: 'cc-by',
  attribution: '(c) Mark Rosenstein, some rights reserved (CC BY)',
  original_dimensions: { width: 2048, height: 1365 },
  ...over,
});

const obs = (over: Record<string, unknown> = {}): InatObservation => ({
  id: 12345,
  uri: 'https://www.inaturalist.org/observations/12345',
  quality_grade: 'research',
  photos: [photo()],
  user: { login: 'mrosenstein', name: 'Mark Rosenstein' },
  ...over,
});

/** Answers the taxa call, then the observations call, in that order. */
const stub = (taxa: unknown, observations: unknown) =>
  (async (url: string) => new Response(
    JSON.stringify(String(url).includes('/taxa?') ? taxa : observations),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as unknown as typeof fetch;

const noSleep = async () => {};

describe('largeVariant', () => {
  it('asks for the 1024px file rather than the 75px thumbnail the API returns', () => {
    expect(largeVariant('https://x/photos/1/square.jpg')).toBe('https://x/photos/1/large.jpg');
    expect(largeVariant('https://x/photos/1/medium.jpeg')).toBe('https://x/photos/1/large.jpeg');
  });

  it('leaves an unexpected shape alone rather than mangling it into a 404', () => {
    expect(largeVariant('https://x/photos/1/original.jpg')).toBe('https://x/photos/1/original.jpg');
  });
});

describe('photographerFrom', () => {
  it('takes the name out of the attribution string without the trailing licence', () => {
    // The raw field repeats the licence; the credit line adds it separately, so
    // keeping both would read as a stutter.
    expect(photographerFrom(photo(), obs())).toBe('Mark Rosenstein');
  });

  it('falls back to the observer when the photo carries no attribution', () => {
    expect(photographerFrom(photo({ attribution: undefined }), obs())).toBe('Mark Rosenstein');
  });

  it('falls back to the login when there is no display name', () => {
    expect(photographerFrom(
      photo({ attribution: undefined }),
      obs({ user: { login: 'mrosenstein' } }),
    )).toBe('mrosenstein');
  });
});

describe('pickPhoto', () => {
  it('rejects a non-commercial photo even though the observation matched the filter', () => {
    // `photo_license` filters the OBSERVATION, and an observation can carry a
    // mix - which is how a CC BY-NC file would otherwise reach the bundle.
    expect(pickPhoto([obs({ photos: [photo({ license_code: 'cc-by-nc' })] })])).toBeUndefined();
    expect(pickPhoto([obs({ photos: [photo({ license_code: 'cc-by-nc-sa' })] })])).toBeUndefined();
    expect(pickPhoto([obs({ photos: [photo({ license_code: null })] })])).toBeUndefined();
  });

  it('accepts each of the three usable licences', () => {
    for (const code of ['cc0', 'cc-by', 'cc-by-sa']) {
      expect(pickPhoto([obs({ photos: [photo({ license_code: code })] })])?.photo.license_code)
        .toBe(code);
    }
  });

  it('prefers a research-grade observation over a higher-voted unconfirmed one', () => {
    const got = pickPhoto([
      obs({ id: 1, quality_grade: 'needs_id', photos: [photo({ id: 111 })] }),
      obs({ id: 2, quality_grade: 'research', photos: [photo({ id: 222 })] }),
    ]);
    expect(got?.photo.id).toBe(222);
  });

  it('still returns an unconfirmed observation when that is all there is', () => {
    const got = pickPhoto([obs({ quality_grade: 'needs_id', photos: [photo({ id: 333 })] })]);
    expect(got?.photo.id).toBe(333);
  });

  it('returns nothing for a species with no photos at all', () => {
    expect(pickPhoto([])).toBeUndefined();
    expect(pickPhoto([obs({ photos: [] })])).toBeUndefined();
  });
});

describe('findTaxon', () => {
  const taxa = (name: string) => ({ results: [{ id: 99, name }] });

  it('accepts an exact binomial, case-insensitively', async () => {
    expect(await findTaxon('Chrysiptera taupou', {
      fetchImpl: stub(taxa('chrysiptera taupou'), {}), sleepImpl: noSleep,
    })).toBe(99);
  });

  it('rejects a congener the fuzzy search returned instead', async () => {
    // `?q=` will hand back a near neighbour for a name that does not exist.
    // Spec 056 needed this same guard after a superseded binomial attributed
    // one fish's care data to another.
    expect(await findTaxon('Chrysiptera taupou', {
      fetchImpl: stub(taxa('Chrysiptera cyanea'), {}), sleepImpl: noSleep,
    })).toBeUndefined();
  });

  it('returns nothing when the search finds nothing', async () => {
    expect(await findTaxon('Nonexistent binomial', {
      fetchImpl: stub({ results: [] }, {}), sleepImpl: noSleep,
    })).toBeUndefined();
  });
});

describe('fetchInaturalistPortrait', () => {
  it('returns a row that can be credited and traced', async () => {
    const got = await fetchInaturalistPortrait('sp_x', 'Chrysiptera taupou', {
      fetchImpl: stub({ results: [{ id: 99, name: 'Chrysiptera taupou' }] }, { results: [obs()] }),
      sleepImpl: noSleep,
    });
    expect(got?.provenance).toBe('inaturalist');
    expect(got?.license).toBe('CC BY');
    expect(got?.artist).toBe('Mark Rosenstein');
    expect(got?.attributionUrl).toBe('https://www.inaturalist.org/observations/12345');
    expect(got?.url).toContain('/large.jpg');
    expect(got?.width).toBe(2048);
  });

  it('leaves a species with only non-commercial photos as a gap', async () => {
    // P6: no portrait beats a portrait we cannot use.
    const got = await fetchInaturalistPortrait('sp_x', 'Chrysiptera taupou', {
      fetchImpl: stub(
        { results: [{ id: 99, name: 'Chrysiptera taupou' }] },
        { results: [obs({ photos: [photo({ license_code: 'cc-by-nc' })] })] },
      ),
      sleepImpl: noSleep,
    });
    expect(got).toBeUndefined();
  });

  it('never reaches the photo lookup when the binomial does not match', async () => {
    let calls = 0;
    const counting = (async (url: string) => {
      calls += 1;
      return new Response(
        JSON.stringify(String(url).includes('/taxa?')
          ? { results: [{ id: 99, name: 'Chrysiptera cyanea' }] }
          : { results: [obs()] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    expect(await fetchInaturalistPortrait('sp_x', 'Chrysiptera taupou', {
      fetchImpl: counting, sleepImpl: noSleep,
    })).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('returns nothing rather than throwing when the API errors', async () => {
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect(await fetchInaturalistPortrait('sp_x', 'Chrysiptera taupou', {
      fetchImpl: failing, sleepImpl: noSleep,
    })).toBeUndefined();
  });
});

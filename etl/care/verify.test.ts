import { describe, expect, it } from 'vitest';
import { verifyProposal, type CareProposal, type SourceDoc } from './verify';

const WIKI: SourceDoc = {
  kind: 'wikipedia',
  url: 'https://en.wikipedia.org/wiki/Thick-lipped_gourami',
  title: 'Thick-lipped gourami',
  text: `Thick-lipped gouramis can reach a length of 9 cm TL. They are sexually dimorphic.
It is a generally peaceful fish for a tropical community aquarium.
It is kept in water that ranges from 22-28 °C and that is soft.`,
};

const VENDOR: SourceDoc = {
  kind: 'vendor',
  url: 'https://imperialtropicals.com/products/thick-lipped-gourami',
  text: `Minimum Tank Size: 20 gallons
Temperament: Peaceful community fish`,
};

const docs = { wikipedia: WIKI, vendor: VENDOR };

const base = (over: Partial<CareProposal>): CareProposal => ({ species_id: 'sp_x', ...over });

describe('verifyProposal, accepting good work', () => {
  it('accepts a size whose quote supports it, and attaches the source URL', () => {
    const r = verifyProposal(
      base({ adult_size_in: { value: 3.5, quote: 'can reach a length of 9 cm TL', source: 'wikipedia' } }),
      docs,
    );
    expect(r.rejections).toEqual([]);
    expect(r.accepted.adultSizeIn).toEqual({
      value: 3.5,
      quote: 'can reach a length of 9 cm TL',
      source: 'wikipedia',
      sourceUrl: 'https://en.wikipedia.org/wiki/Thick-lipped_gourami',
    });
  });

  it('accepts a tank volume from a vendor, which is the only route that states one', () => {
    const r = verifyProposal(
      base({ min_volume_gal: { value: 20, quote: 'Minimum Tank Size: 20 gallons', source: 'vendor' } }),
      docs,
    );
    expect(r.rejections).toEqual([]);
    expect(r.accepted.minVolumeGal?.value).toBe(20);
    expect(r.accepted.minVolumeGal?.sourceUrl).toContain('imperialtropicals');
  });

  it('accepts a temperament backed by the word the article uses', () => {
    const r = verifyProposal(
      base({ aggression: { value: 'peaceful', quote: 'It is a generally peaceful fish', source: 'wikipedia' } }),
      docs,
    );
    expect(r.accepted.aggression?.value).toBe('peaceful');
  });

  it('accepts a temperature range stated once with its unit', () => {
    const r = verifyProposal(
      base({ temp_c: { min: 22, max: 28, quote: 'water that ranges from 22-28 °C', source: 'wikipedia' } }),
      docs,
    );
    expect(r.accepted.tempC?.value).toEqual({ min: 22, max: 28 });
  });

  it('treats an all-null proposal as a valid outcome, not an error', () => {
    const r = verifyProposal(base({ adult_size_in: null, aggression: null }), docs);
    expect(r.rejections).toEqual([]);
    expect(r.anyAccepted).toBe(false);
  });
});

describe('verifyProposal, rejecting', () => {
  it('rejects a fabricated quote that is not in the cached text', () => {
    const r = verifyProposal(
      base({
        adult_size_in: { value: 14, quote: 'grows to a maximum length of 35 cm', source: 'wikipedia' },
      }),
      docs,
    );
    expect(r.accepted.adultSizeIn).toBeUndefined();
    expect(r.rejections[0]!.reason).toMatch(/quote not found in the cached wikipedia text/);
  });

  it('rejects a real quote that does not contain the figure claimed from it', () => {
    const r = verifyProposal(
      base({ adult_size_in: { value: 14, quote: 'can reach a length of 9 cm TL', source: 'wikipedia' } }),
      docs,
    );
    expect(r.rejections[0]!.reason).toMatch(/does not contain a figure that yields this value/);
  });

  it('rejects a figure outside the plausible range instead of clamping it', () => {
    const r = verifyProposal(
      base({ adult_size_in: { value: 900, quote: 'can reach a length of 9 cm TL', source: 'wikipedia' } }),
      docs,
    );
    expect(r.rejections[0]!.reason).toMatch(/outside the plausible range/);
  });

  it('rejects an aggression value outside the four domain ratings', () => {
    const r = verifyProposal(
      base({ aggression: { value: 'mildly-grumpy', quote: 'It is a generally peaceful fish', source: 'wikipedia' } }),
      docs,
    );
    expect(r.rejections[0]!.reason).toMatch(/not one of the four AggressionRating values/);
  });

  it('rejects a temperament the quoted sentence says nothing about', () => {
    const r = verifyProposal(
      base({
        aggression: { value: 'highly-aggressive', quote: 'They are sexually dimorphic', source: 'wikipedia' },
      }),
      docs,
    );
    expect(r.rejections[0]!.reason).toMatch(/no word supporting this temperament/);
  });

  it('rejects a citation to a source we hold no text for', () => {
    const r = verifyProposal(
      base({ adult_size_in: { value: 3.5, quote: 'can reach a length of 9 cm TL', source: 'vendor' } }),
      { wikipedia: WIKI },
    );
    expect(r.rejections[0]!.reason).toMatch(/no vendor text was cached/);
  });

  it('rejects a quote too short to be evidence', () => {
    const r = verifyProposal(
      base({ adult_size_in: { value: 3.5, quote: '9 cm', source: 'wikipedia' } }),
      docs,
    );
    expect(r.rejections[0]!.reason).toMatch(/shorter than 12 characters/);
  });

  it('rejects fahrenheit left unconverted rather than storing 78 °C', () => {
    const r = verifyProposal(
      base({ temp_c: { min: 72, max: 78, quote: 'water that ranges from 22-28 °C', source: 'wikipedia' } }),
      docs,
    );
    expect(r.rejections[0]!.reason).toMatch(/outside 4-40/);
  });

  it('rejects an inverted temperature range', () => {
    const r = verifyProposal(
      base({ temp_c: { min: 28, max: 22, quote: 'water that ranges from 22-28 °C', source: 'wikipedia' } }),
      docs,
    );
    expect(r.rejections[0]!.reason).toMatch(/min is greater than max/);
  });

  it('keeps the good fields of a proposal whose other fields failed', () => {
    const r = verifyProposal(
      base({
        adult_size_in: { value: 3.5, quote: 'can reach a length of 9 cm TL', source: 'wikipedia' },
        min_volume_gal: { value: 55, quote: 'needs a very large aquarium indeed', source: 'wikipedia' },
      }),
      docs,
    );
    expect(r.accepted.adultSizeIn?.value).toBe(3.5);
    expect(r.accepted.minVolumeGal).toBeUndefined();
    expect(r.rejections).toHaveLength(1);
    expect(r.anyAccepted).toBe(true);
  });
});

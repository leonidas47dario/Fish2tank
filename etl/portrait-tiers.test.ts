/**
 * Spec 059. What the split has to get right is not the arithmetic - it is that
 * two runs over the same data agree, because a bundled/tail disagreement shows
 * up as a diff of thousands of files that means nothing.
 */
import { describe, expect, it } from 'vitest';
import { coreSpecies, tierFor, CORE_PORTRAITS } from './portrait-tiers';
import type { ImageRow } from './images-jsonl';

const row = (species_id: string): ImageRow => ({
  image_key: species_id, species_id, role: 'portrait', source: 'wikimedia',
  provenance: 'wikimedia', url: `https://x/${species_id}.jpg`, license: 'CC0',
  artist: null, attribution_url: 'https://x', width: null, height: null,
  retrieved_at: 'now',
});

describe('coreSpecies', () => {
  it('takes the most-listed species first', () => {
    const rows = ['a', 'b', 'c'].map(row);
    const core = coreSpecies(rows, new Map([['a', 1], ['b', 99], ['c', 50]]), 2);
    expect([...core]).toEqual(['b', 'c']);
  });

  it('treats a species missing from the market index as zero rather than dropping it', () => {
    const core = coreSpecies(['a', 'b'].map(row), new Map([['b', 5]]), 2);
    expect(core.has('a')).toBe(true);
  });

  it('breaks ties on id, so two runs over the same data agree', () => {
    // Without this the bundled set could differ between runs and the diff would
    // look like a real change to thousands of files.
    const rows = ['zebra', 'apple', 'mango'].map(row);
    const listings = new Map([['zebra', 7], ['apple', 7], ['mango', 7]]);
    expect([...coreSpecies(rows, listings, 2)]).toEqual(['apple', 'mango']);
    expect([...coreSpecies([...rows].reverse(), listings, 2)]).toEqual(['apple', 'mango']);
  });

  it('counts a species once even if it somehow holds two rows', () => {
    const core = coreSpecies([row('a'), row('a'), row('b')], new Map(), 2);
    expect(core.size).toBe(2);
  });

  it('puts everything in the core when there is less than a coreful', () => {
    expect(coreSpecies(['a', 'b'].map(row), new Map()).size).toBe(2);
  });

  it('caps at CORE_PORTRAITS by default', () => {
    const many = Array.from({ length: CORE_PORTRAITS + 40 }, (_, i) => row(`sp_${i}`));
    expect(coreSpecies(many, new Map()).size).toBe(CORE_PORTRAITS);
  });
});

describe('tierFor', () => {
  it('sorts a species into the set that holds it', () => {
    const core = new Set(['a']);
    expect(tierFor('a', core)).toBe('core');
    expect(tierFor('b', core)).toBe('tail');
  });
});

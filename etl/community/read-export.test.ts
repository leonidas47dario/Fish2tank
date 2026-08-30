/**
 * The CLI's reading of a keeper's export.
 *
 * Separate from the gate because this is where a real file's shape gets
 * misread: an export taken before this feature existed, one with catalog
 * species in it, one where a species has no specimens left.
 */
import { describe, expect, it } from 'vitest';
import { readSubmissions } from '../review-user-species';

const EXPORT = {
  species: [
    { id: 'sp_neon_tetra', commonName: 'Neon Tetra', aliases: [], createdAt: '2026-01-01T00:00:00.000Z' },
    {
      id: 'sp_user_a', commonName: 'Sailfin Pleco L083', aliases: [], createdAt: '2026-08-01T00:00:00.000Z',
      origin: 'user-submitted',
      submission: { label: 'Sailfin Pleco L083', specimenId: 'spec_1', submittedAt: '2026-08-01T00:00:00.000Z' },
    },
    {
      id: 'sp_user_b', commonName: 'Zebra Otocinclus', aliases: [], createdAt: '2026-08-02T00:00:00.000Z',
      origin: 'user-submitted',
      submission: { label: 'Zebra Oto', submittedAt: '2026-08-02T00:00:00.000Z', note: 'tag at the shop' },
    },
  ],
  specimens: [
    { id: 'spec_1', speciesId: 'sp_user_a' },
    { id: 'spec_2', speciesId: 'sp_user_a' },
    { id: 'spec_3', speciesId: 'sp_neon_tetra' },
    { id: 'spec_4' },
  ],
};

describe('reading submissions out of an export', () => {
  it('returns only the species the keeper added', () => {
    const subs = readSubmissions(EXPORT);
    expect(subs.map((s) => s.id)).toEqual(['sp_user_a', 'sp_user_b']);
  });

  it('counts how many specimens stand behind each one', () => {
    const subs = readSubmissions(EXPORT);
    expect(subs.find((s) => s.id === 'sp_user_a')!.specimenCount).toBe(2);
    // Logged once, then the keeper never caught another.
    expect(subs.find((s) => s.id === 'sp_user_b')!.specimenCount).toBe(0);
  });

  it('orders by evidence, most-seen first', () => {
    expect(readSubmissions(EXPORT)[0]!.id).toBe('sp_user_a');
  });

  it('carries the verbatim label and note through for the reviewer', () => {
    const b = readSubmissions(EXPORT).find((s) => s.id === 'sp_user_b')!;
    // The keeper typed "Zebra Oto"; the species is named that. Both are kept,
    // because the reviewer is judging the wording as much as the name.
    expect(b.submission?.label).toBe('Zebra Oto');
    expect(b.submission?.note).toBe('tag at the shop');
  });

  it('reads an export written before this feature existed as simply empty', () => {
    expect(readSubmissions({ species: [{ id: 'sp_neon_tetra', commonName: 'Neon Tetra', aliases: [], createdAt: 'x' }] }))
      .toEqual([]);
    expect(readSubmissions({})).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { peekRows } from './shared-peek';
import type { SharedResident } from '@/data/share/snapshot';

/**
 * The peek blurs real values, so what it must never do is blur an invented
 * one - the blur is precisely what would stop anyone noticing (spec 025, P6).
 */

function resident(over: Partial<SharedResident> = {}): SharedResident {
  return { commonName: 'Betta', quantity: 1, ...over };
}

describe('peekRows (spec 025)', () => {
  it('shows only what the snapshot actually carries', () => {
    const rows = peekRows(resident({ adultSizeIn: 2.5, aggression: 'semi-aggressive' }));

    expect(rows.map((r) => r.label)).toEqual(['Adult size', 'Temperament']);
    expect(rows[0]!.value).toBe('2.5 in');
  });

  it('returns nothing at all for a fish nobody has measured', () => {
    // The caller renders "nobody has measured this one yet" rather than a
    // panel of blurred blanks implying there is something behind them.
    expect(peekRows(resident())).toEqual([]);
  });

  it('treats a zero price as missing, not as free', () => {
    // "$0.00" behind a blur is a fabricated fact wearing a currency symbol.
    expect(peekRows(resident({ unitPrice: 0 }))).toEqual([]);
    expect(peekRows(resident({ unitPrice: 12 }))).toEqual([
      { label: 'Typical price', value: '$12.00' },
    ]);
  });

  it('treats a zero size or volume as missing too', () => {
    expect(peekRows(resident({ adultSizeIn: 0, minVolumeGal: 0 }))).toEqual([]);
  });

  it('keeps a stable reading order regardless of which fields exist', () => {
    const full = peekRows(resident({
      adultSizeIn: 3, minVolumeGal: 20, aggression: 'peaceful',
      waterZone: 'mid', unitPrice: 8.5,
    }));

    expect(full.map((r) => r.label)).toEqual([
      'Adult size', 'Minimum tank', 'Temperament', 'Swims', 'Typical price',
    ]);
  });
});

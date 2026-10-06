import { describe, expect, it } from 'vitest';
import { countStickers, matchesFilter, stickerBook, type StickerFilter } from './sticker-book';
import type { Encounter, Holding, LifeEvent, Media, Specimen } from './types';

const NOW = '2026-10-06T12:00:00.000Z';

function specimen(over: Partial<Specimen> & { id: string }): Specimen {
  return {
    kind: 'individual', identityStatus: 'user-confirmed', status: 'encountered',
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

function encounter(specimenId: string, observedAt: string): Encounter {
  return { id: `enc_${specimenId}_${observedAt}`, specimenId, observedAt, createdAt: NOW, syncState: 'synced' };
}

function holding(over: Partial<Holding> & { id: string }): Holding {
  return { kind: 'individual', openingQuantity: 1, openingBalance: false, createdAt: NOW, ...over };
}

function death(holdingId: string): LifeEvent {
  return {
    id: `le_${holdingId}`, holdingId, type: 'deceased', occurredOn: '2026-09-01',
    quantityDelta: -1, createdAt: NOW,
  };
}

function photo(id: string, specimenIds: string[], capturedAt: string): Media {
  return {
    id, kind: 'photo', specimenIds, originalBlobKey: `blob_${id}`, originalBytes: 1,
    mimeType: 'image/jpeg', capturedAt, syncState: 'synced',
  };
}

const NAMES: Record<string, string> = { sp_jaguar: 'Jaguar cichlid', sp_severum: 'Super red severum' };

function book(over: {
  specimens?: Specimen[]; encounters?: Encounter[]; holdings?: Holding[];
  lifeEvents?: LifeEvent[]; media?: Media[];
} = {}) {
  return stickerBook({
    specimens: over.specimens ?? [],
    encounters: over.encounters ?? [],
    holdings: over.holdings ?? [],
    lifeEvents: over.lifeEvents ?? [],
    media: over.media ?? [],
    speciesName: (id) => NAMES[id],
  });
}

const shown = (stickers: ReturnType<typeof book>, f: StickerFilter) =>
  stickers.filter((s) => matchesFilter(s, f)).map((s) => s.key);

describe('stickerBook', () => {
  it('keeps two fish of one species as two stickers (FR-R02)', () => {
    const stickers = book({
      specimens: [
        specimen({ id: 's_panther', speciesId: 'sp_jaguar', nickname: 'the Panther' }),
        specimen({ id: 's_small', speciesId: 'sp_jaguar' }),
      ],
      encounters: [encounter('s_panther', '2026-10-01T10:00:00Z'), encounter('s_small', '2025-06-01T10:00:00Z')],
    });
    expect(stickers.map((s) => s.name)).toEqual(['the Panther', 'Jaguar cichlid']);
  });

  it('lists a fish that was caught and kept once under each filter, and once overall', () => {
    const stickers = book({
      specimens: [specimen({ id: 's1', speciesId: 'sp_jaguar' })],
      encounters: [encounter('s1', '2026-10-01T10:00:00Z'), encounter('s1', '2026-10-03T10:00:00Z')],
      holdings: [holding({ id: 'h1', specimenId: 's1' }), holding({ id: 'h2', specimenId: 's1' })],
    });
    expect(shown(stickers, 'all')).toEqual(['s1']);
    expect(shown(stickers, 'caught')).toEqual(['s1']);
    expect(shown(stickers, 'kept')).toEqual(['s1']);
  });

  it('includes a kept fish that has no record yet, as something to mint', () => {
    const [sticker] = book({ holdings: [holding({ id: 'h1', speciesId: 'sp_severum', openingBalance: true })] });
    expect(sticker).toMatchObject({
      key: 'h1', holdingId: 'h1', name: 'Super red severum', caught: false, kept: true,
    });
    expect(sticker!.specimenId).toBeUndefined();
  });

  it('does not list a minted holding a second time beside its specimen', () => {
    const stickers = book({
      specimens: [specimen({ id: 's1' })],
      holdings: [holding({ id: 'h1', specimenId: 's1' })],
    });
    expect(stickers.map((s) => s.key)).toEqual(['s1']);
  });

  it('keeps a fish no longer kept under Kept and says so', () => {
    const [sticker] = book({
      specimens: [specimen({ id: 's1' })],
      holdings: [holding({ id: 'h1', specimenId: 's1' })],
      lifeEvents: [death('h1')],
    });
    expect(sticker).toMatchObject({ kept: true, pastKept: true });
  });

  it('does not call a fish that was never kept "no longer kept"', () => {
    const [sticker] = book({ specimens: [specimen({ id: 's1' })], encounters: [encounter('s1', NOW)] });
    expect(sticker).toMatchObject({ kept: false, pastKept: false });
  });

  it('wears the newest photograph of that fish, and not of another', () => {
    const [sticker] = book({
      specimens: [specimen({ id: 's1' })],
      media: [
        photo('m_old', ['s1'], '2026-01-01T00:00:00Z'),
        photo('m_new', ['s1'], '2026-05-01T00:00:00Z'),
        photo('m_other', ['s2'], '2026-09-01T00:00:00Z'),
        { ...photo('m_audio', ['s1'], '2026-10-01T00:00:00Z'), kind: 'audio' },
      ],
    });
    expect(sticker!.mediaId).toBe('m_new');
  });

  it('names a fish the way the Home shelf does', () => {
    const stickers = book({
      specimens: [
        specimen({ id: 'a', nickname: 'Nick', speciesId: 'sp_jaguar', rawLabel: 'label', createdAt: '4' }),
        specimen({ id: 'b', speciesId: 'sp_jaguar', rawLabel: 'label', createdAt: '3' }),
        specimen({ id: 'c', rawLabel: 'Blue thing', createdAt: '2' }),
        specimen({ id: 'd', createdAt: '1' }),
      ],
    });
    expect(stickers.map((s) => s.name)).toEqual(['Nick', 'Jaguar cichlid', 'Blue thing', 'Mystery catch']);
  });

  describe('the one date a sticker prints (P6, spec 037)', () => {
    it('is the first encounter, for a fish you met', () => {
      const [sticker] = book({
        specimens: [specimen({ id: 's1' })],
        encounters: [encounter('s1', '2026-10-03T10:00:00Z'), encounter('s1', '2026-10-01T10:00:00Z')],
        holdings: [holding({ id: 'h1', specimenId: 's1', acquiredOn: '2026-10-04' })],
      });
      expect(sticker!.when).toEqual({ kind: 'caught', on: '2026-10-01T10:00:00Z' });
    });

    it('is the day it came home, for a fish only kept', () => {
      const [sticker] = book({ holdings: [holding({ id: 'h1', acquiredOn: '2023-03-14' })] });
      expect(sticker!.when).toEqual({ kind: 'home', on: '2023-03-14' });
    });

    it('is nothing at all rather than when the row was written', () => {
      const [sticker] = book({
        specimens: [specimen({ id: 's1', createdAt: '2026-10-06T00:00:00Z' })],
        holdings: [holding({ id: 'h1', specimenId: 's1', openingBalance: true })],
      });
      expect(sticker!.when).toBeUndefined();
    });
  });

  it('puts dated fish first, newest first, and undated ones after', () => {
    const stickers = book({
      specimens: [
        // Written today, met never: an imported fish opened this morning.
        specimen({ id: 'undated', createdAt: '2026-10-06T09:00:00Z' }),
        specimen({ id: 'older', createdAt: '2026-01-01T00:00:00Z' }),
        specimen({ id: 'newer', createdAt: '2026-01-01T00:00:00Z' }),
      ],
      encounters: [encounter('older', '2025-01-01T00:00:00Z'), encounter('newer', '2026-09-01T00:00:00Z')],
      holdings: [holding({ id: 'h_home', acquiredOn: '2026-05-01' })],
    });
    expect(stickers.map((s) => s.key)).toEqual(['newer', 'h_home', 'older', 'undated']);
  });
});

describe('countStickers', () => {
  it('counts exactly what each filter shows', () => {
    const stickers = book({
      specimens: [
        specimen({ id: 'caught_only' }),
        specimen({ id: 'both', golden: { awardedAt: NOW } }),
      ],
      encounters: [encounter('caught_only', NOW), encounter('both', NOW)],
      holdings: [holding({ id: 'h_both', specimenId: 'both' }), holding({ id: 'h_alone' })],
    });
    const counts = countStickers(stickers);
    for (const f of ['all', 'caught', 'kept', 'golden'] as const) {
      expect(counts[f]).toBe(shown(stickers, f).length);
    }
    expect(counts).toEqual({ all: 3, caught: 2, kept: 2, golden: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  cardFileName, catchCardContent, clampLines, looksLikeEmail, publicName, publicPlace, wrapText,
  type CatchCardInput,
} from './catch-card';

const BASE: CatchCardInput = {
  specimen: { nickname: 'the Panther' },
  commonName: 'Jaguar cichlid',
  scientificName: 'Parachromis managuensis',
  firstMet: '2026-10-01T15:00:00Z',
  place: { name: 'Aquarium Adventure', branch: 'Lincoln Park', type: 'fish-store', coarseLocation: 'Chicago area' },
  displayName: 'Ryan',
  showPlace: true,
  showName: true,
};

describe('catchCardContent', () => {
  it('draws everything the record has', () => {
    expect(catchCardContent(BASE)).toEqual({
      title: 'the Panther',
      kind: 'Jaguar cichlid',
      scientific: 'Parachromis managuensis',
      finder: 'Ryan',
      where: 'Aquarium Adventure Lincoln Park · Chicago area',
      when: { kind: 'caught', on: '2026-10-01T15:00:00Z' },
      golden: false,
    });
  });

  it('invents nothing for a fish the record knows little about (P6)', () => {
    expect(catchCardContent({ specimen: {}, showPlace: true, showName: true })).toEqual({
      title: 'Mystery catch', golden: false,
    });
  });

  it('does not repeat the common name when it is already the title', () => {
    const card = catchCardContent({ ...BASE, specimen: {} });
    expect(card.title).toBe('Jaguar cichlid');
    expect(card.kind).toBeUndefined();
  });

  it('treats a blank nickname as no nickname', () => {
    expect(catchCardContent({ ...BASE, specimen: { nickname: '  ' } }).title).toBe('Jaguar cichlid');
  });

  it('falls back to the day it came home, and never to anything else', () => {
    expect(catchCardContent({ ...BASE, firstMet: undefined, acquiredOn: '2023-03-14' }).when)
      .toEqual({ kind: 'home', on: '2023-03-14' });
    expect(catchCardContent({ ...BASE, firstMet: undefined }).when).toBeUndefined();
  });

  it('leaves out where and who when their switches are off', () => {
    const card = catchCardContent({ ...BASE, showPlace: false, showName: false });
    expect(card.where).toBeUndefined();
    expect(card.finder).toBeUndefined();
  });

  it('marks a Golden fish, and never carries the private reason', () => {
    const card = catchCardContent({
      ...BASE, specimen: { nickname: 'the Panther', golden: { awardedAt: BASE.firstMet!, reason: 'secret' } },
    });
    expect(card.golden).toBe(true);
    expect(JSON.stringify(card)).not.toContain('secret');
  });
});

describe('publicPlace (NFR-04)', () => {
  it('never names a home, not even by its name', () => {
    expect(publicPlace({ name: "Mum's", type: 'home', coarseLocation: 'Evanston' })).toBeUndefined();
  });

  it('uses only the fields marked safe to surface', () => {
    expect(publicPlace({ name: 'Petco', type: 'chain-store' })).toBe('Petco');
    expect(publicPlace({ name: ' ', type: 'expo', coarseLocation: 'Schaumburg' })).toBe('Schaumburg');
  });
});

describe('publicName', () => {
  it('prefers the name the keeper chose', () => {
    expect(publicName('Ryan', 'Ryan Example')).toBe('Ryan');
  });

  it('never puts an email address on a card', () => {
    expect(publicName(undefined, 'ryan@example.com')).toBeUndefined();
    expect(publicName('ryan@example.com', 'Ryan Example')).toBe('Ryan Example');
    expect(looksLikeEmail('fish @ home')).toBe(false);
  });
});

/** One unit per character: easy to reason about in an assertion. */
const chars = (s: string) => s.length;

describe('wrapText', () => {
  it('breaks between words at the width', () => {
    expect(wrapText('the quick brown fox', 9, chars)).toEqual(['the quick', 'brown fox']);
  });

  it('keeps a word longer than the line whole', () => {
    expect(wrapText('Pseudotropheus saulosi', 10, chars)).toEqual(['Pseudotropheus', 'saulosi']);
  });
});

describe('clampLines', () => {
  it('ends a cut line with an ellipsis that fits', () => {
    expect(clampLines(['one two three', 'four five six', 'seven'], 2, 12, chars))
      .toEqual(['one two three', 'four five…']);
  });

  it('leaves short text alone', () => {
    expect(clampLines(['one'], 2, 12, chars)).toEqual(['one']);
  });
});

describe('cardFileName', () => {
  it('is a safe file name', () => {
    expect(cardFileName('the Panther!')).toBe('fish2tank-the-panther.jpg');
    expect(cardFileName('Pez ángel')).toBe('fish2tank-pez-angel.jpg');
    expect(cardFileName('★')).toBe('fish2tank-card.jpg');
  });
});

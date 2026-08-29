import { describe, expect, it } from 'vitest';
import { fileNameFromUrl, isPublishable, plainText, stripTracking } from './wikimedia';

describe('stripTracking', () => {
  it('removes the analytics parameters the API appends', () => {
    // The real shape returned by the API, which broke every licence lookup.
    expect(stripTracking(
      'https://upload.wikimedia.org/wikipedia/commons/1/10/HM_Orange_M_Sarawut.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=original',
    )).toBe('https://upload.wikimedia.org/wikipedia/commons/1/10/HM_Orange_M_Sarawut.jpg');
  });

  it('leaves a clean URL alone', () => {
    const u = 'https://upload.wikimedia.org/wikipedia/commons/a/b/Fish.jpg';
    expect(stripTracking(u)).toBe(u);
  });
});

describe('fileNameFromUrl', () => {
  it('derives the Commons File: title, without the query string', () => {
    expect(fileNameFromUrl(
      'https://upload.wikimedia.org/wikipedia/commons/1/10/HM_Orange_M_Sarawut.jpg?utm_source=x',
    )).toBe('HM_Orange_M_Sarawut.jpg');
  });

  it('decodes percent-encoded filenames', () => {
    expect(fileNameFromUrl('https://upload.wikimedia.org/x/Parachromis%20managuensis.jpg'))
      .toBe('Parachromis managuensis.jpg');
  });

  it('survives a malformed encoding rather than throwing', () => {
    expect(fileNameFromUrl('https://upload.wikimedia.org/x/bad%ZZ.jpg')).toBe('bad%ZZ.jpg');
  });
});

describe('plainText', () => {
  it('reduces the HTML Commons returns for Artist to a name', () => {
    expect(plainText('<a href="//commons.wikimedia.org/wiki/User:Dako99" title="User:Dako99">Dako99</a>'))
      .toBe('Dako99');
  });
  it('decodes entities and collapses whitespace', () => {
    expect(plainText('<span>Jane  &amp;   John</span>')).toBe('Jane & John');
  });
  it('returns undefined for empty input', () => {
    expect(plainText(undefined)).toBeUndefined();
    expect(plainText('<span></span>')).toBeUndefined();
  });
});

describe('isPublishable', () => {
  const base = { speciesId: 's', role: 'portrait', retrievedAt: 'now' } as const;

  it('accepts a Wikimedia image with a stated licence', () => {
    expect(isPublishable({
      ...base, source: 'wikimedia', provenance: 'wikimedia',
      url: 'https://x/y.jpg', license: 'CC BY-SA 4.0',
      attributionUrl: 'https://commons.wikimedia.org/wiki/File:y.jpg',
    })).toBe(true);
  });

  it('accepts a vendor photo with no licence but a stated source', () => {
    // Spec 002: the test is "sourced", not "licensed". A vendor listing photo
    // has no CC licence and never will, but it has a page we can point at.
    expect(isPublishable({
      ...base, source: 'vendor', provenance: 'vendor',
      url: 'https://cdn.shopify.com/s/files/1/x/fish.jpg',
      attributionUrl: 'https://imperialtropicals.com/products/fish',
    })).toBe(true);
  });

  it('rejects an image we cannot point anyone at', () => {
    // No attribution URL means no way to answer "where did this come from",
    // which is the whole reason provenance exists.
    expect(isPublishable({
      ...base, source: 'web', provenance: 'web', url: 'https://x/y.jpg',
    })).toBe(false);
    expect(isPublishable(undefined)).toBe(false);
  });

  it('rejects an image with no url', () => {
    expect(isPublishable({
      ...base, source: 'web', provenance: 'web', url: '',
      attributionUrl: 'https://example.com/page',
    })).toBe(false);
  });
});

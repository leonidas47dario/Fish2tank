/**
 * Identification matching.
 *
 * The load-bearing tests here are the ones about NOT matching. A visual search
 * hands back messy, confident-sounding text, and the failure that matters is
 * the app quietly agreeing with it.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { canShareFiles, identifyFromText, isConfident, lensSearchUrl } from './identify';

const catalog = CATALOG.species;

describe('identifyFromText', () => {
  it('puts an exact binomial first', () => {
    const [top] = identifyFromText('Paracheirodon axelrodi', catalog);
    expect(top?.species.scientificName).toBe('Paracheirodon axelrodi');
    expect(top?.via).toBe('scientific-name');
    expect(top?.score).toBe(1);
  });

  it('finds a fish by its common name', () => {
    const [top] = identifyFromText('Cardinal Tetra', catalog);
    expect(top?.species.commonName).toBe('Cardinal Tetra');
  });

  it('survives a messy caption of the kind a visual search returns', () => {
    const hits = identifyFromText(
      'Cardinal tetra - freshwater aquarium fish, tropical, stock photo',
      catalog,
    );
    expect(hits[0]?.species.commonName).toBe('Cardinal Tetra');
  });

  it('is not fooled by filler words alone', () => {
    // "freshwater aquarium fish" identifies nothing. Returning the whole
    // catalog ranked by how often "fish" appears would be worse than nothing.
    const hits = identifyFromText('freshwater aquarium fish', catalog);
    expect(hits.length).toBe(0);
  });

  it('returns nothing for empty or punctuation-only input', () => {
    expect(identifyFromText('', catalog)).toEqual([]);
    expect(identifyFromText('   ', catalog)).toEqual([]);
    expect(identifyFromText('...!!', catalog)).toEqual([]);
  });

  it('matches a trade name the shop tag would carry', () => {
    // Aliases are the vendor's own listing titles, which is exactly what a
    // photograph of a price tag would read as.
    const hits = identifyFromText('Blue Diamond Discus', catalog);
    expect(hits[0]?.species.scientificName).toContain('Symphysodon');
  });

  it('caps the shortlist', () => {
    expect(identifyFromText('cichlid', catalog, 5).length).toBeLessThanOrEqual(5);
  });

  it('ranks a whole-name match above a partial one', () => {
    const hits = identifyFromText('Convict Cichlid', catalog);
    expect(hits[0]?.species.commonName).toBe('Convict Cichlid');
  });
});

describe('isConfident', () => {
  it('is confident about an exact binomial', () => {
    expect(isConfident(identifyFromText('Paracheirodon axelrodi', catalog))).toBe(true);
  });

  it('is not confident when the top two are close', () => {
    // A genus word matches many species almost equally. The UI must show a
    // list, not lead with one and imply the app knows.
    expect(isConfident(identifyFromText('Corydoras', catalog))).toBe(false);
  });

  it('is not confident about nothing', () => {
    expect(isConfident([])).toBe(false);
  });

  it('never claims confidence on a weak top score', () => {
    const weak = identifyFromText('spotted', catalog);
    if (weak[0] && weak[0].score < 0.7) expect(isConfident(weak)).toBe(false);
  });
});

describe('handoff plumbing', () => {
  it('reports no file sharing when the API is absent', () => {
    // Desktop browsers expose navigator.share but reject files; offering a
    // button that fails on tap is worse than not offering it.
    expect(canShareFiles([new File([''], 'a.jpg', { type: 'image/jpeg' })])).toBe(false);
  });

  it('builds a Lens URL with the image properly encoded', () => {
    const url = lensSearchUrl('https://example.com/a b.jpg?x=1&y=2');
    expect(url).toBe(
      'https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fexample.com%2Fa%20b.jpg%3Fx%3D1%26y%3D2',
    );
  });
});

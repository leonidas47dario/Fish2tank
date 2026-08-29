/**
 * Identification matching.
 *
 * The load-bearing tests here are the ones about NOT matching. A visual search
 * hands back messy, confident-sounding text, and the failure that matters is
 * the app quietly agreeing with it.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { canShareFiles, identifyFromText, isConfident, lensSearchUrl, shareForLens } from './identify';

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

describe('shareForLens', () => {
  const file = () => new File([''], 'catch.jpg', { type: 'image/jpeg' });

  it('shares the image and NOTHING else', async () => {
    // This is the whole point. A share carrying text is a different kind of
    // share: Chrome on iOS acts on the words - opening a tab or a web search -
    // instead of routing the image into Lens, and iOS reads picture-plus-
    // caption as a message and leads its sheet with contacts.
    let got: ShareData | undefined;
    await shareForLens(file(), async (d) => { got = d; });

    expect(got!.files).toHaveLength(1);
    expect(got).not.toHaveProperty('text');
    expect(got).not.toHaveProperty('title');
    expect(Object.keys(got!)).toEqual(['files']);
  });

  it('reports a dismissed sheet as cancelled, not as a failure', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    expect(await shareForLens(file(), () => Promise.reject(abort))).toBe('cancelled');
  });

  it('reports a real refusal as unavailable, so the UI can offer typing instead', async () => {
    expect(await shareForLens(file(), () => Promise.reject(new Error('nope')))).toBe('unavailable');
  });

  it('reports success', async () => {
    expect(await shareForLens(file(), async () => {})).toBe('shared');
  });
});

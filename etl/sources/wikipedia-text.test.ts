import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TITLES_PER_REQUEST,
  expandConvert,
  fetchWikitextBatch,
  resolveTitle,
  stripWikitext,
} from './wikipedia-text';

describe('resolveTitle', () => {
  it('follows a normalisation then a redirect, which is the real chain', () => {
    // The catalog records Balantiocheilus; Wikipedia serves Balantiocheilos.
    const normalized = [{ from: 'Balantiocheilus melanopterus', to: 'Balantiocheilus melanopterus' }];
    const redirects = [{ from: 'Balantiocheilus melanopterus', to: 'Balantiocheilos melanopterus' }];
    expect(resolveTitle('Balantiocheilus melanopterus', [normalized, redirects]))
      .toBe('Balantiocheilos melanopterus');
  });

  it('leaves a title alone when nothing redirects it', () => {
    expect(resolveTitle('Pterophyllum scalare', [[], []])).toBe('Pterophyllum scalare');
  });

  it('stops on a cyclic redirect rather than spinning', () => {
    const cycle = [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }];
    expect(resolveTitle('A', [cycle])).toBe('B');
  });
});

describe('stripWikitext', () => {
  it('keeps the sentence a quote will later be matched against', () => {
    const wt = "The bala shark '''will grow''' to a maximum length of 35&nbsp;cm (14&nbsp;in).";
    expect(stripWikitext(wt)).toBe('The bala shark will grow to a maximum length of 35 cm (14 in).');
  });

  it('drops an infobox without eating the prose after it', () => {
    const wt = '{{Speciesbox\n| genus = Pterophyllum\n| species = scalare\n}}\nAngelfish are cichlids.';
    expect(stripWikitext(wt)).toBe('Angelfish are cichlids.');
  });

  it('keeps the measurement inside a convert template', () => {
    // The defect this test exists for: dropping templates wholesale turned
    // "can reach a length of {{convert|9|cm|in}} TL" into "a length of TL".
    expect(stripWikitext('Can reach a length of {{convert|9|cm|in}} TL.'))
      .toBe('Can reach a length of 9 cm TL.');
  });

  it('keeps a converted measurement even when the template nests another', () => {
    expect(stripWikitext('Grows to {{convert|35|cm|in|abbr={{on}}}} long.')).toBe('Grows to 35 cm long.');
  });

  it('renders a convert range, which is how temperatures are written', () => {
    expect(stripWikitext('Kept between {{convert|22|-|28|C|F}} year round.'))
      .toBe('Kept between 22–28 °C year round.');
  });

  it('renders only the source figure, never a conversion it computed itself', () => {
    // Emitting "(3.5 in)" would be this pipeline inventing a number no source
    // stated. The gate converts units downstream and checks against the quote.
    expect(expandConvert('{{convert|9|cm|in}}')).toBe('9 cm');
  });

  it('drops a malformed convert rather than emitting garbage', () => {
    expect(stripWikitext('Length {{convert|}} unknown.')).toBe('Length unknown.');
  });

  it('unwraps piped links to the words a reader sees', () => {
    expect(stripWikitext('Found in the [[Amazon basin|Amazon]] and [[Peru]].'))
      .toBe('Found in the Amazon and Peru.');
  });

  it('removes references, which otherwise land inside a quoted sentence', () => {
    const wt = 'Peaceful and hardy.<ref name="fb">FishBase</ref> Keep in groups.';
    expect(stripWikitext(wt)).toBe('Peaceful and hardy. Keep in groups.');
  });

  it('drops file links entirely rather than leaking the caption pipe', () => {
    expect(stripWikitext('[[File:Fish.jpg|thumb|A bala shark]]\nThe fish is silver.'))
      .toBe('The fish is silver.');
  });

  it('keeps headings as context for the section a claim came from', () => {
    expect(stripWikitext('== In the aquarium ==\nThey are peaceful.'))
      .toContain('In the aquarium');
  });
});

describe('fetchWikitextBatch', () => {
  const ok = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it('maps every requested title to a page, including the redirected one', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({
        query: {
          redirects: [{ from: 'Balantiocheilus melanopterus', to: 'Balantiocheilos melanopterus' }],
          pages: [
            { title: 'Balantiocheilos melanopterus', revisions: [{ slots: { main: { content: 'Silver shark.' } } }] },
            { title: 'Pterophyllum scalare', revisions: [{ slots: { main: { content: 'Angelfish.' } } }] },
          ],
        },
      }),
    );

    const pages = await fetchWikitextBatch(
      ['Balantiocheilus melanopterus', 'Pterophyllum scalare'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(pages).toHaveLength(2);
    expect(pages[0]!).toMatchObject({
      requested: 'Balantiocheilus melanopterus',
      resolved: 'Balantiocheilos melanopterus',
      wikitext: 'Silver shark.',
      redirected: true,
    });
    expect(pages[1]!.redirected).toBe(false);
  });

  it('reports a missing article as absent text, not as a failure', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ query: { pages: [{ title: 'Nonexistus fishus', missing: true }] } }),
    );
    const [page] = await fetchWikitextBatch(['Nonexistus fishus'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(page!.wikitext).toBeUndefined();
    expect(page!.resolved).toBe('Nonexistus fishus');
  });

  it('backs off and retries a 429 rather than recording fifty missing articles', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      .mockResolvedValueOnce(
        ok({ query: { pages: [{ title: 'Lota lota', revisions: [{ slots: { main: { content: 'Burbot.' } } }] }] } }),
      );

    const [page] = await fetchWikitextBatch(['Lota lota'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(page!.wikitext).toBe('Burbot.');
  });

  it('throws after exhausting retries, so a rate-limited run cannot look empty', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429 }) as Response);
    await expect(
      fetchWikitextBatch(['Lota lota'], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        backoffMs: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/still returning HTTP 429 after 3 attempts/);
  });

  it('refuses a batch over the API cap instead of silently truncating it', async () => {
    const titles = Array.from({ length: MAX_TITLES_PER_REQUEST + 1 }, (_, i) => `T${i}`);
    await expect(fetchWikitextBatch(titles)).rejects.toThrow(/exceeds the API cap/);
  });
});

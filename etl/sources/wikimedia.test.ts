import { describe, expect, it } from 'vitest';
import {
  commonsSearchUrl, fileNameFromUrl, isPublishable, plainText,
  searchCommonsPortrait, stripTracking,
} from './wikimedia';

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

  it('accepts a Wikimedia image whose licence lookup failed, because the file page still states it', () => {
    // Reachable today: fetchSpeciesPortrait wraps the Commons licence lookup in
    // a try/catch and falls through on failure, so license can be undefined on
    // a real Wikimedia hit. Spec 002's rule is traceability, and the file page
    // URL satisfies it - a human can open it and read the licence there. The
    // credit line never claims a licence it does not have, it just names the
    // photographer, so shipping this is honest rather than a loophole.
    expect(isPublishable({
      ...base, source: 'wikimedia', provenance: 'wikimedia',
      url: 'https://upload.wikimedia.org/wikipedia/commons/a/b/Fish.jpg',
      artist: 'H. Zell',
      attributionUrl: 'https://commons.wikimedia.org/wiki/File:Fish.jpg',
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

describe('commonsSearchUrl', () => {
  it('quotes the binomial', () => {
    // Unquoted, the search fuzzy-matches: "Pangio anguillaris" came back
    // suggesting "panagia angularis" and zero files.
    expect(commonsSearchUrl('Pangio anguillaris')).toContain('%22Pangio%20anguillaris%22');
  });

  it('searches the File namespace only', () => {
    expect(commonsSearchUrl('Pangio anguillaris')).toContain('gsrnamespace=6');
  });

  it('asks for size, or every hit comes back with no dimensions', () => {
    // The stub in searchCommonsPortrait's tests fabricates width and height, so
    // it cannot catch this: with iiprop=url|extmetadata the real API returns
    // neither, and build-marts.ts orders candidates by width DESC to pick one
    // portrait per species. Null widths turn that rule into arbitrary choice.
    //
    // The pipes here are literal, not percent-encoded: only gsrsearch is run
    // through encodeURIComponent, so this parameter is built as a plain
    // template string and reaches the API as `iiprop=url|size|extmetadata`.
    expect(commonsSearchUrl('Pangio anguillaris')).toContain('iiprop=url|size|extmetadata');
  });
});

describe('searchCommonsPortrait', () => {
  const page = (title: string) => ({
    title,
    imageinfo: [{
      url: `https://upload.wikimedia.org/wikipedia/commons/a/b/${title.replace('File:', '')}`,
      descriptionurl: `https://commons.wikimedia.org/wiki/${title}`,
      width: 1200,
      height: 800,
      extmetadata: {
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        Artist: { value: '<a href="/x">H. Zell</a>' },
      },
    }],
  });

  const stub = (pages: unknown[]) =>
    (async () => new Response(JSON.stringify({ query: { pages } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

  it('returns the first photographic file with its licence', async () => {
    const got = await searchCommonsPortrait('sp_x', 'Piabina argentea', {
      fetchImpl: stub([page('File:Piabina argentea.jpg')]),
    });
    expect(got?.provenance).toBe('wikimedia');
    expect(got?.license).toBe('CC BY-SA 4.0');
    expect(got?.artist).toBe('H. Zell');
    expect(got?.attributionUrl).toBe('https://commons.wikimedia.org/wiki/File:Piabina argentea.jpg');
  });

  it('skips non-photographic file types', async () => {
    // Commons returns range maps and PDFs against a binomial search. An SVG
    // distribution map is not a portrait of the fish.
    const got = await searchCommonsPortrait('sp_x', 'Piabina argentea', {
      fetchImpl: stub([page('File:Piabina argentea range.svg'), page('File:Piabina argentea.jpg')]),
    });
    expect(got?.url).toContain('.jpg');
  });

  it('returns undefined when the search finds nothing', async () => {
    const got = await searchCommonsPortrait('sp_x', 'Nonexistent binomial', {
      fetchImpl: (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
    });
    expect(got).toBeUndefined();
  });

  it('returns undefined rather than throwing when the API errors', async () => {
    const got = await searchCommonsPortrait('sp_x', 'Piabina argentea', {
      fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    });
    expect(got).toBeUndefined();
  });

  it('skips a radiograph in favour of the live fish lower down the results', async () => {
    // Not hypothetical. This is the real Commons result order for Hyphessobrycon
    // margitae: an X-ray of the holotype ranks above a photograph of the living
    // animal, and extension filtering cannot tell them apart.
    const got = await searchCommonsPortrait('sp_x', 'Hyphessobrycon margitae', {
      fetchImpl: stub([
        page('File:Hyphessobrycon margitae radiograph (holotype).png'),
        page('File:Hyphessobrycon margitae (live).png'),
      ]),
    });
    expect(got?.url).toContain('live');
  });

  it('returns undefined when every candidate is a specimen or a figure', async () => {
    // The right answer is no picture. These species fall through to the subagent
    // stage; a museum shell on a field guide card is worse than an empty frame.
    const got = await searchCommonsPortrait('sp_x', 'Vittina variegata', {
      fetchImpl: stub([
        page('File:Vittina variegata (MNHN-IM-2000-32808).jpeg'),
        page('File:Vittina jovis - Neritidae - Mollusc shell.jpeg'),
      ]),
    });
    expect(got).toBeUndefined();
  });

  it('does not reject a live snail just because its title says shell', async () => {
    // The catalog stocks snails. "mollusc shell" and the museum collection
    // prefixes catch the specimen scans; a bare "shell" would cost real
    // portraits, so it is excluded from the pattern on purpose.
    const got = await searchCommonsPortrait('sp_x', 'Clithon corona', {
      fetchImpl: stub([page('File:Clithon corona shell detail.jpg')]),
    });
    expect(got?.url).toContain('Clithon');
  });
});

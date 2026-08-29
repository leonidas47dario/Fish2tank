import { describe, expect, it } from 'vitest';
import {
  CATALOG, cardPrice, ownership, portraitCredit, resolveCardArt,
  type CatalogCard, type CatalogSpecies,
} from './catalog';
import type { MarketSpeciesStats } from './market';

function species(over: Partial<CatalogSpecies> = {}): CatalogSpecies {
  return {
    speciesId: 'sp_jaguar_cichlid', commonName: 'Jaguar Cichlid',
    scientificName: 'Parachromis managuensis', aliases: [], predationTags: [],
    portrait: { url: 'https://commons/x.jpg', provenance: 'wikimedia', license: 'Public domain' },
    ...over,
  };
}

function card(over: Partial<CatalogCard> = {}): CatalogCard {
  return {
    species: species(),
    user: {
      caught: true, kept: false, inCollection: true, currentlyKept: false, specimenCount: 1,
      golden: false, onDreamList: false, ownPhotoMediaIds: [],
    },
    ...over,
  };
}

const withPhotos = (ids: string[]) => card({
  user: { ...card().user, ownPhotoMediaIds: ids },
});

describe('card art (principle P3: the exact specimen matters)', () => {
  it('prefers your own photo over the reference portrait by default', () => {
    const art = resolveCardArt(withPhotos(['m1']), undefined);
    expect(art).toEqual({ kind: 'own', mediaId: 'm1' });
  });

  it('uses the newest of your photos when you have several', () => {
    // The caller sorts newest-first; the resolver takes the head.
    expect(resolveCardArt(withPhotos(['newest', 'older']), undefined))
      .toEqual({ kind: 'own', mediaId: 'newest' });
  });

  it('honours an explicit preference for a specific photo', () => {
    expect(resolveCardArt(withPhotos(['a', 'b']), { artSource: 'own', preferredMediaId: 'b' }))
      .toEqual({ kind: 'own', mediaId: 'b' });
  });

  it('ignores a preferred photo that is no longer yours', () => {
    // Deleted media must not blank the card.
    expect(resolveCardArt(withPhotos(['a']), { artSource: 'own', preferredMediaId: 'deleted' }))
      .toEqual({ kind: 'own', mediaId: 'a' });
  });

  it('uses the bundled portrait when you explicitly ask for it', () => {
    // sp_jaguar_cichlid does have a bundled asset, so the preference is honoured.
    const art = resolveCardArt(withPhotos(['m1']), { artSource: 'portrait' });
    expect(art.kind).toBe('portrait');
    if (art.kind === 'portrait') {
      // Local asset, never the remote Wikimedia URL - the catalog must draw
      // itself offline.
      expect(art.src).not.toMatch(/^https?:/);
      expect(art.credit.license).toBeTruthy();
    }
  });

  it('falls back to your photo when the portrait was asked for but none is bundled', () => {
    const unbundled = card({
      species: species({ speciesId: 'sp_no_such_asset' }),
      user: { ...card().user, ownPhotoMediaIds: ['m1'] },
    });
    // Rather than a silhouette, the user still sees the fish they actually met.
    expect(resolveCardArt(unbundled, { artSource: 'portrait' })).toEqual({ kind: 'own', mediaId: 'm1' });
  });

  it('shows a silhouette when there is neither a photo nor a portrait', () => {
    const c = card({ species: species({ portrait: undefined }) });
    expect(resolveCardArt(c, undefined)).toEqual({ kind: 'none' });
  });
});

describe('cardPrice', () => {
  const market = {
    speciesId: 'sp_x', comparableCount: 5, totalListings: 9, inStock: 0, soldOut: 9,
    price: { median: 55, min: 12, max: 250, currency: 'USD' },
    priceBySize: [
      { sizeIn: 4, medianPrice: 38, listings: 1 },
      { sizeIn: 6, medianPrice: 85, listings: 1 },
    ],
    stores: [],
  } as MarketSpeciesStats;

  it('prices at the size you saw, not the pooled median', () => {
    // The whole point of the ladder: $85 at 6in, not $55 across 1in-12in.
    expect(cardPrice(market, 6)).toBe(85);
    expect(cardPrice(market, 4)).toBe(38);
  });

  it('falls back to the pooled median when no size is known', () => {
    expect(cardPrice(market, undefined)).toBe(55);
  });

  it('falls back when the size has no band', () => {
    expect(cardPrice(market, 30)).toBe(55);
  });

  it('returns nothing when the species has no market data', () => {
    expect(cardPrice(undefined, 6)).toBeUndefined();
  });
});

describe('the shipped catalog mart', () => {
  it('covers every species and can account for every portrait it has', () => {
    expect(CATALOG.species.length).toBeGreaterThan(40);
    for (const s of CATALOG.species) {
      expect(s.speciesId).toBeTruthy();
      expect(s.commonName).toBeTruthy();
      // Spec 002: the gate is traceability, not licence - vendor and web
      // photos have no licence and are shipped deliberately with visible
      // credit, but every portrait must still carry an attribution link.
      if (s.portrait) {
        expect(s.portrait.attributionUrl).toBeTruthy();
        expect(['wikimedia', 'vendor', 'web']).toContain(s.portrait.provenance);
      }
    }
  });

  it('has no duplicate species', () => {
    const ids = CATALOG.species.map((s) => s.speciesId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ownership', () => {
  it('a fish you caught is yours', () => {
    expect(ownership(1, 0)).toEqual({ caught: true, kept: false, inCollection: true });
  });

  it('a fish you keep but never caught is yours too', () => {
    // The bug this fixes: 61 imported inventory rows have holdings and no
    // confirmed specimen, and every one of them rendered greyed out.
    expect(ownership(0, 1)).toEqual({ caught: false, kept: true, inCollection: true });
  });

  it('a species you have only read about is not', () => {
    expect(ownership(0, 0)).toEqual({ caught: false, kept: false, inCollection: false });
  });

  it('counts both when you caught it and kept it', () => {
    expect(ownership(2, 3)).toEqual({ caught: true, kept: true, inCollection: true });
  });
});

describe('portraitCredit', () => {
  it('credits a Wikimedia photo to its photographer and licence', () => {
    expect(portraitCredit({
      url: 'x', provenance: 'wikimedia', license: 'CC BY 3.0', artist: 'Per Harald Olsen',
    })).toBe('Per Harald Olsen, CC BY 3.0');
  });

  it('credits a Wikimedia photo with no named artist to the licence alone', () => {
    expect(portraitCredit({ url: 'x', provenance: 'wikimedia', license: 'CC0' })).toBe('CC0');
  });

  it('credits a vendor photo to the shop, and says it is a listing photo', () => {
    // No CC licence exists for these, and implying one would be a lie.
    expect(portraitCredit({
      url: 'x', provenance: 'vendor', artist: 'Imperial Tropicals',
    })).toBe('Photo: Imperial Tropicals (product listing)');
  });

  it('credits a web photo to its site', () => {
    expect(portraitCredit({
      url: 'x', provenance: 'web', artist: 'Fishbase',
    })).toBe('Photo: Fishbase');
  });

  it('says the source is unrecorded rather than inventing one', () => {
    expect(portraitCredit({ url: 'x', provenance: 'web' })).toBe('Source not recorded');
  });

  it('never claims a licence for a vendor photo, even if one is somehow present', () => {
    // Defence in depth. The mart should never produce this, but if it did,
    // rendering "Imperial Tropicals, CC BY 4.0" would assert a licence the
    // shop never granted. Provenance decides the sentence, not the fields.
    expect(portraitCredit({
      url: 'x', provenance: 'vendor', artist: 'Imperial Tropicals', license: 'CC BY 4.0',
    })).toBe('Photo: Imperial Tropicals (product listing)');
  });
});

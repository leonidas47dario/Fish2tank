import { describe, expect, it } from 'vitest';
import {
  CATALOG, CATALOG_BY_SPECIES, cardPrice, identityStatusFor, ownership, portraitCredit,
  chooseArt, resolveCardArt, searchableSpecies,
  type CatalogCard, type CatalogSpecies,
} from './catalog';
import {
  CANONICAL_BY_SYNONYM, OVERRIDE_BY_ID, SPECIES_OVERRIDES,
} from './seed/species-overrides';
import { identifyFromText } from './identify';
import { MARKET_INDEX, marketFor, scarcityFor, type MarketSpeciesStats } from './market';
import type { Species } from '@/domain/types';

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

/**
 * Spec 021. A tank tile asks the same question as a card, over a different
 * pool: the photos of ONE fish rather than every fish of the species. Two
 * green severums in two tanks are two faces, and the grid was drawing the
 * reference portrait for both.
 *
 * Same rule, so the same function answers it - `resolveCardArt` is a thin
 * wrapper over this, and a second copy of the precedence would drift.
 */
describe('chooseArt over one fish rather than one species', () => {
  const sp = species();

  it('uses that fish’s own photo ahead of the reference portrait', () => {
    expect(chooseArt(sp, ['mine'], undefined)).toEqual({ kind: 'own', mediaId: 'mine' });
  });

  it('falls back to the portrait when this fish has never been photographed', () => {
    // Its sibling in the next tank having a photo must not lend it one.
    expect(chooseArt(sp, [], undefined)).toMatchObject({ kind: 'portrait' });
  });

  it('still honours an explicit preference for the reference portrait', () => {
    expect(chooseArt(sp, ['mine'], { artSource: 'portrait' })).toMatchObject({ kind: 'portrait' });
  });

  it('shows the newest photo of that fish', () => {
    expect(chooseArt(sp, ['newest', 'older'], undefined)).toEqual({ kind: 'own', mediaId: 'newest' });
  });

  it('has nothing to draw for an unidentified fish with no photo', () => {
    expect(chooseArt(undefined, [], undefined)).toEqual({ kind: 'none' });
  });

  it('draws the photo of an unidentified fish, which has no portrait to fall back to', () => {
    expect(chooseArt(undefined, ['mine'], undefined)).toEqual({ kind: 'own', mediaId: 'mine' });
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

describe('the searchable corpus (spec 007)', () => {
  const local = (over: Partial<Species> = {}): Species => ({
    id: 'sp_user_1', commonName: 'Weird Pleco', aliases: [],
    createdAt: '2026-08-30T00:00:00.000Z', origin: 'user-submitted', ...over,
  });

  it('contains every catalog species', () => {
    expect(searchableSpecies([])).toHaveLength(CATALOG.species.length);
  });

  it('adds a species the keeper submitted, which is in no mart', () => {
    const corpus = searchableSpecies([local()]);
    expect(corpus.map((s) => s.speciesId)).toContain('sp_user_1');
    expect(corpus).toHaveLength(CATALOG.species.length + 1);
  });

  it('leaves a submitted species empty of care data rather than filling it with zeroes', () => {
    // catalogShapeForLocal's contract, asserted here because the corpus is now
    // what feeds the UI: nobody sourced an adult size for a fish the keeper
    // typed in, and the card's "not enough data" path must be the one that runs.
    const entry = searchableSpecies([local()]).find((s) => s.speciesId === 'sp_user_1')!;
    expect(entry.commonName).toBe('Weird Pleco');
    expect(entry.adultSizeIn).toBeUndefined();
    expect(entry.portrait).toBeUndefined();
  });

  it('does not re-add a seeded species that is already a mart row', () => {
    // The 47 seeded care profiles carry the SAME ids as their mart rows, so
    // passing the whole species table must not duplicate them. A duplicate
    // would show the user the same fish twice and make them guess.
    const seeded: Species = {
      id: 'sp_jaguar_cichlid', commonName: 'Jaguar Cichlid', aliases: [],
      createdAt: '2026-08-27T00:00:00.000Z',
    };
    const corpus = searchableSpecies([seeded, local()]);
    expect(corpus.filter((s) => s.speciesId === 'sp_jaguar_cichlid')).toHaveLength(1);
    expect(corpus).toHaveLength(CATALOG.species.length + 1);
  });

  it('finds a catalog species that has no seeded care profile', () => {
    // BUG-01's own reproduction case. Erythrinus erythrinus is a real mart row
    // with real listings and no hand-written profile, so the old panel - which
    // searched the 47 seeded rows - returned nothing for it.
    const hits = identifyFromText('Rainbow Wolf Fish', searchableSpecies([]));
    expect(hits.map((c) => c.species.speciesId)).toContain('sp_erythrinus_erythrinus');
  });

  it('finds a submitted species by the name the keeper gave it', () => {
    const hits = identifyFromText('Weird Pleco', searchableSpecies([local()]));
    expect(hits[0]?.species.speciesId).toBe('sp_user_1');
  });
});

describe('a merged species does not strand what pointed at it (spec 008)', () => {
  const folded = [...CANONICAL_BY_SYNONYM.keys()];

  it('has synonyms to test with', () => {
    expect(folded.length).toBeGreaterThan(0);
  });

  it('resolves a folded id to the row that survived', () => {
    // A specimen identified before the merge still carries the old id. Without
    // this the catalog lookup misses and a correctly-identified fish renders
    // as though it had no species - the app appearing to forget a catch
    // because a taxonomist moved a genus.
    for (const id of folded) {
      const canonical = CANONICAL_BY_SYNONYM.get(id)!;
      const row = CATALOG_BY_SPECIES.get(canonical);
      if (!row) continue; // NOT_A_SPECIES rows have no survivor, by design.
      expect(CATALOG_BY_SPECIES.get(id)).toBe(row);
    }
  });

  it('keeps the old binomial searchable as an alias', () => {
    // Brachydanio rerio is what a shop tag says and what a keeper types. The
    // merge must not turn it into a dead end.
    const zebra = CATALOG_BY_SPECIES.get('sp_danio_rerio');
    expect(zebra?.aliases).toContain('Brachydanio rerio');
    expect(identifyFromText('Brachydanio rerio', searchableSpecies([]))[0]?.species.speciesId)
      .toBe('sp_danio_rerio');
  });

  it('carries a researched name across a merge', () => {
    // "Adolfo's Catfish" was researched against sp_corydoras_adolfoi. When that
    // row folded away, the survivor briefly became "Adolfo S Hoplisoma" - a
    // valid derived name, and a worse one, with the human work discarded.
    expect(OVERRIDE_BY_ID.get('sp_hoplisoma_adolfoi')?.commonName).toBe("Adolfo's Catfish");
    expect(CATALOG_BY_SPECIES.get('sp_hoplisoma_adolfoi')?.commonName).toBe("Adolfo's Catfish");
  });

  it('does not overwrite a name the surviving row researched for itself', () => {
    for (const [foldedId, canonical] of CANONICAL_BY_SYNONYM) {
      const own = SPECIES_OVERRIDES.find((o) => o.speciesId === canonical);
      if (!own) continue;
      expect(OVERRIDE_BY_ID.get(canonical)).toBe(own);
      expect(foldedId).not.toBe(canonical);
    }
  });
});

describe('what picking a species asserts (FR-I01, spec 007)', () => {
  it('confirms a catalog species', () => {
    expect(identityStatusFor('sp_erythrinus_erythrinus')).toBe('user-confirmed');
  });

  it('will not confirm a species the keeper invented', () => {
    // Regression, and it was real for about ten minutes: once submitted species
    // became pickable in BOTH identify surfaces, each screen decided this for
    // itself and they disagreed - the same species was recorded user-confirmed
    // from one and provisional from the other, in one database, measured in a
    // browser. "User confirmed" means "this is that catalog species", and there
    // is no catalog species to mean.
    expect(identityStatusFor('sp_user_0521cb3d')).toBe('provisional');
  });
});

/**
 * Spec 008 folded 20 species that were one fish under two names and rebuilt
 * the index against the survivors. catalog.ts already redirected
 * CATALOG_BY_SPECIES; the market lookup did not, so a record stored before the
 * merge resolved its species and then found no listings, no price and no
 * scarcity for a fish the index knows under its other name.
 */
describe('a species id that folded into another', () => {
  const pairs = [...CANONICAL_BY_SYNONYM.entries()];

  it('has folds to test, and none of them survive in the index', () => {
    // Guards the cases below from passing vacuously if the merge is ever undone.
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.filter(([folded]) => MARKET_INDEX.species[folded])).toEqual([]);
  });

  it('still finds the market, under the name that survived', () => {
    for (const [folded, canonical] of pairs) {
      expect(marketFor(folded)).toBe(MARKET_INDEX.species[canonical]);
    }
  });

  it('still rates scarcity, rather than reporting no evidence', () => {
    for (const [folded] of pairs) {
      expect(scarcityFor(folded)).toEqual(scarcityFor(CANONICAL_BY_SYNONYM.get(folded)));
    }
  });

  it('leaves an unknown id answering nothing', () => {
    expect(marketFor('sp_not_a_species')).toBeUndefined();
    expect(marketFor(undefined)).toBeUndefined();
  });
});

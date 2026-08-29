import { describe, expect, it } from 'vitest';
import {
  resolveSpeciesWaterType, waterTypeBySpecies, waterTypeFromListing, type WaterType,
} from './water-type';

describe('waterTypeFromListing', () => {
  it('reads the tags the vendors actually use', () => {
    expect(waterTypeFromListing(['All Live', 'Marine Fish'])).toBe('marine');
    expect(waterTypeFromListing(['All Live', 'Freshwater Fish'])).toBe('freshwater');
    expect(waterTypeFromListing(['Freshwater Shrimp'])).toBe('freshwater');
    expect(waterTypeFromListing(['Marine / Saltwater Fish'])).toBe('marine');
    expect(waterTypeFromListing(['Wrasse - Reef Safe'])).toBe('marine');
  });

  it('prefers brackish, because it is the more specific claim', () => {
    // A vendor tagging a fish Brackish has said something sharper than the
    // Freshwater Fish aisle it also sits in. Collapsing it loses the only bit
    // of information the tag was added to carry.
    expect(waterTypeFromListing(['Freshwater Fish', 'Brackish'])).toBe('brackish');
  });

  it('takes pond stock as freshwater', () => {
    expect(waterTypeFromListing(['Pond Plant'])).toBe('freshwater');
  });

  it('reads the product_type when the tags say nothing', () => {
    expect(waterTypeFromListing([], 'Freshwater Fish')).toBe('freshwater');
  });

  it('says nothing when the vendor said nothing', () => {
    // Undefined is the absence of a claim, never a guess at one.
    expect(waterTypeFromListing(['All Live', 'Philippines'])).toBeUndefined();
    expect(waterTypeFromListing(undefined)).toBeUndefined();
    expect(waterTypeFromListing([], '')).toBeUndefined();
  });

  it('is not fooled by a colour name or a substrate', () => {
    // "Coral Blue Platy" is a freshwater fish's colour and "Crushed Coral" is
    // gravel. Neither is a marine claim.
    expect(waterTypeFromListing([], 'Coral Blue Platy')).toBeUndefined();
    expect(waterTypeFromListing(['Crushed Coral'])).toBeUndefined();
  });
});

describe('resolveSpeciesWaterType', () => {
  it('lets freshwater win a conflict', () => {
    // Every species with conflicting tags is genuinely euryhaline - amano
    // shrimp, archerfish, bumblebee goby, sailfin molly. Someone filtering to
    // freshwater wants to be shown a molly.
    expect(resolveSpeciesWaterType(['marine', 'freshwater'])).toBe('freshwater');
    expect(resolveSpeciesWaterType(['brackish', 'freshwater'])).toBe('freshwater');
  });

  it('ranks brackish above marine, as the closer of the two to a real tank', () => {
    expect(resolveSpeciesWaterType(['marine', 'brackish'])).toBe('brackish');
  });

  it('returns nothing when nobody made a claim', () => {
    expect(resolveSpeciesWaterType([undefined, undefined])).toBeUndefined();
    expect(resolveSpeciesWaterType([])).toBeUndefined();
  });
});

describe('waterTypeBySpecies', () => {
  const vendors = new Map<string, WaterType>([
    ['aquatic-arts', 'freshwater'],
    ['petsmart', 'freshwater'],
  ]);
  const l = (speciesId: string, storeId: string, tags: string[] = [], productType?: string) =>
    ({ speciesId, storeId, tags, productType });

  it('lets a listing tag beat the vendor default', () => {
    // Predatory Fins is a freshwater shop that nonetheless tags four products
    // Marine / Saltwater Fish. The product knows better than the shop.
    const m = waterTypeBySpecies(
      [l('sp_x', 'aquatic-arts', ['Marine Fish'])],
      vendors,
    );
    expect(m.get('sp_x')).toBe('marine');
  });

  it('falls back to the vendor for a shop that tags nothing', () => {
    expect(waterTypeBySpecies([l('sp_y', 'petsmart')], vendors).get('sp_y')).toBe('freshwater');
  });

  it('leaves a species unresolved when no vendor of it declared anything', () => {
    // 'mixed' vendors like LiveAquaria are deliberately absent from the
    // fallback map: they sell both, so only their per-listing tags may speak.
    expect(waterTypeBySpecies([l('sp_z', 'liveaquaria')], vendors).has('sp_z')).toBe(false);
  });

  it('pools every listing of a species before deciding', () => {
    const m = waterTypeBySpecies(
      [l('sp_molly', 'liveaquaria', ['Brackish']), l('sp_molly', 'aquatic-arts', ['Freshwater Fish'])],
      vendors,
    );
    expect(m.get('sp_molly')).toBe('freshwater');
  });

  it('ignores listings that resolved to no species at all', () => {
    expect(waterTypeBySpecies([{ storeId: 'petsmart', tags: [] }], vendors).size).toBe(0);
  });
});

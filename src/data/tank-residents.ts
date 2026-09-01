/**
 * One tank's residents, joined to everything the app knows about them.
 *
 * Lifted out of `useTankResidents` (spec 023) so that code with no React
 * around it can ask the same question and get the same answer. Publishing a
 * shared tank has to produce exactly what the owner's screen shows, and the
 * only way to be sure of that is for both to call this.
 *
 * The join is the whole point: a holding on its own is a label and a number,
 * and the viewer needs a portrait, a water level, a temperament and a price.
 * Anything the catalog cannot supply stays undefined and is counted as such
 * downstream - never defaulted, never dropped.
 */
import { db as defaultDb, type Fish2TankDB } from './db';
import { CATALOG_BY_SPECIES, cardPrice, chooseArt, marketAndScarcity, pricesBySpecies } from './catalog';
import { readProfile } from './profile';
import { deriveQuantity } from '@/domain/holdings';
import type { TankResident } from '@/domain/tank-stats';
import type { Aquarium, Id } from '@/domain/types';

export interface TankWithResidents {
  aquarium: Aquarium;
  /**
   * Every tile's art here is the BUNDLED portrait, never one of the keeper's
   * photos - see `ownArt` for why.
   */
  residents: TankResident[];
  /**
   * Which of the keeper's own photos each tile should wear, when spec 021's
   * precedence picked one. Named rather than resolved because a `Blob` in this
   * browser is not something either caller can use as-is, and the two callers
   * want opposite things: `useTankResidents` turns these into object URLs, and
   * the shared-tank projection deliberately ignores them, publishing a page of
   * bundled portraits rather than the keeper's private pictures (spec 023).
   */
  ownArt: Array<{ holdingId: Id; mediaId: Id }>;
}

export async function loadTankResidents(
  aquariumId: Id | undefined,
  database: Fish2TankDB = defaultDb,
): Promise<TankWithResidents | undefined> {
  if (!aquariumId) return undefined;
  const aquarium = await database.aquariums.get(aquariumId);
  if (!aquarium) return undefined;

  const [holdings, residencies, events, profiles, prices, account, allMedia, prefs] = await Promise.all([
    database.holdings.toArray(), database.residencies.toArray(), database.lifeEvents.toArray(),
    database.speciesProfiles.toArray(),
    // A tank's estimated value counts the keeper's own logged prices too.
    database.priceObservations.toArray(),
    // readProfile, NOT loadProfile: this runs inside a live query, and
    // loadProfile writes the row when it is missing - a write inside a
    // read-only transaction, which throws ReadOnlyError and blanks the screen
    // (spec 027). Passed the database explicitly, because defaulting it would
    // read the module-level db while every other query read the one handed in.
    readProfile(database),
    database.media.toArray(), database.cardPrefs.toArray(),
  ]);
  const prefFor = new Map(prefs.map((p) => [p.speciesId, p]));

  /** This fish's own photos, newest first. Not the species' - see chooseArt. */
  const photosOf = (specimenId: string | undefined) => (specimenId
    ? allMedia
      .filter((m) => m.kind === 'photo' && m.specimenIds.includes(specimenId))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      .map((m) => m.id)
    : []);
  const profileFor = new Map(profiles.map((p) => [p.speciesId, p]));
  const ownPrices = pricesBySpecies(prices);
  const currency = account.settings.currency;

  const residents = residencies
    .filter((r) => r.aquariumId === aquariumId && !r.endDate)
    .flatMap((r): Array<{ resident: TankResident; ownMediaId?: Id }> => {
      const holding = holdings.find((h) => h.id === r.holdingId);
      if (!holding) return [];
      const quantity = deriveQuantity(holding, events);
      if (quantity <= 0) return [];

      const entry = holding.speciesId ? CATALOG_BY_SPECIES.get(holding.speciesId) : undefined;
      const profile = holding.speciesId ? profileFor.get(holding.speciesId) : undefined;
      const market = holding.speciesId
        ? marketAndScarcity(holding.speciesId, {
            prices: ownPrices.get(holding.speciesId) ?? [], currency,
          }).market
        : undefined;

      // Adult size and minimum volume come from the curated profile where
      // there is one, and the mart otherwise - the mart carries the care
      // backfill, the profile carries the hand-written 47.
      const adultSizeIn = profile?.adultSize
        ? (profile.adultSize.unit === 'cm' ? profile.adultSize.value / 2.54 : profile.adultSize.value)
        : entry?.adultSizeIn;
      const minVolumeGal = profile?.minimumVolume
        ? (profile.minimumVolume.unit === 'l' ? profile.minimumVolume.value / 3.785411784 : profile.minimumVolume.value)
        : entry?.minVolumeGal;

      // One precedence rule for every surface that draws a fish (spec 021).
      // A tile's pool is THIS fish's photos, not the species' - two green
      // severums in two tanks are two faces, and one having a photo must not
      // lend it to the other.
      const art = chooseArt(
        entry,
        photosOf(holding.specimenId),
        holding.speciesId ? prefFor.get(holding.speciesId) : undefined,
      );

      return [{
        resident: {
          holding,
          quantity,
          speciesId: holding.speciesId,
          commonName: entry?.commonName ?? holding.rawLabel ?? 'Unidentified',
          scientificName: entry?.scientificName,
          artUrl: art.kind === 'portrait' ? art.src : undefined,
          adultSizeIn,
          minVolumeGal,
          aggression: profile?.aggression ?? (entry?.aggression as TankResident['aggression']),
          waterZone: entry?.waterZone,
          // The size-matched band where we have a size, the pooled median
          // otherwise. Undefined when the index cannot price it at all.
          unitPrice: cardPrice(market, adultSizeIn),
        } satisfies TankResident,
        ownMediaId: art.kind === 'own' ? art.mediaId : undefined,
      }];
    });

  return {
    aquarium,
    residents: residents.map((r) => r.resident),
    ownArt: residents.flatMap((r) => (r.ownMediaId
      ? [{ holdingId: r.resident.holding.id, mediaId: r.ownMediaId }]
      : [])),
  };
}

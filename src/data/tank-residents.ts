/**
 * One tank's residents, joined to everything the app knows about them.
 *
 * Lifted out of `useTankResidents` (spec 019) so that code with no React
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
import { CATALOG_BY_SPECIES, cardPrice, marketAndScarcity, portraitAsset, pricesBySpecies } from './catalog';
import { loadProfile } from './profile';
import { deriveQuantity } from '@/domain/holdings';
import type { TankResident } from '@/domain/tank-stats';
import type { Aquarium, Id } from '@/domain/types';

export interface TankWithResidents {
  aquarium: Aquarium;
  residents: TankResident[];
}

export async function loadTankResidents(
  aquariumId: Id | undefined,
  database: Fish2TankDB = defaultDb,
): Promise<TankWithResidents | undefined> {
  if (!aquariumId) return undefined;
  const aquarium = await database.aquariums.get(aquariumId);
  if (!aquarium) return undefined;

  const [holdings, residencies, events, profiles, prices, account] = await Promise.all([
    database.holdings.toArray(), database.residencies.toArray(), database.lifeEvents.toArray(),
    database.speciesProfiles.toArray(),
    // A tank's estimated value counts the keeper's own logged prices too.
    database.priceObservations.toArray(),
    // Passed the database explicitly. Defaulting it here would read the
    // module-level db while every other query read the one handed in, which a
    // test would never notice and a second database would get wrong.
    loadProfile(database),
  ]);
  const profileFor = new Map(profiles.map((p) => [p.speciesId, p]));
  const ownPrices = pricesBySpecies(prices);
  const currency = account.settings.currency;

  const residents = residencies
    .filter((r) => r.aquariumId === aquariumId && !r.endDate)
    .flatMap((r): TankResident[] => {
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

      return [{
        holding,
        quantity,
        speciesId: holding.speciesId,
        commonName: entry?.commonName ?? holding.rawLabel ?? 'Unidentified',
        scientificName: entry?.scientificName,
        portraitUrl: holding.speciesId ? portraitAsset(holding.speciesId) : undefined,
        adultSizeIn,
        minVolumeGal,
        aggression: profile?.aggression ?? (entry?.aggression as TankResident['aggression']),
        waterZone: entry?.waterZone,
        // The size-matched band where we have a size, the pooled median
        // otherwise. Undefined when the index cannot price it at all.
        unitPrice: cardPrice(market, adultSizeIn),
      }];
    });

  return { aquarium, residents };
}

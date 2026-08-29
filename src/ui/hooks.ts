import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blobFor, db } from '@/data/db';
import { CATALOG_BY_SPECIES, cardPrice, portraitAsset } from '@/data/catalog';
import { marketFor } from '@/data/market';
import { deriveBadge, deriveQuantity } from '@/domain/holdings';
import { summariseTank, type TankResident } from '@/domain/tank-stats';
import type { Aquarium, Id } from '@/domain/types';
import { useBlobUrls } from './blob-url';

export function useSpecies(id?: Id) {
  return useLiveQuery(async () => (id ? db.species.get(id) : undefined), [id]);
}

export function useSpecimen(id?: Id) {
  return useLiveQuery(async () => (id ? db.specimens.get(id) : undefined), [id]);
}

export function useRecentCatches(limit = 10) {
  return useLiveQuery(async () => {
    const specimens = await db.specimens.toArray();
    return specimens.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }, [limit]);
}

export function useTanksWithResidents() {
  return useLiveQuery(async () => {
    const [aquariums, holdings, residencies, events] = await Promise.all([
      db.aquariums.toArray(), db.holdings.toArray(), db.residencies.toArray(), db.lifeEvents.toArray(),
    ]);
    return aquariums.map((aquarium) => ({
      aquarium,
      residents: residencies
        .filter((r) => r.aquariumId === aquarium.id && !r.endDate)
        .flatMap((r) => {
          const holding = holdings.find((h) => h.id === r.holdingId);
          if (!holding) return [];
          const quantity = deriveQuantity(holding, events);
          if (quantity <= 0) return [];
          return [{ holding, quantity, badge: deriveBadge(holding, events, residencies) }];
        }),
    }));
  }, []);
}

/**
 * Original media for a specimen, newest first, as object URLs (FR-J01).
 *
 * The query yields blobs and `useBlobUrls` owns the URLs, because this hook
 * re-runs on every write to `media` or `blobs` and minting a URL inside it
 * pinned one more copy of every photo, permanently, each time.
 *
 * The query result is passed through unmapped on purpose: `useLiveQuery` keeps
 * one array identity between runs, and a `.map()` here would hand the hook a
 * new array every render and re-mint the whole set each frame.
 */
export function useSpecimenMedia(specimenId?: Id) {
  const rows = useLiveQuery(async () => {
    if (!specimenId) return [];
    const media = await db.media.where('specimenIds').equals(specimenId).toArray();
    const withBlobs = await Promise.all(
      media.map(async (m) => ({
        id: m.id,
        media: m,
        blob: blobFor(await db.blobs.get(m.originalBlobKey)),
      })),
    );
    return withBlobs
      .filter((r): r is { id: Id; media: typeof r.media; blob: Blob } => Boolean(r.blob))
      .sort((a, b) => b.media.capturedAt.localeCompare(a.media.capturedAt));
  }, [specimenId]);

  const urls = useBlobUrls(rows);

  return useMemo(
    () => rows?.map((r) => ({ media: r.media, url: urls.find((u) => u.id === r.id)?.url })),
    [rows, urls],
  );
}

/**
 * One tank's residents, joined to everything the app knows about them.
 *
 * The join is the whole point: a holding on its own is a label and a number,
 * and the viewer needs a portrait, a water level, a temperament and a price.
 * Anything the catalog cannot supply stays undefined and is counted as such
 * downstream - never defaulted, never dropped.
 */
export function useTankResidents(aquariumId: string | undefined) {
  return useLiveQuery(async (): Promise<{ aquarium: Aquarium; residents: TankResident[] } | undefined> => {
    if (!aquariumId) return undefined;
    const aquarium = await db.aquariums.get(aquariumId);
    if (!aquarium) return undefined;

    const [holdings, residencies, events, profiles] = await Promise.all([
      db.holdings.toArray(), db.residencies.toArray(), db.lifeEvents.toArray(),
      db.speciesProfiles.toArray(),
    ]);
    const profileFor = new Map(profiles.map((p) => [p.speciesId, p]));

    const residents = residencies
      .filter((r) => r.aquariumId === aquariumId && !r.endDate)
      .flatMap((r): TankResident[] => {
        const holding = holdings.find((h) => h.id === r.holdingId);
        if (!holding) return [];
        const quantity = deriveQuantity(holding, events);
        if (quantity <= 0) return [];

        const entry = holding.speciesId ? CATALOG_BY_SPECIES.get(holding.speciesId) : undefined;
        const profile = holding.speciesId ? profileFor.get(holding.speciesId) : undefined;
        const market = marketFor(holding.speciesId);

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
  }, [aquariumId]);
}

/**
 * Every tank with the numbers and the photo the index needs.
 *
 * Uses the same join and the same summariser as the single-tank viewer, so the
 * count on the list and the count inside a tank cannot disagree - which they
 * would within a month if the list computed its own.
 */
export function useTankSummaries() {
  return useLiveQuery(async () => {
    const [aquariums, holdings, residencies, events, profiles, media] = await Promise.all([
      db.aquariums.toArray(), db.holdings.toArray(), db.residencies.toArray(),
      db.lifeEvents.toArray(), db.speciesProfiles.toArray(), db.media.toArray(),
    ]);
    const profileFor = new Map(profiles.map((p) => [p.speciesId, p]));
    const mediaById = new Map(media.map((m) => [m.id, m]));

    return Promise.all(aquariums.map(async (aquarium) => {
      const residents: TankResident[] = residencies
        .filter((r) => r.aquariumId === aquarium.id && !r.endDate)
        .flatMap((r) => {
          const holding = holdings.find((h) => h.id === r.holdingId);
          if (!holding) return [];
          const quantity = deriveQuantity(holding, events);
          if (quantity <= 0) return [];
          const entry = holding.speciesId ? CATALOG_BY_SPECIES.get(holding.speciesId) : undefined;
          const profile = holding.speciesId ? profileFor.get(holding.speciesId) : undefined;
          const adultSizeIn = profile?.adultSize
            ? (profile.adultSize.unit === 'cm' ? profile.adultSize.value / 2.54 : profile.adultSize.value)
            : entry?.adultSizeIn;
          return [{
            holding, quantity,
            speciesId: holding.speciesId,
            commonName: entry?.commonName ?? holding.rawLabel ?? 'Unidentified',
            adultSizeIn,
            aggression: profile?.aggression ?? (entry?.aggression as TankResident['aggression']),
            waterZone: entry?.waterZone,
            unitPrice: cardPrice(marketFor(holding.speciesId), adultSizeIn),
          }];
        });

      const photoMedia = aquarium.photoMediaId ? mediaById.get(aquarium.photoMediaId) : undefined;
      const blob = photoMedia ? blobFor(await db.blobs.get(photoMedia.originalBlobKey)) : undefined;

      return {
        aquarium,
        stats: summariseTank(residents),
        photoUrl: blob ? URL.createObjectURL(blob) : undefined,
      };
    }));
  }, []);
}

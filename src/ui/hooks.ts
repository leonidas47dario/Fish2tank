import { useLiveQuery } from 'dexie-react-hooks';
import { blobFor, db } from '@/data/db';
import { deriveBadge, deriveQuantity } from '@/domain/holdings';
import type { Id } from '@/domain/types';

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

/** Original media for a specimen, newest first, as object URLs (FR-J01). */
export function useSpecimenMedia(specimenId?: Id) {
  return useLiveQuery(async () => {
    if (!specimenId) return [];
    const media = await db.media.where('specimenIds').equals(specimenId).toArray();
    const withUrls = await Promise.all(
      media.map(async (m) => {
        const blob = blobFor(await db.blobs.get(m.originalBlobKey));
        return { media: m, url: blob ? URL.createObjectURL(blob) : undefined };
      }),
    );
    return withUrls.sort((a, b) => b.media.capturedAt.localeCompare(a.media.capturedAt));
  }, [specimenId]);
}

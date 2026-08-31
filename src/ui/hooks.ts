import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blobFor, db } from '@/data/db';
import {
  buildCatalogCard, CATALOG_BY_SPECIES, cardPrice, catalogShapeForLocal, marketAndScarcity,
  chooseArt, pricesBySpecies, searchableSpecies,
  type CatalogCard, type CatalogSpecies,
} from '@/data/catalog';

import { deriveBadge, deriveQuantity } from '@/domain/holdings';
import { loadProfile } from '@/data/profile';
import { summariseTank, type TankResident } from '@/domain/tank-stats';
import type { Id } from '@/domain/types';
import { useBlobUrls } from './blob-url';

export function useSpecies(id?: Id) {
  return useLiveQuery(async () => (id ? db.species.get(id) : undefined), [id]);
}

/**
 * The species a search on this device can reach (spec 007).
 *
 * Live, because a keeper can submit a species from the capture flow and must
 * then be able to find it from the specimen page without a reload. The table
 * is scanned whole rather than queried: `origin` is not indexed, and the table
 * holds the 47 seeded profiles plus a handful of submissions, so an index
 * would cost more than it saves.
 *
 * Falls back to the catalog alone while the query is in flight, so the search
 * box works on first paint instead of appearing to match nothing.
 */
export function useSearchableSpecies(): CatalogSpecies[] {
  const local = useLiveQuery(() => db.species.toArray(), []);
  return useMemo(() => searchableSpecies(local ?? []), [local]);
}

/**
 * The catalog card for a species, assembled from the device.
 *
 * For callers that hold nothing else about the species - the reveal, chiefly.
 * The species page keeps its own query because it needs the surrounding rows
 * anyway, and calls buildCatalogCard directly with them; the assembly itself
 * is shared so the two cannot disagree about what a card means.
 *
 * Distinguishes "still loading" (undefined) from "no such species" (null),
 * because a speciesId can come from a stored record written before a catalog
 * rebuild and the reveal must not spin forever on one.
 */
export function useCatalogCard(speciesId?: Id): CatalogCard | null | undefined {
  return useLiveQuery(async () => {
    if (!speciesId) return null;
    // A species the keeper submitted is not in catalog.json, so fall back to
    // the local row rather than reporting the record has no identity.
    const local = CATALOG_BY_SPECIES.get(speciesId)
      ? undefined
      : await db.species.get(speciesId);
    const species = CATALOG_BY_SPECIES.get(speciesId)
      ?? (local ? catalogShapeForLocal(local) : undefined);
    if (!species) return null;

    const [specimens, snapshots, holdings, lifeEvents, residencies, media, dream] = await Promise.all([
      db.specimens.where('speciesId').equals(speciesId).toArray(),
      db.raritySnapshots.where('speciesId').equals(speciesId).toArray(),
      db.holdings.where('speciesId').equals(speciesId).toArray(),
      db.lifeEvents.toArray(), db.residencies.toArray(), db.media.toArray(),
      db.dreamList.where('speciesId').equals(speciesId).first(),
    ]);

    const keptHoldingIds = new Set(
      holdings
        .filter((h) => deriveQuantity(h, lifeEvents) > 0
          && residencies.some((r) => r.holdingId === h.id && !r.endDate))
        .map((h) => h.id),
    );
    const ownPhotoMediaIds = media
      .filter((m) => m.kind === 'photo' && m.specimenIds.some((sid) => specimens.some((s) => s.id === sid)))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      .map((m) => m.id);

    return buildCatalogCard(species, {
      specimens, holdings, keptHoldingIds, snapshots, ownPhotoMediaIds,
      onDreamList: Boolean(dream),
    });
  }, [speciesId]);
}

/**
 * Whether this is the first confirmed catch of its species.
 *
 * Used by the reveal for its "New species" line. It used to be read off the
 * discovery score's `firstConfirmedSpecies` component, which was the right
 * instinct - one source of truth - until v0.3.0 retired that component. It is
 * a fact about the collection rather than about the score, so it is counted
 * here directly instead of being inferred from a number that no longer carries
 * it.
 */
export function useIsFirstOfSpecies(specimenId?: Id, speciesId?: Id) {
  return useLiveQuery(async () => {
    if (!specimenId || !speciesId) return false;
    const confirmed = await db.specimens.where('speciesId').equals(speciesId).toArray();
    return confirmed.filter((s) => s.identityStatus === 'user-confirmed' && s.id !== specimenId).length === 0;
  }, [specimenId, speciesId]);
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
 * and the viewer needs a picture, a water level, a temperament and a price.
 * Anything the catalog cannot supply stays undefined and is counted as such
 * downstream - never defaulted, never dropped.
 *
 * The picture is the fish's own where it has one (spec 021). It used to be
 * `portraitAsset(speciesId)` unconditionally, so a tank full of fish you had
 * photographed drew a grid of stock images, which is the exact inversion of
 * principle P3.
 *
 * Two passes, because your own photos are bytes in IndexedDB rather than URLs.
 * The Dexie query picks the art and, where that art is yours, the blob behind
 * it; `useBlobUrls` then owns the object URL. Minting the URL inside the query
 * would leak one photo per write to any table it touches - see blob-url.ts,
 * which exists because four hand-rolled versions of this got it wrong twice.
 */
export function useTankResidents(aquariumId: string | undefined) {
  const raw = useLiveQuery(async () => {
    if (!aquariumId) return undefined;
    const aquarium = await db.aquariums.get(aquariumId);
    if (!aquarium) return undefined;

    const [holdings, residencies, events, profiles, prices, account, allMedia, prefs] = await Promise.all([
      db.holdings.toArray(), db.residencies.toArray(), db.lifeEvents.toArray(),
      db.speciesProfiles.toArray(),
      // A tank's estimated value counts the keeper's own logged prices too.
      db.priceObservations.toArray(), loadProfile(),
      db.media.toArray(), db.cardPrefs.toArray(),
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
      .flatMap((r) => {
        const holding = holdings.find((h) => h.id === r.holdingId);
        if (!holding) return [];
        const quantity = deriveQuantity(holding, events);
        if (quantity <= 0) return [];

        const entry = holding.speciesId ? CATALOG_BY_SPECIES.get(holding.speciesId) : undefined;
        const profile = holding.speciesId ? profileFor.get(holding.speciesId) : undefined;
        const market = holding.speciesId
          ? marketAndScarcity(holding.speciesId, { prices: ownPrices.get(holding.speciesId) ?? [], currency }).market
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

    // Only the blobs actually going on screen, keyed by holding so two
    // holdings sharing one specimen's photo each get their own URL.
    const ownBlobs: Array<{ id: Id; blob: Blob }> = [];
    for (const { resident, ownMediaId } of residents) {
      if (!ownMediaId) continue;
      const m = allMedia.find((x) => x.id === ownMediaId);
      if (!m) continue;
      const blob = blobFor(await db.blobs.get(m.originalBlobKey));
      if (blob) ownBlobs.push({ id: resident.holding.id, blob });
    }

    return { aquarium, residents: residents.map((r) => r.resident), ownBlobs };
  }, [aquariumId]);

  const urls = useBlobUrls(raw?.ownBlobs);

  return useMemo(() => {
    if (!raw) return undefined;
    const byHolding = new Map(urls.map((u) => [u.id, u.url]));
    return {
      aquarium: raw.aquarium,
      residents: raw.residents.map((r) => ({
        ...r,
        artUrl: byHolding.get(r.holding.id) ?? r.artUrl,
      })),
    };
  }, [raw, urls]);
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
    const [aquariums, holdings, residencies, events, profiles, media, prices, account] =
      await Promise.all([
        db.aquariums.toArray(), db.holdings.toArray(), db.residencies.toArray(),
        db.lifeEvents.toArray(), db.speciesProfiles.toArray(), db.media.toArray(),
        db.priceObservations.toArray(), loadProfile(),
      ]);
    const profileFor = new Map(profiles.map((p) => [p.speciesId, p]));
    const ownPrices = pricesBySpecies(prices);
    const currency = account.settings.currency;
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
            unitPrice: cardPrice(
              holding.speciesId
                ? marketAndScarcity(holding.speciesId, { prices: ownPrices.get(holding.speciesId) ?? [], currency }).market
                : undefined,
              adultSizeIn,
            ),
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

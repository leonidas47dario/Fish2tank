import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { readMediaBlob } from '@/data/media/read';
import type { RenditionSize } from '@/data/media/renditions';
import {
  buildCatalogCard, CATALOG_BY_SPECIES, cardPrice, catalogShapeForLocal, chooseArt,
  marketAndScarcity, pricesBySpecies, searchableSpecies,
  type CatalogCard, type CatalogSpecies,
} from '@/data/catalog';

import { deriveBadge, deriveQuantity } from '@/domain/holdings';
import { readProfile } from '@/data/profile';
import { loadTankResidents } from '@/data/tank-residents';
import { summariseTank, type TankResident } from '@/domain/tank-stats';
import {
  acquisitionAnchor, fishTimeline, measurementsByMedia, type Anchor, type TimelineEntry,
} from '@/domain/fish-timeline';
import { whoLivedHere, type FormerResident } from '@/domain/who-lived-here';
import type { HoldingMeasurement, Id, Media } from '@/domain/types';
import { useBlobUrl, useBlobUrls } from './blob-url';

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
 * Every photo of a specimen, newest first, at THUMBNAIL size (FR-J01).
 *
 * Spec 036: this hook feeds lists - the 64px strip on a record, and the one
 * picture a caller then chooses to show large. A list of twenty photographs
 * should cost twenty thumbnails, so the preview for whichever one is on screen
 * is fetched separately by `useMediaUrl`, not eagerly for all of them here.
 * Before spec 036 this loaded twenty full-size originals to draw twenty 64px
 * squares.
 *
 * A video has no renditions - deriving one needs frame extraction that spec
 * 029 deliberately left out - so the ladder falls straight through to the
 * original, exactly as before.
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
        blob: await readMediaBlob(m, 'thumbnail'),
      })),
    );
    return withBlobs
      .filter((r): r is { id: Id; media: typeof r.media; blob: Blob } => Boolean(r.blob))
      .sort((a, b) => b.media.capturedAt.localeCompare(a.media.capturedAt));
  }, [specimenId]);

  const urls = useBlobUrls(rows);

  return useMemo(
    () => rows?.map((r) => ({ media: r.media, thumbUrl: urls.find((u) => u.id === r.id)?.url })),
    [rows, urls],
  );
}

/**
 * One picture, at the size it is about to be drawn - spec 036.
 *
 * The companion to `useSpecimenMedia`: that hook draws the strip, this one
 * draws whichever picture the strip has selected. Keeping them apart is what
 * stops a record with twenty photos from decoding twenty previews to show one.
 *
 * Keyed on the media id rather than the row, so a `useLiveQuery` refresh that
 * hands back an equal-but-new object does not re-mint the URL under the img.
 */
export function useMediaUrl(media: Media | undefined, size: RenditionSize) {
  const blob = useLiveQuery(
    async () => (media ? readMediaBlob(media, size) : undefined),
    [media?.id, size],
  );
  return useBlobUrl(blob);
}

/**
 * One tank's residents, live.
 *
 * The join itself lives in `data/tank-residents.ts` so that publishing a
 * shared tank asks the same question this screen does (spec 023). This is the
 * subscription, plus the one thing a shared page cannot have: the keeper's own
 * photographs, which are blobs in this browser rather than anything a guest
 * could fetch. `loadTankResidents` decides WHICH photo each tile should wear
 * (spec 021's precedence); resolving it to pixels is this hook's job, and the
 * projection simply declines to, leaving the bundled portrait in place.
 */
export function useTankResidents(aquariumId: string | undefined) {
  const raw = useLiveQuery(async () => {
    const loaded = await loadTankResidents(aquariumId);
    if (!loaded) return undefined;

    // Only the blobs actually going on screen, keyed by holding so two
    // holdings sharing one specimen's photo each get their own URL.
    const ownBlobs: Array<{ id: Id; blob: Blob }> = [];
    for (const { holdingId, mediaId } of loaded.ownArt) {
      const m = await db.media.get(mediaId);
      if (!m) continue;
      // Preview: a tank tile is minmax(150px, 1fr), well past where a 320px
      // thumbnail stays sharp - spec 036.
      const blob = await readMediaBlob(m, 'preview');
      if (blob) ownBlobs.push({ id: holdingId, blob });
    }
    return { ...loaded, ownBlobs };
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
 *
 * SPEC 036 FIXED A LEAK HERE. This query used to call `URL.createObjectURL`
 * inline and never revoke it, which is precisely what `blob-url.ts` exists to
 * prevent. It re-runs on any write to eight tables - `media` and `blobs` among
 * them - so every catch logged pinned one more full-size copy of every tank
 * photo for the life of the tab. It now yields blobs and lets `useBlobUrls`
 * own the URLs, like every other media reader in the app.
 */
export function useTankSummaries() {
  const raw = useLiveQuery(async () => {
    const [aquariums, holdings, residencies, events, profiles, media, prices, account] =
      await Promise.all([
        db.aquariums.toArray(), db.holdings.toArray(), db.residencies.toArray(),
        db.lifeEvents.toArray(), db.speciesProfiles.toArray(), db.media.toArray(),
        db.priceObservations.toArray(), readProfile(),
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
      // .tankcard__art is 96x96, so the 320px thumbnail is sharp even at 3x
      // and this is one of only two surfaces small enough for it - spec 036.
      const blob = photoMedia ? await readMediaBlob(photoMedia, 'thumbnail') : undefined;

      return { id: aquarium.id, aquarium, stats: summariseTank(residents), blob };
    }));
  }, []);

  // Only the tanks that actually have a photo: `useBlobUrls` re-mints on every
  // change of identity of the array it is handed, and a tank without a picture
  // has nothing to mint.
  const withPhotos = useMemo(
    () => raw?.filter((t): t is typeof t & { blob: Blob } => Boolean(t.blob)),
    [raw],
  );
  const urls = useBlobUrls(withPhotos);

  return useMemo(() => {
    if (!raw) return undefined;
    const byTank = new Map(urls.map((u) => [u.id, u.url]));
    return raw.map(({ aquarium, stats }) => ({
      aquarium, stats, photoUrl: byTank.get(aquarium.id),
    }));
  }, [raw, urls]);
}

/**
 * One holding's whole history, merged and dated - ENH-12, spec 037.
 *
 * The join lives here and the RULES live in `domain/fish-timeline.ts`, which is
 * pure and tested. This hook only fetches; it decides nothing, so what the
 * screen shows and what the tests assert cannot drift apart.
 *
 * Photos are those of the holding's specimen. A holding imported without one
 * has no photos and still gets a timeline from its life events, which is the
 * point: nothing has to be entered for this to be useful.
 */
export interface FishTimelineView {
  holdingId: Id;
  entries: TimelineEntry[];
  anchor?: Anchor;
  /** The measurement each photo was read from, so they render as one row. */
  byMedia: Map<Id, HoldingMeasurement>;
  quantity: number;
  isGroup: boolean;
  acquiredOn?: string;
  photos: Array<{ id: Id; on: string }>;
}

export function useFishTimeline(holdingId?: Id): FishTimelineView | undefined {
  return useLiveQuery(async () => {
    if (!holdingId) return undefined;
    const holding = await db.holdings.get(holdingId);
    if (!holding) return undefined;

    const [events, measurements, memorials, notes] = await Promise.all([
      db.lifeEvents.where('holdingId').equals(holdingId).toArray(),
      db.holdingMeasurements.where('holdingId').equals(holdingId).toArray(),
      db.memorials.where('holdingId').equals(holdingId).toArray(),
      // Spec 046. A dated note is an observation like any other, so it merges
      // into the same stream rather than living in a section of its own.
      db.keeperNotes.where('holdingId').equals(holdingId).toArray(),
    ]);
    const media = holding.specimenId
      ? await db.media.where('specimenIds').equals(holding.specimenId).toArray()
      : [];

    return {
      holdingId,
      entries: fishTimeline({ holdingId, events, media, measurements, memorials, notes }),
      anchor: acquisitionAnchor(holding, events, media),
      byMedia: measurementsByMedia(measurements, media),
      quantity: deriveQuantity(holding, events),
      isGroup: holding.kind === 'group',
      acquiredOn: holding.acquiredOn,
      /** Photos a measurement can say it was read from, newest first. */
      photos: media
        .filter((m) => m.kind === 'photo')
        .map((m) => ({ id: m.id, on: m.capturedAt.slice(0, 10) }))
        .sort((a, b) => b.on.localeCompare(a.on)),
    };
  }, [holdingId]);
}

/**
 * Who lived in a tank and does not now - spec 048.
 *
 * The join lives here and the RULES live in `domain/who-lived-here.ts`, which
 * is pure and tested. This hook only fetches; it decides nothing, so what a
 * test asserts and what a keeper sees cannot drift apart.
 */
export interface FormerResidentView extends FormerResident {
  scientificName?: string;
  /** The bundled portrait, when that is what this fish wears. */
  artUrl?: string;
}

export function useWhoLivedHere(aquariumId?: Id): FormerResidentView[] | undefined {
  const raw = useLiveQuery(async () => {
    if (!aquariumId) return undefined;
    const [residencies, holdings, memorials, specimens, aquariums, media, prefs] =
      await Promise.all([
        db.residencies.toArray(), db.holdings.toArray(), db.memorials.toArray(),
        db.specimens.toArray(), db.aquariums.toArray(), db.media.toArray(),
        db.cardPrefs.toArray(),
      ]);

    const rows = whoLivedHere({
      aquariumId, residencies, holdings, memorials, specimens, aquariums,
      // The catalog lives outside `domain/`, so the names are handed in.
      speciesNames: new Map(
        [...CATALOG_BY_SPECIES.values()].map((e) => [e.speciesId, e.commonName]),
      ),
    });

    /*
     * Spec 050. THE ART IS RESOLVED HERE, NOT IN `loadTankResidents`, and that
     * is a boundary rather than a convenience: that function also feeds the
     * public shared-tank projection, whose whole point (spec 023) is that it
     * publishes bundled portraits and never the keeper's private photographs.
     * Teaching it about departed fish would put their pictures one careless
     * field away from a public page. This hook is inside the account by
     * construction, so the question cannot arise.
     *
     * Precedence is `chooseArt`'s, unchanged since spec 021: this fish's own
     * photograph where there is one, the bundled portrait otherwise, and an
     * honest placeholder when neither exists.
     */
    const holdingById = new Map(holdings.map((h) => [h.id, h]));
    const prefFor = new Map(prefs.map((p) => [p.speciesId, p]));

    const out: Array<FormerResidentView & { blob?: Blob }> = [];
    for (const row of rows) {
      const holding = holdingById.get(row.holdingId);
      const speciesId = holding?.speciesId;
      const entry = speciesId ? CATALOG_BY_SPECIES.get(speciesId) : undefined;

      const ownPhotos = row.specimenId
        ? media
          .filter((m) => m.kind === 'photo' && m.specimenIds.includes(row.specimenId!))
          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
          .map((m) => m.id)
        : [];

      const art = chooseArt(entry, ownPhotos, speciesId ? prefFor.get(speciesId) : undefined);

      let blob: Blob | undefined;
      if (art.kind === 'own') {
        const m = media.find((x) => x.id === art.mediaId);
        // Preview: a tile is minmax(150px, 1fr), well past where a 320px
        // thumbnail stays sharp - spec 036.
        if (m) blob = await readMediaBlob(m, 'preview');
      }

      out.push({
        ...row,
        scientificName: entry?.scientificName,
        artUrl: art.kind === 'portrait' ? art.src : undefined,
        blob,
      });
    }
    return out;
  }, [aquariumId]);

  // `useBlobUrls` re-mints on every change of identity of the array it is
  // handed, so this is memoised rather than filtered inline (BUG-13's rule).
  const withPhotos = useMemo(
    () => raw?.filter((r): r is typeof r & { blob: Blob } => Boolean(r.blob)),
    [raw],
  );
  const urls = useBlobUrls(withPhotos);

  return useMemo(() => {
    if (!raw) return undefined;
    const byId = new Map(urls.map((u) => [u.id, u.url]));
    // `id` is the residency, which is what `useBlobUrls` was keyed on: a
    // holding that lived here twice is two tiles and must not share one URL.
    return raw.map(({ blob: _blob, ...row }) => ({
      ...row,
      artUrl: byId.get(row.id) ?? row.artUrl,
    }));
  }, [raw, urls]);
}

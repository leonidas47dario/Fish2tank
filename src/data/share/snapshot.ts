/**
 * A tank, projected into the file a stranger is allowed to read - spec 023.
 *
 * Pure, and separate from the code that publishes it, because this is the one
 * place that decides what leaves the device. A projection you can test
 * field-by-field is worth more than a serialiser you have to review by eye
 * every time somebody adds a column.
 *
 * TWO RULES, BOTH LOAD-BEARING (FR-S07).
 *
 * 1. NEVER SPREAD A RECORD. Every published field is named here explicitly.
 *    `{ ...holding }` would publish a keeper's private notes the day somebody
 *    adds notes to holdings, and nothing would fail to warn them. The exact
 *    key assertion in the test is the alarm on this rule.
 *
 * 2. THE KEY LIST IS DERIVED FROM THE PROJECTION, never assembled beside it.
 *    `allowedBlobKeys` is read back off the built object, so a photo cannot
 *    appear in the view without also being permitted, and no key can be
 *    permitted that the view does not reference. Two lists maintained in
 *    parallel would drift, and the direction they drift decides whether this
 *    is a broken image or a data leak.
 *
 * WHY STATS ARE COMPUTED HERE rather than by the guest. The asker wanted a
 * guest to see "the exact same thing", and recomputing invites drift: a guest
 * on a newer build has a newer catalog, and a fish that got re-measured last
 * week would silently change somebody's shared tank. It also keeps the
 * keeper's own logged prices out of the published file, since estimated value
 * depends on them (see hooks.ts, useTankResidents).
 */
import { summariseTank, type TankResident, type TankStats } from '@/domain/tank-stats';
import type { AggressionRating, Aquarium, VolumeMeasurement } from '@/domain/types';
import type { WaterZone } from '@/data/seed/taxonomy';

/** Bumped when the shape changes in a way an old guest page could not read. */
export const SNAPSHOT_VERSION = 1;

/** One fish, as a guest sees it. Nothing here identifies a record. */
export interface SharedResident {
  speciesId?: string;
  commonName: string;
  scientificName?: string;
  quantity: number;
  adultSizeIn?: number;
  minVolumeGal?: number;
  aggression?: AggressionRating;
  waterZone?: WaterZone;
  unitPrice?: number;
  /**
   * The keeper's own photograph of THIS fish, when there is one and it is in
   * R2 (spec 026). Absent means the guest draws the bundled portrait, exactly
   * as the owner's screen does for a fish nobody has photographed.
   */
  photoBlobKey?: string;
}

/** The tank itself. No id: a share is named by its token, not by a record. */
export interface SharedTankInfo {
  name: string;
  kind: string;
  volume?: VolumeMeasurement;
  /** The one private photo a tank view shows. Absent when there is none. */
  photoBlobKey?: string;
}

/**
 * The file as it sits in R2.
 *
 * `owner` and `allowedBlobKeys` are the Worker's business and are stripped
 * before a guest sees any of it - see `toPublic`.
 */
export interface SharedSnapshot {
  version: number;
  token: string;
  publishedAt: string;
  /** Which build published it, so a rendering complaint can be placed in time. */
  buildId: string;
  /** The Dexie Cloud subject whose R2 prefix the photos live under. */
  owner: string;
  /** The only keys this token may fetch. Membership is the access check. */
  allowedBlobKeys: string[];
  tank: SharedTankInfo;
  residents: SharedResident[];
  stats: TankStats;
}

/** What a guest receives. */
export type PublicSnapshot = Omit<SharedSnapshot, 'owner' | 'allowedBlobKeys'>;

export interface SnapshotInput {
  aquarium: Aquarium;
  residents: TankResident[];
  /** The blob key of the tank photo, when there is one AND it is in R2. */
  tankPhotoBlobKey: string | undefined;
  /**
   * Per-fish photo keys by holding id, same rule as the tank photo: present
   * only when the object is confirmed in the bucket (spec 026). A holding
   * absent from this map draws its portrait.
   */
  residentPhotoKeys?: ReadonlyMap<string, string>;
  token: string;
  publishedAt: string;
  buildId: string;
  owner: string;
}

export function buildSnapshot(input: SnapshotInput): SharedSnapshot {
  const {
    aquarium, residents, tankPhotoBlobKey, residentPhotoKeys, token, publishedAt, buildId, owner,
  } = input;

  const tank: SharedTankInfo = {
    name: aquarium.name,
    kind: aquarium.kind,
    volume: aquarium.volume,
    photoBlobKey: tankPhotoBlobKey,
  };

  // Named field by field. See rule 1 above before replacing this with a spread.
  const projected: SharedResident[] = residents.map((r) => ({
    speciesId: r.speciesId,
    commonName: r.commonName,
    scientificName: r.scientificName,
    quantity: r.quantity,
    adultSizeIn: r.adultSizeIn,
    minVolumeGal: r.minVolumeGal,
    aggression: r.aggression,
    waterZone: r.waterZone,
    unitPrice: r.unitPrice,
    photoBlobKey: residentPhotoKeys?.get(r.holding.id),
  }));

  // Summarised from the ORIGINAL residents, not the projection: summariseTank
  // reads `holding` for its per-fish identity and the projection has dropped
  // it. The numbers are therefore identical to the ones on the owner's screen,
  // which is the whole point.
  const stats = summariseTank(residents);

  const snapshot: SharedSnapshot = {
    version: SNAPSHOT_VERSION,
    token,
    publishedAt,
    buildId,
    owner,
    allowedBlobKeys: [],
    tank,
    residents: projected,
    stats,
  };

  // Rule 2: read the keys back off what was actually built.
  snapshot.allowedBlobKeys = collectBlobKeys(snapshot);
  return snapshot;
}

/**
 * Every photo key the built view references.
 *
 * The tank photo AND every resident's own photograph (spec 026). Spec 023
 * shipped portraits-only here, which contradicted the ask it was built from -
 * "anyone should be able to review the page and see the exact same thing" -
 * and the keeper reported it as a bug, correctly.
 *
 * THIS LIST IS THE SECURITY BOUNDARY. The Worker serves a photo only if its
 * key is in here, so a key that reaches the page without reaching this list is
 * a broken image, and a key in this list that the page never shows is an
 * object published for no reason. Both are why rule 2 reads the keys back off
 * the built snapshot rather than off the inputs.
 *
 * The cost is real and is the reason spec 023 hesitated: each key is an
 * untouched original, measured at 3.6 MB in spec 005, so a tank of twenty
 * photographed fish is a large page. Tiles are `loading="lazy"`, so a guest
 * pays only for what scrolls into view - and FR-A08 (derived thumbnails,
 * still unbuilt) is what would make it cheap rather than merely deferred.
 */
function collectBlobKeys(snapshot: SharedSnapshot): string[] {
  const keys = [
    snapshot.tank.photoBlobKey,
    ...snapshot.residents.map((r) => r.photoBlobKey),
  ].filter((k): k is string => Boolean(k));
  return [...new Set(keys)];
}

/**
 * A fingerprint of everything a guest can see (FR-S03).
 *
 * The automatic republisher compares this against the published copy's, so
 * that an edit a guest cannot see - renaming a holding's private note, say -
 * does not spend a write. It covers what `buildSnapshot` publishes, minus the
 * three fields that change on every publish by definition (`token`,
 * `publishedAt`, `buildId`), which would otherwise make every fingerprint
 * differ from every other and the comparison pointless.
 *
 * THE PHOTO IS KEYED BY ITS MEDIA ID, NOT ITS BLOB KEY, and the distinction
 * cost a bug before it was noticed. `tank.photoBlobKey` is present only when
 * the bytes had reached R2 at publish time, so a fingerprint built from it
 * compares a *content* question against a *sync-state* answer: a tank whose
 * photo had not yet uploaded would read as changed on every single tick,
 * forever. The media id is a fact about the tank and settles.
 *
 * That leaves "the photo finished syncing after we published" outside this
 * function, which is correct - it is not a content change. `needsRepublish`
 * owns that case.
 *
 * SPEC 026 EXTENDED THE SAME TRAP AND THE SAME FIX. Residents now carry a
 * `photoBlobKey`, which is a sync-state answer for exactly the same reason, so
 * the resident list is hashed WITHOUT it and the fish's media ids are hashed
 * instead. Hashing `snapshot.residents` wholesale here would have made every
 * tank containing one unsynced fish photo republish forever - the bug this
 * docstring already describes, reintroduced one field over.
 *
 * 64 bits of FNV-1a, as two 32-bit halves. Not cryptographic and does not need
 * to be - nobody is attacking it, and the consequence of the ~1-in-10^19
 * collision is one skipped republish, not a wrong page.
 */
export function fingerprintOf(
  snapshot: SharedSnapshot,
  photoMediaId?: string,
  residentMediaIds?: readonly string[],
): string {
  // Content only. `photoBlobKey` is dropped for the reason above; everything
  // else about a resident is a fact about the tank.
  const residentsWithoutSyncState = snapshot.residents.map(
    ({ photoBlobKey: _ignored, ...rest }) => rest,
  );
  const material = JSON.stringify([
    snapshot.tank.name,
    snapshot.tank.kind,
    snapshot.tank.volume ?? null,
    photoMediaId ?? null,
    residentMediaIds ?? null,
    residentsWithoutSyncState,
    snapshot.stats,
  ]);
  return `${fnv1a(material, 0x811c9dc5)}${fnv1a(material, 0x01000193)}`;
}

/**
 * Whether the published page is behind the tank.
 *
 * Two independent reasons, and both are needed:
 *
 *   1. The content changed - a fish in or out, a rename, a new volume.
 *   2. The tank has a photo that the published page does not, because the
 *      bytes had not reached R2 last time. Nothing about the tank changes when
 *      that upload finally lands, so the fingerprint cannot see it, and
 *      without this clause the photo would never appear for guests until
 *      somebody pressed the button by hand.
 */
export function needsRepublish(
  published: { fingerprint: string; photoIncluded: boolean; photoCount?: number },
  current: { fingerprint: string; hasPhoto: boolean; photoCount?: number },
): boolean {
  if (current.fingerprint !== published.fingerprint) return true;
  if (current.hasPhoto && !published.photoIncluded) return true;
  // Spec 026, clause 2 again, per fish: a resident's photo that finished
  // uploading after the last publish changes nothing about the tank, so the
  // fingerprint cannot see it either. Counting the keys actually published is
  // enough - it only ever rises as uploads land, and a fish leaving the tank
  // is a content change the fingerprint already caught.
  return (current.photoCount ?? 0) > (published.photoCount ?? 0);
}

function fnv1a(input: string, seed: number): string {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, via shifts: `hash * 16777619` overflows to a float.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Strip what the Worker keeps to itself.
 *
 * `owner` is not a capability - a guest holding it still cannot read
 * `users/{owner}/` without a token bound to that subject - but it is somebody's
 * account identifier and it has no business on a public page.
 */
export function toPublic(snapshot: SharedSnapshot): PublicSnapshot {
  const { owner: _owner, allowedBlobKeys: _keys, ...rest } = snapshot;
  return rest;
}

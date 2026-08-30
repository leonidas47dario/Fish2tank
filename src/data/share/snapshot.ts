/**
 * A tank, projected into the file a stranger is allowed to read - spec 015.
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
  token: string;
  publishedAt: string;
  buildId: string;
  owner: string;
}

export function buildSnapshot(input: SnapshotInput): SharedSnapshot {
  const { aquarium, residents, tankPhotoBlobKey, token, publishedAt, buildId, owner } = input;

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
 * One key today, because resident tiles render bundled stock portraits
 * (`portraitAsset`, catalog.ts) and the tank photo is the only private image
 * a tank view shows. Kept as a list because the membership check in the Worker
 * is what makes the media route safe, and that check reads a list either way.
 */
function collectBlobKeys(snapshot: SharedSnapshot): string[] {
  const keys = [snapshot.tank.photoBlobKey].filter((k): k is string => Boolean(k));
  return [...new Set(keys)];
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

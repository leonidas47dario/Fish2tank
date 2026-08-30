/**
 * Local-first storage.
 *
 * The MVP has NO backend. PRD 12.1 leaves the cloud/auth provider explicitly
 * open ("Select after prototype stack review; requirements remain
 * provider-neutral"), and PRD 2.2/8.2 require the product to be private and
 * complete for one person. So every record and every original media file lives
 * in IndexedDB on the device, and the sync seam below is where a provider
 * plugs in later without the rest of the app changing (NFR-12).
 *
 * Media originals are stored as Blobs in their own table, keyed separately
 * from the Media metadata row, so a thumbnail or preview can be regenerated or
 * evicted without ever touching the original (NFR-03).
 */
import Dexie, { type EntityTable } from 'dexie';
import { DB_NAME } from '@/build-info';
import type {
  Aquarium,
  CompatibilityAssessment,
  DreamListItem,
  Encounter,
  Holding,
  Id,
  IdentificationAssertion,
  KeeperPrinciple,
  LifeEvent,
  Media,
  Memorial,
  Place,
  PriceObservation,
  RaritySnapshot,
  Residency,
  Species,
  SpeciesProfile,
  Specimen,
  User,
} from '@/domain/types';

/** The untouched original bytes. Never rewritten in place. */
/**
 * Original media bytes, held as an ArrayBuffer rather than a Blob.
 *
 * WHY NOT A BLOB. WebKit's IndexedDB stores a Blob by reference to a file it
 * manages, not as bytes inside the record. That indirection is where iOS loses
 * photos: the write can fail outright when the source File's backing has gone
 * stale, and a record written successfully can still come back unreadable
 * after the browser reclaims the backing file. Either way the failure is
 * silent-ish and late, and the photo is gone - which for this app is the worst
 * outcome there is, because the media IS the record (principle P3).
 *
 * An ArrayBuffer is stored inline in the record, so it cannot be reclaimed
 * out from under us and cannot depend on a file handle the page does not own.
 * The Blob is reconstructed on read, where it is cheap.
 *
 * `blob` is kept optional purely to read records written before this change.
 * Nothing writes it any more; `blobFor()` is the only thing that should look
 * at it.
 */
export interface StoredBlob {
  key: string;
  /** The bytes themselves. Absent only on records written before the switch. */
  data?: ArrayBuffer;
  /** Legacy: a Blob written by an earlier version. Read, never written. */
  blob?: Blob;
  bytes: number;
  mimeType: string;
  storedAt: string;
}

/**
 * The media as a Blob, whichever way it was stored.
 *
 * Returns undefined rather than throwing for a record that has neither - a
 * missing photo should degrade to the placeholder the card already has, not
 * take the screen down.
 */
export function blobFor(stored: StoredBlob | undefined): Blob | undefined {
  if (!stored) return undefined;
  if (stored.data) return new Blob([stored.data], { type: stored.mimeType });
  return stored.blob;
}

/**
 * How the catalog should illustrate a species you have caught.
 *
 * Principle P3 says "the exact specimen matters", so when you have your own
 * photo of a fish that is the default art - a stock portrait of the species is
 * a fallback, not the point. This lets you flip back per species anyway,
 * because a bad phone photo through algae is sometimes worse than the
 * reference shot.
 */
export interface CardPref {
  speciesId: Id;
  artSource: 'own' | 'portrait';
  /** Which of your photos, when you have several. */
  preferredMediaId?: Id;
  updatedAt: string;
}

/**
 * A catch draft is created before its media finishes writing (FR-C02), so the
 * client key lets a retry find the existing draft instead of making a second
 * one (FR-C07).
 */
export interface DraftKey {
  clientKey: string;
  specimenId: Id;
  encounterId: Id;
  createdAt: string;
}

/**
 * A record the user deleted on purpose.
 *
 * WHY A TOMBSTONE AND NOT JUST A DELETE. Some records are seeded on boot -
 * the Panther, the starter tanks, the inventory import - and every one of those
 * seeders is guarded by "does this id already exist?". Deleting a seeded record
 * therefore un-guards its seeder, and the thing the user just removed comes
 * back on the next load. That is the single most infuriating outcome a delete
 * button can have, so the id is remembered and the seeder checks it.
 *
 * It stores an id and a date, never the content. This is a note that something
 * was deleted, not a recycle bin - the user asked for the record to be gone.
 */
export interface DeletedRecord {
  id: Id;
  deletedAt: string;
  /** What kind of thing it was, so a future undo or audit can tell them apart. */
  kind: 'specimen' | 'aquarium' | 'media';
}

export class Fish2TankDB extends Dexie {
  users!: EntityTable<User, 'id'>;
  places!: EntityTable<Place, 'id'>;
  species!: EntityTable<Species, 'id'>;
  speciesProfiles!: EntityTable<SpeciesProfile, 'id'>;
  specimens!: EntityTable<Specimen, 'id'>;
  encounters!: EntityTable<Encounter, 'id'>;
  media!: EntityTable<Media, 'id'>;
  blobs!: EntityTable<StoredBlob, 'key'>;
  identifications!: EntityTable<IdentificationAssertion, 'id'>;
  priceObservations!: EntityTable<PriceObservation, 'id'>;
  raritySnapshots!: EntityTable<RaritySnapshot, 'id'>;
  dreamList!: EntityTable<DreamListItem, 'id'>;
  aquariums!: EntityTable<Aquarium, 'id'>;
  holdings!: EntityTable<Holding, 'id'>;
  residencies!: EntityTable<Residency, 'id'>;
  lifeEvents!: EntityTable<LifeEvent, 'id'>;
  assessments!: EntityTable<CompatibilityAssessment, 'id'>;
  memorials!: EntityTable<Memorial, 'id'>;
  keeperPrinciples!: EntityTable<KeeperPrinciple, 'id'>;
  draftKeys!: EntityTable<DraftKey, 'clientKey'>;
  cardPrefs!: EntityTable<CardPref, 'speciesId'>;
  deletedRecords!: EntityTable<DeletedRecord, 'id'>;

  /**
   * @param addons Dexie addons to install, empty by default so the offline app
   *   is unchanged. This is the seam NFR-12 asks for: spec 005 plugs
   *   `dexie-cloud-addon` in here, and nothing else in the app has to know.
   *   Passed at construction because Dexie can only take addons there.
   */
  constructor(name = DB_NAME, addons: Array<(db: Dexie) => void> = []) {
    super(name, { addons });
    this.version(1).stores({
      users: 'id',
      places: 'id, name, isFavorite',
      species: 'id, commonName, scientificName',
      speciesProfiles: 'id, speciesId',
      specimens: 'id, speciesId, identityStatus, status, nickname',
      encounters: 'id, specimenId, placeId, observedAt, syncState',
      media: 'id, encounterId, kind, syncState, *specimenIds',
      blobs: 'key',
      identifications: 'id, specimenId, assertedAt',
      priceObservations: 'id, speciesId, specimenId, encounterId, observedAt',
      raritySnapshots: 'id, specimenId, speciesId, revealedAt',
      dreamList: 'id, speciesId, addedAt',
      aquariums: 'id, name, status',
      holdings: 'id, specimenId, speciesId, openingBalance',
      residencies: 'id, holdingId, aquariumId, startDate, endDate',
      lifeEvents: 'id, holdingId, type, occurredOn',
      assessments: 'id, specimenId, aquariumId, assessedAt',
      memorials: 'id, holdingId, specimenId, occurredOn',
      keeperPrinciples: 'id, sourceMemorialId',
      draftKeys: 'clientKey, specimenId',
    });

    // v2 adds catalog art preferences. Dexie carries v1 data forward
    // untouched; no migration function is needed for a pure addition.
    this.version(2).stores({
      cardPrefs: 'speciesId',
    });

    // v3 adds deletion tombstones, so a deleted seed record stays deleted.
    // Pure addition again; existing data is carried forward untouched.
    this.version(3).stores({
      deletedRecords: 'id, deletedAt',
    });

    /**
     * v4 retires two species that were never species (spec 005).
     *
     * THE FIRST MIGRATION IN THIS APP THAT REWRITES USER DATA, so it is worth
     * being explicit about what it may and may not touch. It rewrites
     * `speciesId` references and nothing else. No record is deleted, no photo
     * is dropped, no story is edited, and a specimen whose species is retired
     * keeps its identity history - the assertion that named it is still there
     * and still auditable (FR-I06).
     *
     * Without this the references dangle. `sp_roofvissen_fotografie` is gone
     * from the catalog after the mart rebuild, so a specimen still pointing at
     * it would render with no species and its species page would be a dead
     * end. That fish is real; only the name was wrong.
     */
    this.version(4).stores({}).upgrade(async (tx) => {
      const start = Date.now();
      const counts: Record<string, number> = {};

      for (const [table, key] of RETIRED_SPECIES_TABLES) {
        for (const [from, to] of Object.entries(RETIRED_SPECIES)) {
          const rows = await tx.table(table).where(key).equals(from).toArray();
          if (rows.length === 0) continue;

          for (const row of rows) {
            // cardPrefs is keyed BY speciesId, so it is a delete-and-reinsert
            // rather than an update - Dexie will not move a primary key.
            if (key === 'speciesId' && table === 'cardPrefs') {
              await tx.table(table).delete(from);
              if (to) await tx.table(table).put({ ...row, speciesId: to });
            } else {
              await tx.table(table).update(row.id, { [key]: to });
            }
          }
          counts[`${table}.${from}`] = rows.length;
          console.info('[migrate v4] remapped species reference', {
            table, from, to: to ?? '(cleared)', rows: rows.length,
          });
        }
      }

      // Verify, rather than reporting a migration nobody checked. A dangling
      // reference left behind here is invisible until a screen renders blank.
      const left: string[] = [];
      for (const [table, key] of RETIRED_SPECIES_TABLES) {
        for (const from of Object.keys(RETIRED_SPECIES)) {
          if (await tx.table(table).where(key).equals(from).count() > 0) left.push(`${table}.${from}`);
        }
      }
      if (left.length > 0) {
        console.error('[migrate v4] references survived the remap', { left });
        throw new Error(`Species remap incomplete: ${left.join(', ')}`);
      }

      console.info('[migrate v4] done', {
        ms: Date.now() - start,
        remapped: Object.keys(counts).length === 0 ? 'nothing to do' : counts,
      });
    });
  }
}

/**
 * Retired species ids, and what a reference to one becomes.
 *
 * See NOT_A_SPECIES in seed/species-overrides.ts for why each was dropped.
 *   - The Red Wolf Fish is a real animal that was minted under a photo
 *     credit, so its references move to the catalog entry for the same fish.
 *   - Fish food is not an animal, so a reference to it becomes no species at
 *     all rather than being pointed at some arbitrary substitute.
 */
const RETIRED_SPECIES: Record<string, string | undefined> = {
  sp_roofvissen_fotografie: 'sp_erythrinus_erythrinus',
  sp_fish_food: undefined,
};

/** Every table that stores a species reference, and the field holding it. */
const RETIRED_SPECIES_TABLES: ReadonlyArray<readonly [string, string]> = [
  ['specimens', 'speciesId'],
  ['holdings', 'speciesId'],
  ['raritySnapshots', 'speciesId'],
  ['priceObservations', 'speciesId'],
  ['dreamList', 'speciesId'],
  ['cardPrefs', 'speciesId'],
];

export const db = new Fish2TankDB();

export function newId(prefix: string): Id {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

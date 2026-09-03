/**
 * What an archive claims to contain, and the check that it does.
 *
 * Spec 006 FR-A09. The manifest exists so an import can refuse a file rather
 * than half-restore one. A partial restore over a live database is worse than
 * no restore: you cannot tell what is yours, what came back, and what is
 * missing, and the app reports success either way.
 *
 * "Make green mean verified": the counts here are recomputed from the archive
 * on the way in, never trusted from the file that asserts them.
 */

/** Bumped when the archive layout changes in a way an old reader cannot handle. */
export const ARCHIVE_VERSION = 1;

export const MANIFEST_PATH = 'manifest.json';
export const RECORDS_PATH = 'records.json';
export const MEDIA_PREFIX = 'media/';

/**
 * Every table an export carries.
 *
 * `species` and `speciesProfiles` are here even though spec 005 FR-A01 keeps
 * them out of *sync*, because a keeper can type in a species the catalog
 * lacks. Only the `user-submitted` rows are written; see collectRecords().
 * Getting this wrong drops personal data and orphans the specimens pointing
 * at it, which a backup must never do.
 *
 * `draftKeys` is absent on purpose: it is per-device retry bookkeeping and
 * means nothing on another machine. So is the seeded catalog, which
 * regenerates from `npm run marts`.
 */
export const EXPORTED_TABLES = [
  'users',
  'places',
  'species',
  'speciesProfiles',
  'specimens',
  'encounters',
  'media',
  'identifications',
  'priceObservations',
  'raritySnapshots',
  'dreamList',
  'aquariums',
  'holdings',
  'residencies',
  'lifeEvents',
  'assessments',
  'memorials',
  'keeperPrinciples',
  // Spec 037. Omitting it would make a backup silently lose every
  // measurement, which is the one failure a backup must never have.
  'holdingMeasurements',
  'cardPrefs',
] as const;

export type ExportedTable = (typeof EXPORTED_TABLES)[number];

export interface ArchiveManifest {
  version: number;
  exportedAt: string;
  /** Which build wrote it, so an odd archive can be traced to a release. */
  appBuild: string;
  /** Row count per table, as written. */
  tables: Record<string, number>;
  media: {
    count: number;
    bytes: number;
  };
}

export type RecordBundle = Record<string, unknown[]>;

/** What was actually found in the archive, recomputed rather than read. */
export interface ArchiveActuals {
  tables: Record<string, number>;
  media: { count: number; bytes: number };
}

/**
 * Compares what the archive says against what it holds.
 *
 * Returns every disagreement rather than the first, because a truncated
 * download tends to break several things at once and reporting one at a time
 * turns a diagnosis into a guessing game.
 */
export function verifyManifest(
  manifest: ArchiveManifest,
  actual: ArchiveActuals,
): string[] {
  const problems: string[] = [];

  if (manifest.version !== ARCHIVE_VERSION) {
    problems.push(
      `archive version ${manifest.version} but this build reads version ${ARCHIVE_VERSION}`,
    );
  }

  for (const [table, claimed] of Object.entries(manifest.tables)) {
    const found = actual.tables[table] ?? 0;
    if (found !== claimed) {
      problems.push(`${table}: manifest claims ${claimed} rows, archive holds ${found}`);
    }
  }

  // A table present in the archive but absent from the manifest is just as
  // wrong as the reverse: it means the two were written by different code.
  for (const table of Object.keys(actual.tables)) {
    if (!(table in manifest.tables)) {
      problems.push(`${table}: present in the archive but not named in the manifest`);
    }
  }

  if (actual.media.count !== manifest.media.count) {
    problems.push(
      `media: manifest claims ${manifest.media.count} files, archive holds ${actual.media.count}`,
    );
  }
  if (actual.media.bytes !== manifest.media.bytes) {
    problems.push(
      `media: manifest claims ${manifest.media.bytes} bytes, archive holds ${actual.media.bytes}`,
    );
  }

  return problems;
}

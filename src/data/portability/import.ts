/**
 * Reading a collection back in.
 *
 * Spec 006 FR-A09. Three properties matter more than speed here, and each one
 * is a way restores usually go wrong:
 *
 *   1. VERIFY BEFORE WRITING. The manifest is checked against what the archive
 *      actually holds, and a mismatch rejects the whole file. A half-restore
 *      over a live database is worse than a refusal, because afterwards you
 *      cannot tell what is yours, what came back, and what is missing.
 *   2. IDEMPOTENT. Rows are keyed on the IDs already in the archive, so
 *      importing twice leaves one copy. A duplicated 61-row inventory is a bad
 *      way to discover this was not handled.
 *   3. ADDITIVE. Nothing local is deleted because the archive did not mention
 *      it. Restoring a six-month-old backup must not erase six months.
 */
import { unzipSync } from 'fflate';
import { db, type Fish2TankDB } from '../db';
import {
  MANIFEST_PATH,
  MEDIA_PREFIX,
  RECORDS_PATH,
  verifyManifest,
  type ArchiveActuals,
  type ArchiveManifest,
  type RecordBundle,
} from './manifest';

export interface ImportResult {
  manifest: ArchiveManifest;
  /** Rows written per table. */
  tables: Record<string, number>;
  mediaRestored: number;
  mediaBytes: number;
}

export class ArchiveRejected extends Error {
  constructor(public readonly problems: string[]) {
    super(`This archive was rejected and nothing was imported:\n- ${problems.join('\n- ')}`);
    this.name = 'ArchiveRejected';
  }
}

interface ParsedArchive {
  manifest: ArchiveManifest;
  records: RecordBundle;
  media: Map<string, Uint8Array>;
}

/** Unpacks and validates shape, without touching the database. */
export function parseArchive(bytes: Uint8Array): ParsedArchive {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder();

  const manifestRaw = files[MANIFEST_PATH];
  if (!manifestRaw) throw new ArchiveRejected([`no ${MANIFEST_PATH} in the archive`]);
  const recordsRaw = files[RECORDS_PATH];
  if (!recordsRaw) throw new ArchiveRejected([`no ${RECORDS_PATH} in the archive`]);

  let manifest: ArchiveManifest;
  let records: RecordBundle;
  try {
    manifest = JSON.parse(decoder.decode(manifestRaw)) as ArchiveManifest;
    records = JSON.parse(decoder.decode(recordsRaw)) as RecordBundle;
  } catch (err) {
    throw new ArchiveRejected([`could not parse the archive JSON: ${String(err)}`]);
  }

  const media = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    if (path.startsWith(MEDIA_PREFIX)) media.set(path.slice(MEDIA_PREFIX.length), data);
  }

  return { manifest, records, media };
}

/** What the archive actually holds, counted rather than believed. */
export function actualsOf(parsed: ParsedArchive): ArchiveActuals {
  let bytes = 0;
  for (const data of parsed.media.values()) bytes += data.byteLength;
  return {
    tables: Object.fromEntries(
      Object.entries(parsed.records).map(([t, rows]) => [t, Array.isArray(rows) ? rows.length : -1]),
    ),
    media: { count: parsed.media.size, bytes },
  };
}

export async function importArchive(
  bytes: Uint8Array,
  database: Fish2TankDB = db,
): Promise<ImportResult> {
  const parsed = parseArchive(bytes);

  const problems = verifyManifest(parsed.manifest, actualsOf(parsed));
  if (problems.length > 0) {
    // Loud and total. Nothing has been written at this point and nothing will be.
    console.error(`[import] rejected archive: ${problems.join('; ')}`);
    throw new ArchiveRejected(problems);
  }

  const written: Record<string, number> = {};

  for (const [table, rows] of Object.entries(parsed.records)) {
    if (!Array.isArray(rows) || rows.length === 0) {
      written[table] = 0;
      continue;
    }
    // bulkPut is what makes this idempotent: same primary key, same row, one
    // copy. It is also what makes it additive, since it never removes.
    await database.table(table).bulkPut(rows);
    written[table] = rows.length;
    console.info(`[import] ${table} -> ${rows.length} rows`);
  }

  let mediaBytes = 0;
  const storedAt = new Date().toISOString();
  const mimeByKey = new Map<string, string>();
  for (const row of (parsed.records.media ?? []) as Array<Record<string, unknown>>) {
    const mime = typeof row.mimeType === 'string' ? row.mimeType : 'application/octet-stream';
    for (const field of ['originalBlobKey', 'previewBlobKey', 'thumbnailBlobKey']) {
      const key = row[field];
      if (typeof key === 'string') mimeByKey.set(key, mime);
    }
  }

  for (const [key, data] of parsed.media) {
    // A copy, because the ArrayBuffer under a Uint8Array view from unzipSync
    // can be a slice of the whole archive; storing it as-is would pin the
    // entire zip in IndexedDB for every single photo.
    const copy = data.slice().buffer;
    await database.blobs.put({
      key,
      data: copy,
      bytes: data.byteLength,
      mimeType: mimeByKey.get(key) ?? 'application/octet-stream',
      storedAt,
    });
    mediaBytes += data.byteLength;
  }

  console.info(
    `[import] done: ${parsed.media.size} media (${mediaBytes}B), ` +
      Object.entries(written).map(([t, n]) => `${t}=${n}`).join(' '),
  );

  return {
    manifest: parsed.manifest,
    tables: written,
    mediaRestored: parsed.media.size,
    mediaBytes,
  };
}

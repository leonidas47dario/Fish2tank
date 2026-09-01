/**
 * Writing the collection out to a portable archive.
 *
 * Spec 006 FR-A08. This is the backup the app has never had: everything
 * personal currently lives in one browser's IndexedDB, which Safari can evict
 * after about a week on a non-installed site (ENH-04).
 *
 * MEDIA IS STORED, NOT DEFLATED. JPEG and MP4 are already compressed, so
 * deflating them costs CPU and saves approximately nothing. Records are
 * deflated, where it genuinely helps.
 *
 * The whole archive is assembled as Blob parts rather than one ArrayBuffer.
 * A browser can back a Blob with disk, so a large library does not have to fit
 * in memory all at once. That is the mitigation for the ceiling a single-file
 * zip has and a streamed directory export does not.
 */
import { Zip, ZipPassThrough, AsyncZipDeflate } from 'fflate';
import { blobFor, db, type Fish2TankDB } from '../db';
import type { Media, Species } from '@/domain/types';
import {
  ARCHIVE_VERSION,
  EXPORTED_TABLES,
  MANIFEST_PATH,
  MEDIA_PREFIX,
  RECORDS_PATH,
  type ArchiveManifest,
  type RecordBundle,
} from './manifest';

export interface ExportResult {
  blob: Blob;
  manifest: ArchiveManifest;
  filename: string;
}

/**
 * The rows to write, per table.
 *
 * `species` and `speciesProfiles` are filtered rather than taken whole: only
 * the rows a keeper typed in themselves travel. Catalog rows are derived data
 * the importing device already has, and shipping all of them would add
 * megabytes to every backup for no gain.
 */
export async function collectRecords(database: Fish2TankDB = db): Promise<RecordBundle> {
  const bundle: RecordBundle = {};

  const species = (await database.species.toArray()) as Species[];
  const mine = species.filter((s) => s.origin === 'user-submitted');
  const mineIds = new Set(mine.map((s) => s.id));

  for (const table of EXPORTED_TABLES) {
    if (table === 'species') {
      bundle[table] = mine;
    } else if (table === 'speciesProfiles') {
      const profiles = await database.speciesProfiles.toArray();
      bundle[table] = profiles.filter((p) => mineIds.has(p.speciesId));
    } else {
      bundle[table] = await database.table(table).toArray();
    }
  }

  return bundle;
}

/** Every blob key an exported media row points at, deduplicated. */
export function referencedBlobKeys(media: Media[]): string[] {
  const keys = new Set<string>();
  for (const m of media) {
    for (const key of [m.originalBlobKey, m.previewBlobKey, m.thumbnailBlobKey]) {
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * A name that says WHOSE collection this is and WHEN it was taken.
 *
 * The old name carried the date alone, which is fine for the occasional
 * manual backup and wrong for the one spec 016 forces before an erase: two
 * erases in a day produced `fish2tank-export-2026-08-30.zip` twice, and the
 * browser quietly appended "(1)". The file you need to restore from is then
 * the one you cannot identify, which is the worst moment to be guessing.
 *
 * UTC, deliberately, and to the minute. It matches `manifest.exportedAt` in
 * the archive itself, so the name and the contents agree; a local-time name
 * beside a UTC manifest reads like two different backups.
 *
 * The account is the local part of the email, never the whole address. It is
 * enough to tell two accounts apart, and a backup is a file people hand
 * around when something has gone wrong - a full address in the name travels
 * further than the person who typed it expected.
 */
export function accountSlug(account: string | undefined): string | undefined {
  if (!account) return undefined;
  const local = account.split('@')[0] ?? '';
  const slug = local.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? slug.slice(0, 32) : undefined;
}

export function archiveFilename(now = new Date(), account?: string): string {
  // 2026-08-30T14:07:11.000Z -> 2026-08-30-1407
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const who = accountSlug(account);
  return who
    ? `fish2tank-backup-${who}-${stamp}.zip`
    : `fish2tank-backup-${stamp}.zip`;
}

/**
 * Builds the archive.
 *
 * `onProgress` exists because a multi-gigabyte export is not instant and a UI
 * that says nothing during it looks broken.
 */
export async function exportArchive(
  database: Fish2TankDB = db,
  options: {
    appBuild?: string;
    onProgress?: (done: number, total: number) => void;
    /** Who this belongs to, for the filename. Omitted when signed out. */
    account?: string;
  } = {},
): Promise<ExportResult> {
  const records = await collectRecords(database);
  const mediaRows = (records.media ?? []) as Media[];
  const blobKeys = referencedBlobKeys(mediaRows);

  const manifest: ArchiveManifest = {
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    appBuild: options.appBuild ?? 'unknown',
    tables: Object.fromEntries(Object.entries(records).map(([t, rows]) => [t, rows.length])),
    media: { count: 0, bytes: 0 },
  };

  const parts: Uint8Array[] = [];
  let failure: Error | undefined;

  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else if (chunk.length) parts.push(chunk);
  });

  const push = (file: ZipPassThrough | AsyncZipDeflate, bytes: Uint8Array) => {
    zip.add(file);
    file.push(bytes, true);
  };

  const encoder = new TextEncoder();

  // Media first, so the manifest can record the real totals before it is
  // written. A manifest that guesses is a manifest that cannot verify.
  let count = 0;
  let bytes = 0;
  for (const [index, key] of blobKeys.entries()) {
    const blob = blobFor(await database.blobs.get(key));
    if (!blob) {
      // Not fatal. A missing preview is normal, and a media row whose original
      // has gone is a louder problem than an export can fix. It is left out of
      // the manifest totals so import still verifies cleanly.
      console.warn(`[export] no local bytes for ${key}, omitted from the archive`);
      continue;
    }
    const data = new Uint8Array(await blob.arrayBuffer());
    push(new ZipPassThrough(`${MEDIA_PREFIX}${key}`), data);
    count += 1;
    bytes += data.byteLength;
    options.onProgress?.(index + 1, blobKeys.length);
  }
  manifest.media = { count, bytes };

  push(new AsyncZipDeflate(RECORDS_PATH, { level: 6 }), encoder.encode(JSON.stringify(records)));
  push(new AsyncZipDeflate(MANIFEST_PATH, { level: 6 }), encoder.encode(JSON.stringify(manifest, null, 2)));

  await new Promise<void>((resolve, reject) => {
    zip.ondata = (err, chunk, final) => {
      if (err) return reject(err);
      if (chunk.length) parts.push(chunk);
      if (final) resolve();
    };
    zip.end();
  });

  if (failure) throw failure;

  const blob = new Blob(parts as BlobPart[], { type: 'application/zip' });
  console.info(
    `[export] wrote ${blob.size}B: ${manifest.media.count} media (${manifest.media.bytes}B), ` +
      Object.entries(manifest.tables).map(([t, n]) => `${t}=${n}`).join(' '),
  );

  return { blob, manifest, filename: archiveFilename(new Date(), options.account) };
}

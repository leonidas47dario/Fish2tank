/**
 * The CLI reads both export shapes.
 *
 * Spec 006 replaced the Settings screen's flat JSON with a zip archive, which
 * silently broke this tool: its only input was the flat file, and the app
 * stopped producing one. These pin both paths so the next change to the export
 * format fails here rather than in a maintainer's terminal.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { readExport } from '../review-user-species';

const dir = mkdtempSync(join(tmpdir(), 'f2t-'));

const BUNDLE = {
  species: [
    { id: 'sp_user_a', commonName: 'Rio Xingu Zebra Plec L046', aliases: [],
      createdAt: '2026-08-01T00:00:00.000Z', origin: 'user-submitted',
      submission: { label: 'Rio Xingu Zebra Plec L046', submittedAt: '2026-08-01T00:00:00.000Z' } },
  ],
  specimens: [{ id: 'spec_1', speciesId: 'sp_user_a' }],
};

function writeZip(name: string, files: Record<string, string>): string {
  const path = join(dir, name);
  const entries = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, strToU8(v)]),
  );
  writeFileSync(path, Buffer.from(zipSync(entries)));
  return path;
}

describe('reading a keeper export', () => {
  it('reads the spec 006 zip archive', () => {
    const path = writeZip('backup.zip', {
      'manifest.json': JSON.stringify({ version: 1 }),
      'records.json': JSON.stringify(BUNDLE),
    });
    expect(readExport(path).species?.[0]?.commonName).toBe('Rio Xingu Zebra Plec L046');
  });

  it('still reads the older flat JSON export', () => {
    const path = join(dir, 'old-export.json');
    writeFileSync(path, JSON.stringify(BUNDLE));
    expect(readExport(path).species?.[0]?.commonName).toBe('Rio Xingu Zebra Plec L046');
  });

  /**
   * The format is decided by the file's own first bytes, because a downloaded
   * archive gets renamed and the extension stops being evidence.
   */
  it('reads a zip whose name says .json', () => {
    const path = writeZip('renamed.json', { 'records.json': JSON.stringify(BUNDLE) });
    expect(readExport(path).species?.[0]?.id).toBe('sp_user_a');
  });

  it('says so when a zip is not a Fish2Tank backup', () => {
    const path = writeZip('wrong.zip', { 'something-else.txt': 'hello' });
    expect(() => readExport(path)).toThrow(/no records\.json/i);
  });

  it('refuses a file that is neither', () => {
    const path = join(dir, 'junk.txt');
    writeFileSync(path, 'not an export');
    expect(() => readExport(path)).toThrow();
  });
});

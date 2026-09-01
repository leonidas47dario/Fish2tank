import { describe, expect, it } from 'vitest';
import { accountSlug, archiveFilename } from './export';

const AT = new Date('2026-08-30T14:07:11.000Z');

describe('archive filename (spec 016)', () => {
  it('names the account and the minute', () => {
    expect(archiveFilename(AT, 'leonidas47dario@gmail.com'))
      .toBe('fish2tank-backup-leonidas47dario-2026-08-30-1407.zip');
  });

  it('separates two backups taken on the same day', () => {
    // The whole point. The forced backup before an erase used to collide with
    // an earlier one and the browser silently appended "(1)", leaving the file
    // you need to restore from as the one you cannot identify.
    const morning = archiveFilename(new Date('2026-08-30T09:15:00.000Z'), 'ryan@example.com');
    const evening = archiveFilename(new Date('2026-08-30T21:40:00.000Z'), 'ryan@example.com');
    expect(morning).not.toBe(evening);
  });

  it('carries the timestamp alone when signed out', () => {
    expect(archiveFilename(AT)).toBe('fish2tank-backup-2026-08-30-1407.zip');
  });

  it('keeps the local part, never the whole address', () => {
    // A backup is a file people hand around when something has gone wrong.
    expect(archiveFilename(AT, 'someone@example.com')).not.toContain('example.com');
    expect(archiveFilename(AT, 'someone@example.com')).not.toContain('@');
  });

  it('produces a filename-safe slug from an awkward name', () => {
    expect(accountSlug('Ryan O’Neill (home)')).toBe('ryan-o-neill-home');
    expect(accountSlug('  ')).toBeUndefined();
    expect(accountSlug(undefined)).toBeUndefined();
    // A display name with nothing usable in it must not yield a bare "--.zip".
    expect(archiveFilename(AT, '???')).toBe('fish2tank-backup-2026-08-30-1407.zip');
  });

  it('caps a very long account so the name stays a name', () => {
    expect(accountSlug('a'.repeat(200))!.length).toBe(32);
  });
});

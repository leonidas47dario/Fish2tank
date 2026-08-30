import { describe, expect, it } from 'vitest';
import { PRODUCTION_DB_NAME, databaseNameFor } from './db-name';

/**
 * BUG-04. The whole point of this module is that two deployments on one origin
 * must not share one IndexedDB database, and that fixing it must not rename
 * the database the real collection already lives in.
 */
describe('databaseNameFor', () => {
  it('keeps the production name unchanged, so the real collection is still there', () => {
    // If this ever fails, a deploy would show Ryan an empty app.
    expect(databaseNameFor('/Fish2tank/')).toBe('fish2tank');
    expect(PRODUCTION_DB_NAME).toBe('fish2tank');
  });

  it('gives staging its own database', () => {
    expect(databaseNameFor('/Fish2tank/uat/')).toBe('fish2tank-uat');
  });

  it('separates the two, which is the entire bug', () => {
    expect(databaseNameFor('/Fish2tank/uat/')).not.toBe(databaseNameFor('/Fish2tank/'));
  });

  it('treats a root-served build as production', () => {
    // Dev and any host serving from the root. A different origin either way,
    // so it cannot collide with the deployed pair.
    expect(databaseNameFor('/')).toBe('fish2tank');
  });

  it('does not mistake a path merely containing uat for staging', () => {
    // Only the /uat/ suffix marks staging; a repo or folder called something
    // like "uat-notes" is production.
    expect(databaseNameFor('/Fish2tank/uat-notes/')).toBe('fish2tank');
    expect(databaseNameFor('/uat/deeper/')).toBe('fish2tank');
  });
});

import { describe, expect, it } from 'vitest';
import {
  CLOUD_DATABASES,
  MEDIA_WORKERS,
  PRODUCTION_DB_NAME,
  UNSYNCED_TABLES,
  cloudDatabaseUrlFor,
  databaseNameFor,
  deploymentFor,
  mediaWorkerUrlFor,
} from './environment';

const PROD = '/Fish2tank/';
const UAT = '/Fish2tank/uat/';

describe('deploymentFor', () => {
  it('recognises the two real deployments', () => {
    expect(deploymentFor(PROD)).toBe('production');
    expect(deploymentFor(UAT)).toBe('staging');
  });

  it('treats anything it does not recognise as other', () => {
    expect(deploymentFor('/')).toBe('other');
    expect(deploymentFor('/some-preview/')).toBe('other');
  });
});

/** BUG-04: two deployments on one origin must not share one database. */
describe('databaseNameFor', () => {
  it('keeps the production name unchanged, so the real collection is still there', () => {
    // If this ever fails, a deploy would show Ryan an empty app.
    expect(databaseNameFor(PROD)).toBe('fish2tank');
    expect(PRODUCTION_DB_NAME).toBe('fish2tank');
  });

  it('gives staging its own database', () => {
    expect(databaseNameFor(UAT)).toBe('fish2tank-uat');
  });

  it('separates the two, which is the entire bug', () => {
    expect(databaseNameFor(UAT)).not.toBe(databaseNameFor(PROD));
  });

  it('gives an unrecognised build the production name, because origins cannot collide', () => {
    expect(databaseNameFor('/')).toBe('fish2tank');
  });

  it('does not mistake a path merely containing uat for staging', () => {
    expect(databaseNameFor('/Fish2tank/uat-notes/')).toBe('fish2tank');
  });
});

describe('cloudDatabaseUrlFor', () => {
  it('sends each deployment to its own cloud database', () => {
    expect(cloudDatabaseUrlFor(PROD)).toBe(CLOUD_DATABASES.production);
    expect(cloudDatabaseUrlFor(UAT)).toBe(CLOUD_DATABASES.staging);
  });

  it('never sends an unrecognised build to production', () => {
    // A dev server or preview deploy writing into Ryan's real realm is a way
    // to lose data, so unrecognised means throwaway.
    for (const base of ['/', '/preview/', '/Fish2tank/uat-notes/']) {
      expect(cloudDatabaseUrlFor(base)).toBe(CLOUD_DATABASES.other);
      expect(cloudDatabaseUrlFor(base)).not.toBe(CLOUD_DATABASES.production);
    }
  });

  it('gives every deployment a distinct database', () => {
    const urls = Object.values(CLOUD_DATABASES);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('UNSYNCED_TABLES', () => {
  it('holds exactly the FR-A01 exclusions', () => {
    // Adding one is a data-boundary decision, not a tweak - spec 005 FR-A01
    // enumerates these and acceptance criterion 10 checks them.
    expect([...UNSYNCED_TABLES].sort()).toEqual([
      'blobs',
      'deletedRecords',
      'draftKeys',
      'species',
      'speciesProfiles',
    ]);
  });
});

describe('mediaWorkerUrlFor', () => {
  it('gives each real deployment its own Worker', () => {
    expect(mediaWorkerUrlFor(PROD)).toBe(MEDIA_WORKERS.production);
    expect(mediaWorkerUrlFor(UAT)).toBe(MEDIA_WORKERS.staging);
    expect(MEDIA_WORKERS.production).not.toBe(MEDIA_WORKERS.staging);
  });

  it('leaves an unrecognised build with no Worker rather than the wrong one', () => {
    // A dev build syncs records to scratch, and the uat Worker only accepts
    // tokens whose audience is the uat database. Pointing dev at it would fail
    // with a confusing 401; empty means the UI can say "not configured".
    expect(mediaWorkerUrlFor('/')).toBe('');
    expect(mediaWorkerUrlFor('/preview/')).toBe('');
  });

  it('never points a Worker at the wrong tier', () => {
    // The uat Worker validates against the uat database, prod against prod.
    expect(MEDIA_WORKERS.staging).toContain('uat');
    expect(MEDIA_WORKERS.production).toContain('prod');
  });
});

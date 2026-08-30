/**
 * Publishing and revoking a shared tank - spec 015, FR-S01 and FR-S05.
 *
 * The Worker owns access control; this owns *correctness of the report*. Every
 * mutation here logs its intent and its outcome as a pair, carrying the
 * session identity, and verifies the side effect before calling itself done
 * (NFR-13). A publish that says "shared" while the object is not readable is
 * the DW_SYNC failure with different nouns: a green status over nothing.
 *
 * Kept free of React so the automatic republisher and the share sheet can both
 * call it, and so its logging is not tangled up with a render.
 */
import { db as defaultDb, type Fish2TankDB } from '../db';
import { loadTankResidents } from '../tank-residents';
import { BUILD_ID, CLOUD_DATABASE_URL, DEPLOYMENT, MEDIA_WORKER_URL } from '@/build-info';
import { buildSnapshot, fingerprintOf, type PublicSnapshot, type SharedSnapshot } from './snapshot';
import { forgetShare, recordShare, shareFor } from './shares';
import type { Id } from '@/domain/types';

/** Why a publish could not even be attempted. `undefined` means it can. */
export type ShareBlocker = 'not-configured' | 'signed-out' | 'offline';

export interface PublishResult {
  token: string;
  url: string;
  /**
   * Things a keeper should know that did not stop the publish. Empty is the
   * normal case. A warning is never a silent condition: the sheet shows these.
   */
  warnings: string[];
}

export interface ShareDeps {
  db?: Fish2TankDB;
  workerUrl?: string;
  /** Read fresh per call: a token expires and a session outlives one. */
  getAccessToken?: () => string | undefined;
  /** The signed-in subject, used only for logs - the Worker decides the real one. */
  account?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Whether sharing can work right now, and if not, why.
 *
 * Separate from doing it so the UI can explain itself rather than showing a
 * button that quietly does nothing. "Not configured" is a real and expected
 * answer on a dev build, not a fault - the media Worker is deliberately unset
 * outside the deployed tiers (see environment.ts).
 */
export function shareBlocker(deps: ShareDeps = {}): ShareBlocker | undefined {
  const database = deps.db ?? defaultDb;
  if (!(deps.workerUrl ?? MEDIA_WORKER_URL)) return 'not-configured';
  const token = deps.getAccessToken ? deps.getAccessToken() : database.cloud?.currentUser?.value?.accessToken;
  if (!token) return 'signed-out';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return undefined;
}

/** The link a keeper hands out. A fragment, so the token never reaches a server log. */
export function shareUrlFor(token: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const origin = typeof location === 'undefined' ? '' : location.origin;
  return `${origin}${base}#/share/${token}`;
}

/**
 * Publish a tank, or republish one already shared.
 *
 * Republishing REUSES THE EXISTING TOKEN, which is what makes the link a
 * keeper has already sent out keep working. A new token per publish would
 * silently break every copy of the URL already in somebody's messages.
 */
export async function publishTank(
  aquariumId: Id,
  deps: ShareDeps = {},
): Promise<PublishResult> {
  const database = deps.db ?? defaultDb;
  const workerUrl = (deps.workerUrl ?? MEDIA_WORKER_URL).replace(/\/+$/, '');
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const accessToken = deps.getAccessToken
    ? deps.getAccessToken()
    : database.cloud?.currentUser?.value?.accessToken;
  const account = deps.account ?? database.cloud?.currentUser?.value?.userId ?? 'unknown';

  // NFR-13: the identity block every line carries. A publish that does not say
  // which account, tier and Worker it touched cannot be diagnosed later.
  const identity = {
    account, aquariumId, deployment: DEPLOYMENT, cloudDatabase: CLOUD_DATABASE_URL,
    worker: workerUrl, build: BUILD_ID,
  };

  if (!workerUrl) throw new Error('Sharing is not configured for this build.');
  if (!accessToken) throw new Error('Sign in before sharing a tank.');

  const loaded = await loadTankResidents(aquariumId, database);
  if (!loaded) throw new Error('No such tank.');

  const existing = await shareFor(aquariumId, database);
  const token = existing?.token ?? crypto.randomUUID();
  const warnings: string[] = [];

  /*
   * The tank photo, and whether it is actually in the bucket.
   *
   * Publishing a key that R2 does not hold produces a broken image on a
   * stranger's screen, and the keeper has no way to find out. So the key is
   * only published once the object is confirmed present, and when it is not,
   * the share goes out without the photo and SAYS SO. A guest then sees the
   * fallback, which is honest, rather than a torn image, which is a bug
   * report nobody files.
   */
  let tankPhotoBlobKey: string | undefined;
  if (loaded.aquarium.photoMediaId) {
    const media = await database.media.get(loaded.aquarium.photoMediaId);
    if (!media) {
      warnings.push('The tank photo record is missing, so guests will see the placeholder.');
      console.warn('[share] tank photo -> record absent', {
        ...identity, photoMediaId: loaded.aquarium.photoMediaId,
      });
    } else {
      const present = await headBlob(media.originalBlobKey, {
        workerUrl, accessToken, doFetch,
      });
      if (present) {
        tankPhotoBlobKey = media.originalBlobKey;
      } else {
        warnings.push(
          'The tank photo has not finished syncing, so guests will see the placeholder. '
          + 'Sync your photos, then update the shared page.',
        );
        console.warn('[share] tank photo -> not in the bucket yet', {
          ...identity, blobKey: media.originalBlobKey,
        });
      }
    }
  }

  const snapshot = buildSnapshot({
    aquarium: loaded.aquarium,
    residents: loaded.residents,
    tankPhotoBlobKey,
    token,
    publishedAt: new Date().toISOString(),
    buildId: BUILD_ID,
    // Stamped by the Worker from the validated token; sent only so the shape
    // is complete. Whatever is put here is discarded server-side.
    owner: account,
  });

  console.info('[share] publish start', {
    ...identity, token, residents: snapshot.residents.length,
    fish: snapshot.stats.fish, photo: Boolean(tankPhotoBlobKey),
  });

  const res = await doFetch(`${workerUrl}/shared`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  if (!res.ok) {
    const detail = await errorDetail(res);
    console.error('[share] publish -> rejected', { ...identity, token, status: res.status, detail });
    throw new Error(`Could not share this tank: ${res.status} ${detail}`.trim());
  }

  /*
   * Read it back as a stranger would, with no token at all.
   *
   * Not paranoia. The Worker already verified the object exists; this verifies
   * the thing a guest will actually receive, through the public route, which
   * is a different code path and the one that matters. If it 404s or comes
   * back as some other tank, the publish did not do what it claimed.
   */
  const readback = await doFetch(`${workerUrl}/shared/${token}`);
  if (!readback.ok) {
    console.error('[share] publish -> wrote, but the public page does not answer', {
      ...identity, token, status: readback.status,
    });
    throw new Error('The tank was written but its page could not be read back.');
  }
  const served = (await readback.json()) as PublicSnapshot;
  if (served.tank?.name !== snapshot.tank.name) {
    console.error('[share] publish -> the page served is not this tank', {
      ...identity, token, expected: snapshot.tank.name, got: served.tank?.name,
    });
    throw new Error('The published page does not match this tank.');
  }

  await recordShare(aquariumId, {
    token,
    publishedAt: snapshot.publishedAt,
    fingerprint: fingerprintOf(snapshot, loaded.aquarium.photoMediaId),
    photoIncluded: Boolean(tankPhotoBlobKey),
  }, database);

  const url = shareUrlFor(token);
  console.info('[share] publish -> ok', { ...identity, token, url, warnings: warnings.length });
  return { token, url, warnings };
}

/**
 * Take a shared tank down.
 *
 * The local record is forgotten only AFTER the Worker confirms the object is
 * gone. Forgetting first would leave a live public page with nothing in the
 * app admitting it exists, and therefore no way to reach the button that
 * turns it off.
 */
export async function revokeTank(aquariumId: Id, deps: ShareDeps = {}): Promise<void> {
  const database = deps.db ?? defaultDb;
  const workerUrl = (deps.workerUrl ?? MEDIA_WORKER_URL).replace(/\/+$/, '');
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const accessToken = deps.getAccessToken
    ? deps.getAccessToken()
    : database.cloud?.currentUser?.value?.accessToken;
  const account = deps.account ?? database.cloud?.currentUser?.value?.userId ?? 'unknown';

  const share = await shareFor(aquariumId, database);
  const identity = { account, aquariumId, deployment: DEPLOYMENT, worker: workerUrl };

  if (!share) {
    console.info('[share] revoke -> nothing shared', identity);
    return;
  }
  if (!workerUrl) throw new Error('Sharing is not configured for this build.');
  if (!accessToken) throw new Error('Sign in to stop sharing this tank.');

  console.info('[share] revoke start', { ...identity, token: share.token });
  const res = await doFetch(`${workerUrl}/shared/${share.token}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await errorDetail(res);
    console.error('[share] revoke -> rejected', {
      ...identity, token: share.token, status: res.status, detail,
    });
    throw new Error(`Could not stop sharing: ${res.status} ${detail}`.trim());
  }

  // Confirm as a stranger would. The Worker verifies its own delete, but the
  // question a keeper is really asking is "is the link dead", and this is that
  // question asked the way they would ask it.
  const readback = await doFetch(`${workerUrl}/shared/${share.token}`);
  if (readback.ok) {
    console.error('[share] revoke -> the page still answers', { ...identity, token: share.token });
    throw new Error('The link is still live. Nothing has been changed locally.');
  }

  await forgetShare(aquariumId, database);
  console.info('[share] revoke -> ok', { ...identity, token: share.token });
}

/**
 * What the tank looks like right now, in the two terms `needsRepublish` reads.
 *
 * One function so the share sheet's "is this page current?" line and the
 * automatic republisher's "should I write?" decision cannot answer the same
 * question differently. They did briefly, and the difference was invisible:
 * the sheet built its fingerprint without the photo while publish built one
 * with it, so any shared tank with a photo read as permanently stale.
 */
export async function currentShareState(
  aquariumId: Id,
  database: Fish2TankDB = defaultDb,
): Promise<{ fingerprint: string; hasPhoto: boolean } | undefined> {
  const loaded = await loadTankResidents(aquariumId, database);
  if (!loaded) return undefined;

  const snapshot = buildSnapshot({
    aquarium: loaded.aquarium,
    residents: loaded.residents,
    // Excluded from the fingerprint by design - see fingerprintOf. These four
    // are placeholders for a snapshot that is never published.
    tankPhotoBlobKey: undefined,
    token: '',
    publishedAt: '',
    buildId: '',
    owner: '',
  });

  return {
    fingerprint: fingerprintOf(snapshot, loaded.aquarium.photoMediaId),
    hasPhoto: Boolean(loaded.aquarium.photoMediaId),
  };
}

/** Whether R2 already holds this blob. Absent is a normal answer, not an error. */
async function headBlob(
  blobKey: string,
  ctx: { workerUrl: string; accessToken: string; doFetch: typeof fetch },
): Promise<boolean> {
  try {
    const res = await ctx.doFetch(`${ctx.workerUrl}/head`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobKey }),
    });
    if (!res.ok) {
      // Never swallowed. A HEAD that fails is not proof of absence, but it is
      // the same decision - publish without the photo - so say why.
      console.warn('[share] photo head -> could not ask', { blobKey, status: res.status });
      return false;
    }
    return ((await res.json()) as { present?: boolean }).present === true;
  } catch (cause) {
    console.warn('[share] photo head -> failed', { blobKey, cause: String(cause) });
    return false;
  }
}

/** The Worker's own message, which is the difference between "403" and a diagnosis. */
async function errorDetail(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? '';
  } catch {
    return res.statusText;
  }
}

export type { SharedSnapshot };

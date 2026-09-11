/**
 * Publishing and revoking a shared tank - spec 023, FR-S01 and FR-S05.
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
import { publishableKeyFor } from './publishable';
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

/**
 * The link a keeper hands out - the Worker's preview route since spec 054.
 *
 * IT USED TO BE THE PAGES URL WITH THE TOKEN IN A FRAGMENT, on the reasoning
 * that a fragment never reaches a server log. The cost was that a fragment
 * never reaches ANY server, so an unfurler asking about a shared tank fetched
 * the app shell and learned nothing - which is why a shared tank rendered in
 * iMessage as a blank card with a compass glyph and no tank name.
 *
 * THE TRADE, STATED HONESTLY, because it is the argument this change turns on.
 * A machine that unfurls the link now reads the tank's name, counts and photo
 * automatically, where before it could have and did not. What it is NOT is the
 * token becoming logged for the first time: the Worker already logs it on every
 * `/shared/:token` read, so the fragment was protecting the token from GitHub's
 * access logs, not from ours.
 *
 * `#/share/:token` KEEPS WORKING FOREVER. This is additive - the app still
 * resolves that route, and every link already sent resolves exactly as it did.
 * `publishTank` reuses a token on republish for the same reason.
 *
 * Falls back to the Pages URL when no Worker is configured, which is the
 * `other` tier and every test that does not stand one up.
 */
export function shareUrlFor(token: string, workerUrl: string = MEDIA_WORKER_URL): string {
  if (workerUrl) return `${workerUrl.replace(/\/+$/, '')}/p/${token}`;
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
      /*
       * Spec 064: never the original. The preview where one exists - which is
       * canvas-derived and so carries no EXIF - and a stripped copy derived on
       * the spot for any photo small enough never to have earned a preview.
       * That fallback used to upload the keeper's file byte for byte, GPS tag
       * and all (NFR-04).
       */
      const key = await publishableKeyFor(media, database);
      const present = key
        ? await headBlob(key, { workerUrl, accessToken, doFetch })
        : false;
      if (present && key) {
        tankPhotoBlobKey = key;
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

  /*
   * The same rule as the tank photo, per fish (spec 026). A key is published
   * only when the object is confirmed in the bucket, because a key the Worker
   * cannot serve is a torn image on a stranger's screen - the bug report
   * nobody files.
   *
   * `loadTankResidents` already decided WHICH photo each fish wears, using the
   * one precedence rule the owner's screen uses (spec 021), so a guest sees
   * the same face rather than a second opinion about it.
   *
   * Checked in parallel: this is one HEAD per photographed fish, and doing
   * them in series would make publishing a well-photographed tank feel broken.
   */
  const residentPhotoKeys = new Map<string, string>();
  let unsyncedPhotos = 0;
  await Promise.all(loaded.ownArt.map(async ({ holdingId, mediaId }) => {
    const media = await database.media.get(mediaId);
    if (!media) return;
    // Spec 064, as above: a stripped derivative, never the original.
    const key = await publishableKeyFor(media, database);
    const present = key
      ? await headBlob(key, { workerUrl, accessToken, doFetch })
      : false;
    if (present && key) {
      residentPhotoKeys.set(holdingId, key);
    } else {
      unsyncedPhotos += 1;
    }
  }));
  if (unsyncedPhotos > 0) {
    warnings.push(
      `${unsyncedPhotos} fish ${unsyncedPhotos === 1 ? 'photo has' : 'photos have'} not finished `
      + 'syncing, so guests will see the reference portrait for those. '
      + 'Sync your photos, then update the shared page.',
    );
    console.warn('[share] resident photos -> not in the bucket yet', {
      ...identity, unsyncedPhotos,
    });
  }

  const snapshot = buildSnapshot({
    aquarium: loaded.aquarium,
    residents: loaded.residents,
    tankPhotoBlobKey,
    residentPhotoKeys,
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

  /*
   * Verified BEFORE the record is written, so the link ON the record is the
   * link that answered. See ShareRecord.url for why it is stored rather than
   * re-derived - three call sites in ShareSheet were re-deriving it and went on
   * handing out a route that answered 404.
   */
  const url = await bestShareUrl(token, workerUrl, doFetch, identity);

  await recordShare(aquariumId, {
    token,
    url,
    publishedAt: snapshot.publishedAt,
    fingerprint: fingerprintOf(snapshot, loaded.aquarium.photoMediaId, loaded.ownArt.map((a) => a.mediaId)),
    photoIncluded: Boolean(tankPhotoBlobKey),
    photoCount: residentPhotoKeys.size,
  }, database);

  /*
   * NEVER HAND OUT A LINK THAT DOES NOT ANSWER.
   *
   * `shareUrlFor` returns the Worker's preview route (spec 054), and the site
   * and the Worker deploy SEPARATELY - `deploy-worker.yml` is
   * `workflow_dispatch` only. So there is a real window where the app has been
   * updated and the Worker has not, and in that window every link a keeper
   * handed out was a JSON 404. That is not hypothetical: it happened in uat on
   * 2026-09-10, when the Worker deploy failed on an expired Cloudflare token
   * and the site shipped anyway.
   *
   * The same discipline the readback above already uses, applied one step
   * further out: check the thing the keeper is about to send, and fall back to
   * the Pages URL if it is not there. `#/share/:token` has always worked and
   * always will, so the fallback is a real link rather than a degraded one.
   *
   * It self-heals: the next publish after the Worker deploys returns the
   * preview URL with no code change and no second decision.
   */
  console.info('[share] publish -> ok', { ...identity, token, url, warnings: warnings.length });
  return { token, url, warnings };
}

/**
 * The link to hand out for a share already on record.
 *
 * SYNCHRONOUS ON PURPOSE, because the UI renders it - `ShareSheet` puts it in a
 * field, on the clipboard and into the native share sheet, three times per
 * render. It cannot go and check anything, which is exactly why the checking
 * happens once at publish and the answer is stored.
 *
 * A record written before spec 054 has no `url`, and falls back to the app
 * link - which has always worked and always will.
 */
export function linkFor(share: { token: string; url?: string }): string {
  return share.url ?? shareUrlFor(share.token, '');
}

/**
 * The preview URL when the Worker actually serves it, the Pages URL otherwise.
 *
 * A HEAD would be cheaper, but the route is only interesting if it returns
 * HTML - an old Worker answers `/p/:token` with a JSON 404, and a 404 is
 * exactly what has to be caught here.
 */
async function bestShareUrl(
  token: string,
  workerUrl: string,
  doFetch: typeof fetch,
  identity: Record<string, unknown>,
): Promise<string> {
  const preview = shareUrlFor(token, workerUrl);
  const fallback = shareUrlFor(token, '');
  if (preview === fallback) return fallback;

  try {
    const res = await doFetch(preview);
    if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) return preview;
    console.warn('[share] preview route not live, handing out the app link instead', {
      ...identity, token, status: res.status,
    });
  } catch (cause) {
    console.warn('[share] preview route unreachable, handing out the app link instead', {
      ...identity, token, cause: String(cause),
    });
  }
  return fallback;
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
): Promise<{ fingerprint: string; hasPhoto: boolean; photoCount: number } | undefined> {
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
    fingerprint: fingerprintOf(snapshot, loaded.aquarium.photoMediaId, loaded.ownArt.map((a) => a.mediaId)),
    hasPhoto: Boolean(loaded.aquarium.photoMediaId),
    // The tank's count of photographed fish, not how many are in the bucket -
    // a content fact, exactly like `hasPhoto` beside it.
    photoCount: loaded.ownArt.length,
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

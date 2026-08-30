/**
 * The media Worker - spec 005 FR-A02, FR-A03, NFR-10.
 *
 * One job: hand out short-lived, authenticated URLs for R2 objects belonging
 * to the caller, and nobody else's. It does NOT broker identity. Dexie Cloud
 * does that itself now (spec 005 FR-A02, rewritten 2026-08-30), so this Worker
 * only has to answer "who is asking, and may they touch this key".
 *
 * Bytes never pass through here. The browser uploads and downloads straight to
 * R2 with a presigned URL, which keeps a 3.6 MB photo off the Worker's CPU
 * budget entirely.
 *
 * WHY PRESIGNED RATHER THAN AN R2 BINDING. A binding would remove the need for
 * S3 credentials, but every byte would then stream through the Worker. For
 * originals that is the wrong trade: the upload is the slow, retryable,
 * resumable part, and it belongs between the browser and the store.
 */
import { AwsClient } from 'aws4fetch';

export interface Env {
  /** Which Dexie Cloud database issues the tokens we accept, e.g. https://zblsiza99.dexie.cloud */
  DEXIE_DATABASE_URL: string;
  /** The R2 bucket for this environment. */
  R2_BUCKET: string;
  /** Cloudflare account id, for the S3 endpoint. */
  R2_ACCOUNT_ID: string;
  /** Comma-separated origins allowed to call this Worker. */
  ALLOWED_ORIGINS: string;
  /** Which tier this is, for logs. NFR-13. */
  ENVIRONMENT: string;
  /** Secrets, set with `wrangler secret put`. Never in wrangler.toml. */
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

/** How long a signed URL lives. Long enough for a slow upload, short enough to matter. */
const URL_TTL_SECONDS = 15 * 60;

interface DexieClaims {
  sub?: string;
  exp?: number;
  aud?: string[] | string;
  scopes?: string[];
}

/**
 * Validated tokens, cached until they expire.
 *
 * There is no JWKS endpoint for Dexie Cloud tokens, so validation is a network
 * round trip rather than an offline signature check. Doing that per request
 * would put a second of latency on every thumbnail. Cached per isolate, which
 * is the right lifetime: a Worker isolate is short-lived and per-colo, so this
 * never becomes a stale-permission store.
 */
const validated = new Map<string, { claims: DexieClaims; expiresAt: number }>();

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  // Echo the origin only if it is on the list. Never `*`: these responses carry
  // URLs that grant access to someone's photos.
  const allow = origin && allowed.includes(origin) ? origin : '';
  return {
    ...(allow ? { 'Access-Control-Allow-Origin': allow } : {}),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

/**
 * Who is calling, according to Dexie Cloud rather than according to them.
 *
 * Returns the validated claims or undefined. The caller must never fall back
 * to anything the request said about itself.
 */
async function authenticate(request: Request, env: Env): Promise<DexieClaims | undefined> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length);

  const now = Date.now();
  const cached = validated.get(token);
  if (cached && cached.expiresAt > now) return cached.claims;

  const res = await fetch(`${env.DEXIE_DATABASE_URL}/token/validate`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn('[worker] token validation rejected', { status: res.status });
    return undefined;
  }
  const body = (await res.json()) as { valid?: boolean; claims?: DexieClaims };
  if (!body.valid || !body.claims?.sub) {
    console.warn('[worker] token validation returned invalid');
    return undefined;
  }

  /*
   * BIND THE TOKEN TO OUR DATABASE.
   *
   * Without this, anyone could create their own free Dexie Cloud database,
   * obtain a perfectly valid token from it, and spend this account's R2 quota
   * under their own `sub`. `valid: true` only means "some Dexie Cloud issued
   * this", which is not the question being asked.
   */
  const audience = Array.isArray(body.claims.aud) ? body.claims.aud : [body.claims.aud];
  if (!audience.includes(env.DEXIE_DATABASE_URL)) {
    console.warn('[worker] token is for a different database', {
      expected: env.DEXIE_DATABASE_URL,
      got: audience,
    });
    return undefined;
  }

  // Cache no longer than the token itself claims to live.
  const expiresAt = body.claims.exp ? body.claims.exp * 1000 : now + 60_000;
  validated.set(token, { claims: body.claims, expiresAt: Math.min(expiresAt, now + 3_600_000) });
  return body.claims;
}

/**
 * Where a blob lives. Derived from the VALIDATED subject, never from the body.
 *
 * This one line is the whole access-control model: a caller cannot name a key
 * outside their own prefix because they do not get to supply the prefix.
 */
function objectKeyFor(sub: string, blobKey: string): string {
  return `users/${encodeURIComponent(sub)}/${blobKey}`;
}

/**
 * Blob keys are app-generated (`blob_<uuid>`); refuse anything else.
 *
 * Must START with an alphanumeric, which is what rejects `.` and `..`. Object
 * storage treats keys as opaque strings, so `users/ryan/..` is not traversal
 * to R2 - but it is a URL, and an intermediary that normalises paths could
 * resolve it to `users/`. Caught by the test rather than by luck.
 */
function safeBlobKey(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : undefined;
}

// ── Sharing (spec 019) ──────────────────────────────────────────────────────

/**
 * Share tokens are `crypto.randomUUID()`; refuse anything else.
 *
 * Stricter than `safeBlobKey` on purpose: no dots at all. A token becomes a
 * path segment in a URL a stranger supplies, and the shape of a uuid is known
 * exactly, so there is no reason to accept anything wider. Rejecting before
 * touching R2 also means a probe costs us nothing.
 */
function safeToken(value: string | undefined): string | undefined {
  if (!value || value.length < 8 || value.length > 64) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value) ? value : undefined;
}

/** Where a share manifest lives. Never under `users/`, which is never public. */
function manifestKeyFor(token: string): string {
  return `shared/${token}.json`;
}

/** The two share paths. Non-global, so `.exec` carries no `lastIndex` state. */
const SHARE_ROUTE = /^\/shared\/([^/]+)$/;
const SHARE_MEDIA_ROUTE = /^\/shared\/([^/]+)\/media\/([^/]+)$/;

/**
 * The published file, as the Worker needs to read it.
 *
 * Only the two fields the Worker acts on are typed. Everything else is the
 * app's business and is passed through untouched - the Worker is not the place
 * that decides what a tank page contains.
 */
interface ShareManifest {
  owner?: unknown;
  allowedBlobKeys?: unknown;
  [key: string]: unknown;
}

/** The manifest, or undefined when there is none. Undefined is what revoked looks like. */
async function readManifest(
  aws: AwsClient, endpointFor: (key: string) => string, token: string,
): Promise<ShareManifest | undefined> {
  const res = await aws.fetch(endpointFor(manifestKeyFor(token)), { method: 'GET' });
  if (res.status === 404 || res.status === 403) return undefined;
  if (!res.ok) throw new Error(`manifest read failed: ${res.status}`);
  return (await res.json()) as ShareManifest;
}

/** The owner, but only when the manifest actually names one as a string. */
function ownerOf(manifest: ShareManifest): string | undefined {
  return typeof manifest.owner === 'string' && manifest.owner ? manifest.owner : undefined;
}

/**
 * Whether this manifest permits this key.
 *
 * The entire access-control model for the public media route. A share token
 * grants exactly the keys its own manifest names, so holding a link is not a
 * way to enumerate somebody's photo library. Defaults to permitting NOTHING
 * when the field is missing or malformed, which is the safe direction for a
 * file that may have been written by a different version of the app.
 */
function permits(manifest: ShareManifest, blobKey: string): boolean {
  const keys = manifest.allowedBlobKeys;
  return Array.isArray(keys) && keys.includes(blobKey);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '');
    const aws = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });
    const endpointFor = (k: string) =>
      `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${k}`;
    const expiresAt = new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString();

    /*
     * THE PUBLIC SURFACE, AND ALL OF IT (spec 019, NFR-14).
     *
     * Everything below this block requires a validated token. This branch is
     * the only exception, it handles GET alone, and it 404s anything that is
     * not one of the two share routes - so the public surface is a closed set
     * of two, not "whatever happens to answer a GET".
     *
     * ANYONE ADDING A ROUTE: put it AFTER `authenticate()` unless it is
     * genuinely meant for strangers. This used to be one blanket
     * `authenticate()` at the top of `fetch`, and turning it into a per-route
     * decision is the kind of edit that fails silently by leaving a photo
     * route open. `index.test.ts` asserts the authenticated routes still 401
     * an anonymous caller; keep that true.
     *
     * NO ORIGIN CHECK HERE, deliberately. A browser sends no `Origin` header
     * when loading an `<img>` or following a link, so gating these on the
     * allowlist would break the photo on every shared page. They are public by
     * design: there is nothing here the token does not already protect, and
     * hotlinking a public image cannot be prevented anyway.
     */
    if (request.method === 'GET') {
      const shared = SHARE_ROUTE.exec(route);
      const media = SHARE_MEDIA_ROUTE.exec(route);
      if (!shared && !media) return json({ error: 'no such route' }, 404, cors);

      const token = safeToken(shared?.[1] ?? media?.[1]);
      if (!token) {
        console.warn('[worker] share read -> bad token', { env: env.ENVIRONMENT, route });
        return json({ error: 'bad token' }, 400, cors);
      }
      const identity = { env: env.ENVIRONMENT, bucket: env.R2_BUCKET, token, route };

      try {
        const manifest = await readManifest(aws, endpointFor, token);
        if (!manifest) {
          // The ordinary outcome of a revoke, not a fault. Logged at info.
          console.info('[worker] share read -> no such share', identity);
          return json({ error: 'no such share' }, 404, cors);
        }

        if (shared) {
          // FR-S07: the owner and the key list are the Worker's business.
          const { owner: _owner, allowedBlobKeys: _keys, ...publicView } = manifest;
          console.info('[worker] share read -> ok', identity);
          return json(publicView, 200, cors);
        }

        const blobKey = safeBlobKey(media![2]);
        if (!blobKey) return json({ error: 'bad blobKey' }, 400, cors);

        if (!permits(manifest, blobKey)) {
          console.warn('[worker] share media -> refused, not in manifest', { ...identity, blobKey });
          return json({ error: 'not shared' }, 403, cors);
        }

        const owner = ownerOf(manifest);
        if (!owner) {
          console.error('[worker] share media -> manifest names no owner', { ...identity, blobKey });
          return json({ error: 'manifest incomplete' }, 502, cors);
        }

        // Signed against the OWNER's prefix, taken from the manifest just
        // read - never from the URL the stranger asked with.
        const signed = await aws.sign(
          new Request(
            `${endpointFor(objectKeyFor(owner, blobKey))}?X-Amz-Expires=${URL_TTL_SECONDS}`,
            { method: 'GET' },
          ),
          { aws: { signQuery: true } },
        );
        console.info('[worker] share media -> redirect', { ...identity, blobKey });
        // A redirect rather than a proxy: the bytes go browser-to-R2, so a
        // 3.6 MB photo never touches this Worker's CPU budget.
        return new Response(null, { status: 302, headers: { ...cors, Location: signed.url } });
      } catch (cause) {
        console.error('[worker] share read -> failed', { ...identity, cause: String(cause) });
        return json({ error: String(cause) }, 500, cors);
      }
    }

    if (!cors['Access-Control-Allow-Origin']) {
      return json({ error: 'origin not allowed' }, 403, cors);
    }

    const claims = await authenticate(request, env);
    if (!claims?.sub) return json({ error: 'unauthenticated' }, 401, cors);

    // --- Publishing and revoking. Authenticated, and owner-checked. ---------

    if (request.method === 'DELETE') {
      const match = SHARE_ROUTE.exec(route);
      if (!match) return json({ error: 'no such route' }, 404, cors);
      const token = safeToken(match[1]);
      if (!token) return json({ error: 'bad token' }, 400, cors);

      const identity = { env: env.ENVIRONMENT, bucket: env.R2_BUCKET, account: claims.sub, token };
      try {
        const manifest = await readManifest(aws, endpointFor, token);
        if (!manifest) {
          // Idempotent: revoking something already gone is success. A retry
          // after a half-failed revoke has to be able to finish.
          console.info('[worker] revoke -> already absent', identity);
          return json({ ok: true, alreadyGone: true }, 200, cors);
        }
        if (ownerOf(manifest) !== claims.sub) {
          console.warn('[worker] revoke -> refused, not the owner', {
            ...identity, manifestOwner: ownerOf(manifest),
          });
          return json({ error: 'not yours' }, 403, cors);
        }

        console.info('[worker] revoke start', identity);
        const res = await aws.fetch(endpointFor(manifestKeyFor(token)), { method: 'DELETE' });
        if (!res.ok && res.status !== 204 && res.status !== 404) {
          console.error('[worker] revoke -> error', { ...identity, status: res.status });
          return json({ error: `delete failed: ${res.status}` }, 502, cors);
        }

        // Verify. A revoke that reports success while the object still serves
        // is the worst outcome here: somebody believes a link is off.
        if (await readManifest(aws, endpointFor, token)) {
          console.error('[worker] revoke -> object survived the delete', identity);
          return json({ error: 'delete did not take effect' }, 502, cors);
        }
        console.info('[worker] revoke -> ok', identity);
        return json({ ok: true }, 200, cors);
      } catch (cause) {
        console.error('[worker] revoke -> failed', { ...identity, cause: String(cause) });
        return json({ error: String(cause) }, 500, cors);
      }
    }

    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);

    if (route === '/shared') {
      let snapshot: Record<string, unknown>;
      try {
        snapshot = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: 'body must be JSON' }, 400, cors);
      }

      const token = safeToken(typeof snapshot.token === 'string' ? snapshot.token : undefined);
      if (!token) return json({ error: 'bad token' }, 400, cors);

      const identity = { env: env.ENVIRONMENT, bucket: env.R2_BUCKET, account: claims.sub, token };
      try {
        /*
         * Refuse to write over somebody else's share.
         *
         * Guessing a uuid is not a realistic attack, but the check is one
         * round trip and the alternative is a route that can silently replace
         * another account's published page. Cheap certainty beats an argument
         * about probability.
         */
        const existing = await readManifest(aws, endpointFor, token);
        if (existing && ownerOf(existing) !== claims.sub) {
          console.warn('[worker] publish -> refused, token belongs to someone else', identity);
          return json({ error: 'not yours' }, 403, cors);
        }

        // The owner is stamped from the VALIDATED subject. Whatever the body
        // said about it is discarded, exactly as blob keys already are.
        const payload = JSON.stringify({ ...snapshot, owner: claims.sub });

        console.info('[worker] publish start', { ...identity, bytes: payload.length });
        const put = await aws.fetch(endpointFor(manifestKeyFor(token)), {
          method: 'PUT',
          body: payload,
          headers: { 'Content-Type': 'application/json' },
        });
        if (!put.ok) {
          console.error('[worker] publish -> write rejected', { ...identity, status: put.status });
          return json({ error: `write failed: ${put.status}` }, 502, cors);
        }

        // NFR-13: verify the side effect, then report. A publish that says ok
        // while the object is absent is the DW_SYNC failure exactly.
        const head = await aws.fetch(endpointFor(manifestKeyFor(token)), { method: 'HEAD' });
        if (!head.ok) {
          console.error('[worker] publish -> wrote, but the object is not there', {
            ...identity, status: head.status,
          });
          return json({ error: 'published object could not be read back' }, 502, cors);
        }

        console.info('[worker] publish -> ok', {
          ...identity, bytes: Number(head.headers.get('content-length') ?? payload.length),
        });
        return json({ ok: true, token }, 200, cors);
      } catch (cause) {
        console.error('[worker] publish -> failed', { ...identity, cause: String(cause) });
        return json({ error: String(cause) }, 500, cors);
      }
    }

    // --- The media routes, unchanged. --------------------------------------

    let body: { blobKey?: unknown; mimeType?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'body must be JSON' }, 400, cors);
    }

    const blobKey = safeBlobKey(body.blobKey);
    if (!blobKey) return json({ error: 'bad blobKey' }, 400, cors);

    const key = objectKeyFor(claims.sub, blobKey);
    const endpoint = endpointFor(key);

    // NFR-13: intent and outcome, with the session identity, as a pair.
    const identity = { env: env.ENVIRONMENT, bucket: env.R2_BUCKET, account: claims.sub, route };

    try {
      if (route === '/presign/put') {
        const signed = await aws.sign(
          new Request(`${endpoint}?X-Amz-Expires=${URL_TTL_SECONDS}`, { method: 'PUT' }),
          { aws: { signQuery: true } },
        );
        console.info('[worker] presign put -> ok', { ...identity, key });
        return json({ url: signed.url, expiresAt }, 200, cors);
      }

      if (route === '/presign/get') {
        const signed = await aws.sign(
          new Request(`${endpoint}?X-Amz-Expires=${URL_TTL_SECONDS}`, { method: 'GET' }),
          { aws: { signQuery: true } },
        );
        console.info('[worker] presign get -> ok', { ...identity, key });
        return json({ url: signed.url, expiresAt }, 200, cors);
      }

      if (route === '/head') {
        const res = await aws.fetch(endpoint, { method: 'HEAD' });
        if (res.status === 404) {
          console.info('[worker] head -> absent', { ...identity, key });
          return json({ present: false }, 200, cors);
        }
        if (!res.ok) {
          console.error('[worker] head -> error', { ...identity, key, status: res.status });
          return json({ error: `head failed: ${res.status}` }, 502, cors);
        }
        const bytes = Number(res.headers.get('content-length') ?? '0');
        const etag = res.headers.get('etag') ?? undefined;
        console.info('[worker] head -> ok', { ...identity, key, bytes });
        return json({ present: true, bytes, etag }, 200, cors);
      }

      return json({ error: 'no such route' }, 404, cors);
    } catch (cause) {
      // Never swallowed. A signing failure that returns a vague 500 is
      // indistinguishable from a bucket problem when read from a phone.
      console.error('[worker] failed', { ...identity, key, cause: String(cause) });
      return json({ error: String(cause) }, 500, cors);
    }
  },
};

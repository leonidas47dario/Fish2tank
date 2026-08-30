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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!cors['Access-Control-Allow-Origin']) {
      return json({ error: 'origin not allowed' }, 403, cors);
    }
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);

    const claims = await authenticate(request, env);
    if (!claims?.sub) return json({ error: 'unauthenticated' }, 401, cors);

    let body: { blobKey?: unknown; mimeType?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'body must be JSON' }, 400, cors);
    }

    const blobKey = safeBlobKey(body.blobKey);
    if (!blobKey) return json({ error: 'bad blobKey' }, 400, cors);

    const key = objectKeyFor(claims.sub, blobKey);
    const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`;
    const aws = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });

    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '');
    const expiresAt = new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString();

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

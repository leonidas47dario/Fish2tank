/**
 * The Worker's access-control behaviour.
 *
 * These are the tests that matter, because everything this Worker does is
 * decide who may touch which key. `wrangler dev` cannot run on this machine
 * (workerd needs a newer glibc), which turns out not to cost much: the risky
 * logic is pure, and exercising it directly is more precise than driving it
 * over HTTP would be.
 *
 * The token-validation round trip is stubbed, so these say nothing about
 * whether Dexie Cloud behaves as documented. That was established separately
 * and empirically - see spec 005 FR-A06.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';

const ORIGIN = 'https://leonidas47dario.github.io';

const env: Env = {
  DEXIE_DATABASE_URL: 'https://zblsiza99.dexie.cloud',
  R2_BUCKET: 'fish2tank-media-uat',
  R2_ACCOUNT_ID: 'acct123',
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5199`,
  ENVIRONMENT: 'uat',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
};

/** A validation response for a token issued by the database we expect. */
function validFor(sub: string, aud: string[] = [env.DEXIE_DATABASE_URL]) {
  return {
    valid: true,
    claims: { sub, aud, exp: Math.floor(Date.now() / 1000) + 3600, scopes: ['ACCESS_DB'] },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** Each test uses a distinct token so the Worker's validation cache cannot leak between them. */
let tokenSeq = 0;
function post(route: string, body: unknown, opts: { origin?: string | null; token?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  const token = opts.token === null ? undefined : (opts.token ?? `token-${++tokenSeq}`);
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://worker.example${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('origin allowlist', () => {
  it('refuses an origin that is not on the list', async () => {
    const res = await worker.fetch(post('/presign/put', { blobKey: 'blob_a' }, { origin: 'https://evil.example' }), env);
    expect(res.status).toBe(403);
    // And never echoes the attacker's origin back.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('never answers with a wildcard, because these responses carry access-granting URLs', async () => {
    fetchMock.mockImplementation(async () => Response.json(validFor('ryan@example.com')));
    const res = await worker.fetch(post('/presign/put', { blobKey: 'blob_a' }), env);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });
});

describe('authentication', () => {
  it('refuses a request with no token', async () => {
    const res = await worker.fetch(post('/presign/put', { blobKey: 'blob_a' }, { token: null }), env);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when Dexie Cloud rejects the token', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 401 }));
    const res = await worker.fetch(post('/presign/put', { blobKey: 'blob_a' }), env);
    expect(res.status).toBe(401);
  });

  /**
   * The attack this closes: anyone can create a free Dexie Cloud database and
   * get a perfectly valid token from it. `valid: true` only means "some Dexie
   * Cloud issued this", which is not the question. Without the audience check
   * a stranger spends this account's R2 quota under their own `sub`.
   */
  it('refuses a valid token issued by a DIFFERENT Dexie database', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(validFor('stranger@example.com', ['https://someoneelse.dexie.cloud'])),
    );
    const res = await worker.fetch(post('/presign/put', { blobKey: 'blob_a' }), env);
    expect(res.status).toBe(401);
  });
});

describe('key scoping', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => Response.json(validFor('ryan@example.com')));
  });

  it('derives the prefix from the token, so a caller cannot name another account', async () => {
    const res = await worker.fetch(post('/presign/put', { blobKey: 'blob_a' }), env);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain('/fish2tank-media-uat/users/ryan%40example.com/blob_a');
  });

  it('refuses a blob key that could climb out of the prefix', async () => {
    for (const blobKey of ['../other/blob_a', 'a/b', '..', 'x'.repeat(500), '']) {
      const res = await worker.fetch(post('/presign/put', { blobKey }), env);
      expect(res.status, `blobKey ${JSON.stringify(blobKey)}`).toBe(400);
    }
  });

  it('signs the URL rather than returning a bare one, with an expiry the caller can read', async () => {
    const res = await worker.fetch(post('/presign/get', { blobKey: 'blob_a' }), env);
    const body = (await res.json()) as { url: string; expiresAt: string };
    expect(body.url).toContain('X-Amz-Signature=');
    expect(body.url).toContain('X-Amz-Expires=');
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe('head', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/token/validate')) return Response.json(validFor('ryan@example.com'));
      if ((init?.method ?? (input instanceof Request ? input.method : 'GET')) === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': '137650', etag: '"abc"' } });
      }
      return new Response(null, { status: 404 });
    });
  });

  it('reports size and etag, which is what makes an upload verifiable', async () => {
    const res = await worker.fetch(post('/head', { blobKey: 'blob_the_panther' }), env);
    expect(await res.json()).toEqual({ present: true, bytes: 137650, etag: '"abc"' });
  });

  it('reports absence as a normal answer, not an error', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/token/validate')) return Response.json(validFor('ryan@example.com'));
      return new Response(null, { status: 404 });
    });
    const res = await worker.fetch(post('/head', { blobKey: 'blob_missing' }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ present: false });
  });
});

describe('routing', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => Response.json(validFor('ryan@example.com')));
  });

  it('answers CORS preflight without requiring a token', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example/presign/put', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('404s an unknown route rather than doing something surprising', async () => {
    const res = await worker.fetch(post('/presign/delete', { blobKey: 'blob_a' }), env);
    expect(res.status).toBe(404);
  });
});

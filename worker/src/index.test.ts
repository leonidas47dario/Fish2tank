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

// ── Sharing (spec 023) ─────────────────────────────────────────────────────

/**
 * The share routes, which are the first UNAUTHENTICATED routes this Worker has
 * ever served. Two things are under test, and the second matters more than the
 * first:
 *
 *   1. That a public route serves only what a live manifest names (NFR-14).
 *   2. That making those routes public did not make the others public. Adding
 *      them turned one blanket `authenticate()` at the top of `fetch` into a
 *      per-route decision, and the way that edit fails is silently, by leaving
 *      a photo route open.
 */

const MANIFEST = {
  version: 1,
  token: 'tok-abcdef12',
  publishedAt: '2026-08-30T12:00:00.000Z',
  buildId: 'b1',
  owner: 'ryan@example.com',
  allowedBlobKeys: ['blob_ok'],
  tank: { name: 'Deep Sea Collector', kind: 'display', photoBlobKey: 'blob_ok' },
  residents: [{ commonName: 'Betta', quantity: 2 }],
  stats: { fish: 2, species: 1 },
};

/** Like `post()`, but for the methods and the anonymity the share routes need. */
function req(method: string, route: string, opts: {
  origin?: string | null; token?: string | null; body?: unknown;
} = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  const token = opts.token === null ? undefined : (opts.token ?? `token-${++tokenSeq}`);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://worker.example${route}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/**
 * A stateful fake of the bucket: one object, which a DELETE actually removes.
 *
 * Stateful rather than a fixed answer because the Worker VERIFIES its own
 * deletes by reading back, and a fake that keeps returning the manifest after
 * a successful DELETE would make that verification look broken. The fake has
 * to be honest about the side effect for the test to say anything.
 */
function withManifest(manifest: unknown | undefined, sub = 'ryan@example.com') {
  let current = manifest;
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.includes('/token/validate')) return Response.json(validFor(sub));
    if (method === 'DELETE') {
      current = undefined;
      return new Response(null, { status: 204 });
    }
    if (method === 'GET') {
      return current === undefined
        ? new Response(null, { status: 404 })
        : Response.json(current);
    }
    return new Response(null, { status: 200 });
  });
}

describe('share: the authenticated routes stay authenticated', () => {
  it('still refuses an anonymous caller everywhere it did before', async () => {
    for (const route of ['/presign/put', '/presign/get', '/head']) {
      const res = await worker.fetch(post(route, { blobKey: 'blob_a' }, { token: null }), env);
      expect(res.status, route).toBe(401);
    }
  });

  it('refuses an anonymous publish and an anonymous revoke', async () => {
    withManifest(MANIFEST);
    expect(
      (await worker.fetch(req('POST', '/shared', { token: null, body: MANIFEST }), env)).status,
    ).toBe(401);
    expect(
      (await worker.fetch(req('DELETE', '/shared/tok-abcdef12', { token: null }), env)).status,
    ).toBe(401);
  });
});

describe('share: reading a published tank', () => {
  it('serves the tank to a caller with no token at all', async () => {
    withManifest(MANIFEST);
    const res = await worker.fetch(req('GET', '/shared/tok-abcdef12', { token: null }), env);
    expect(res.status).toBe(200);
    expect((await res.json() as { tank: { name: string } }).tank.name).toBe('Deep Sea Collector');
  });

  it("strips the owner and the key list, which are the Worker's business alone", async () => {
    withManifest(MANIFEST);
    const res = await worker.fetch(req('GET', '/shared/tok-abcdef12', { token: null }), env);
    const body = await res.json() as Record<string, unknown>;
    expect(body.owner).toBeUndefined();
    expect(body.allowedBlobKeys).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('ryan@example.com');
  });

  it('404s a token that names no manifest, which is what revoked looks like', async () => {
    withManifest(undefined);
    const res = await worker.fetch(req('GET', '/shared/tok-gone1234', { token: null }), env);
    expect(res.status).toBe(404);
  });

  it('refuses a token that is not shaped like one, without touching R2', async () => {
    withManifest(MANIFEST);
    for (const token of ['a', 'x'.repeat(100), 'tok.abc', 'tok_abc']) {
      const res = await worker.fetch(req('GET', `/shared/${token}`, { token: null }), env);
      expect(res.status, token).toBe(400);
    }
  });

  /**
   * Traversal never even reaches the token check, because `new URL()`
   * normalises the path first: `/shared/..` becomes `/`, which matches no
   * route. Asserted rather than assumed - the defence being relied on here is
   * the URL parser's, and it is worth having a test say so out loud.
   */
  it('cannot be walked out of the shared prefix', async () => {
    withManifest(MANIFEST);
    for (const path of ['/shared/..', '/shared/../../users/ryan', '/shared/%2e%2e']) {
      const res = await worker.fetch(req('GET', path, { token: null }), env);
      expect([400, 404], path).toContain(res.status);
      expect(res.headers.get('Location'), path).toBeNull();
    }
  });
});

describe('share: serving a photo the manifest names', () => {
  it("redirects to a presigned URL under the OWNER's prefix, not the caller's", async () => {
    withManifest(MANIFEST);
    const res = await worker.fetch(
      req('GET', '/shared/tok-abcdef12/media/blob_ok', { token: null }), env,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('/users/ryan%40example.com/blob_ok');
    expect(location).toContain('X-Amz-Signature=');
  });

  /**
   * The whole access-control model for a public route, in one test. A token
   * grants exactly the keys its manifest names, so holding a share link is not
   * a way to enumerate somebody's photo library.
   */
  it('refuses a key the manifest does not name', async () => {
    withManifest(MANIFEST);
    const res = await worker.fetch(
      req('GET', '/shared/tok-abcdef12/media/blob_evil', { token: null }), env,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('404s a photo request under a revoked token', async () => {
    withManifest(undefined);
    const res = await worker.fetch(
      req('GET', '/shared/tok-abcdef12/media/blob_ok', { token: null }), env,
    );
    expect(res.status).toBe(404);
  });
});

describe('share: publishing and revoking', () => {
  it('takes the owner from the validated token, never from the body', async () => {
    const written: string[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.includes('/token/validate')) return Response.json(validFor('ryan@example.com'));
      if (method === 'PUT') {
        // aws4fetch signs into a Request and calls fetch with it, so the body
        // is on `input`, not on `init`. Cover both rather than guessing.
        written.push(
          input instanceof Request
            ? await input.clone().text()
            : String(init?.body ?? ''),
        );
        return new Response(null, { status: 200 });
      }
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': '900' } });
      }
      return Response.json(MANIFEST);
    });

    const res = await worker.fetch(
      req('POST', '/shared', { body: { ...MANIFEST, owner: 'attacker@example.com' } }), env,
    );
    expect(res.status).toBe(200);
    expect(written[0]).toContain('ryan@example.com');
    expect(written[0]).not.toContain('attacker@example.com');
  });

  it('refuses to report a publish it could not verify afterwards', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.includes('/token/validate')) return Response.json(validFor('ryan@example.com'));
      if (method === 'PUT') return new Response(null, { status: 200 });
      // The write said ok and the object is not there. Never call that success.
      return new Response(null, { status: 404 });
    });

    const res = await worker.fetch(req('POST', '/shared', { body: MANIFEST }), env);
    expect(res.status).toBe(502);
  });

  it('refuses a revoke from somebody who does not own the manifest', async () => {
    withManifest(MANIFEST, 'stranger@example.com');
    const res = await worker.fetch(req('DELETE', '/shared/tok-abcdef12'), env);
    expect(res.status).toBe(403);
  });

  it('lets the owner revoke', async () => {
    withManifest(MANIFEST, 'ryan@example.com');
    const res = await worker.fetch(req('DELETE', '/shared/tok-abcdef12'), env);
    expect(res.status).toBe(200);
  });
});

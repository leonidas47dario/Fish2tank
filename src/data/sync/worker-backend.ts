/**
 * The real `MediaBackend`, talking to the Cloudflare Worker.
 *
 * Spec 005 FR-A03. Slots under the seam in backend.ts without the queue
 * changing, which is the point of the seam: the retry, resume and
 * refuse-to-mark-synced-without-verifying logic in media-queue.ts was built
 * and tested against a fake, and none of it knows this exists.
 *
 * THE PREFIX IS NOT SENT. `objectKeyFor` builds `users/{account}/{blobKey}`
 * client-side so the queue can reason about keys, but the Worker rebuilds that
 * prefix from the validated token and ignores anything we claim. So this
 * adapter sends the bare blob key and checks that the key it was handed
 * belongs to the account it thinks it is. A mismatch is a bug in the caller,
 * not a request to make, so it throws rather than being quietly corrected.
 */
import type { MediaBackend, ObjectHead, SignedUrl } from './backend';

export interface WorkerBackendOptions {
  /** Base URL of the deployed Worker, no trailing slash. */
  workerUrl: string;
  /** The account the queue is running as, used only to sanity-check keys. */
  account: string;
  /**
   * Supplies a current Dexie Cloud access token. A function rather than a
   * value because tokens expire mid-run, and a long media backfill will
   * outlive one.
   */
  getAccessToken: () => string | undefined;
  fetchImpl?: typeof fetch;
}

/** `users/{account}/{blobKey}` back to `blobKey`, refusing anything else. */
function blobKeyFrom(key: string, account: string): string {
  const prefix = `users/${account}/`;
  if (!key.startsWith(prefix)) {
    throw new Error(`Refusing to sign a key outside this account: ${key}`);
  }
  const blobKey = key.slice(prefix.length);
  if (!blobKey || blobKey.includes('/')) {
    throw new Error(`Not a blob key: ${key}`);
  }
  return blobKey;
}

export function createWorkerBackend(options: WorkerBackendOptions): MediaBackend {
  // Bound to the global: see the note in media-queue.ts. A bare `fetch`
  // reference called through a variable is an Illegal invocation.
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const base = options.workerUrl.replace(/\/+$/, '');

  async function call(route: string, blobKey: string): Promise<unknown> {
    const token = options.getAccessToken();
    // Signed out is a normal state, not a crash, but it is never a silent one.
    if (!token) throw new Error('Not signed in, so no media URL can be issued');

    const res = await doFetch(`${base}${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobKey }),
    });

    if (!res.ok) {
      // Carry the Worker's own message through. "403" alone is unreadable on a
      // phone; "403 origin not allowed" is a diagnosis.
      let detail = '';
      try {
        detail = ((await res.json()) as { error?: string }).error ?? '';
      } catch {
        detail = res.statusText;
      }
      throw new Error(`${route} failed: ${res.status} ${detail}`.trim());
    }
    return res.json();
  }

  return {
    async presignPut(key: string): Promise<SignedUrl> {
      const body = (await call('/presign/put', blobKeyFrom(key, options.account))) as SignedUrl;
      return body;
    },

    async presignGet(key: string): Promise<SignedUrl> {
      const body = (await call('/presign/get', blobKeyFrom(key, options.account))) as SignedUrl;
      return body;
    },

    async head(key: string): Promise<ObjectHead | undefined> {
      const body = (await call('/head', blobKeyFrom(key, options.account))) as {
        present: boolean;
        bytes?: number;
        etag?: string;
      };
      // Absent resolves undefined rather than throwing: the queue treats "not
      // there yet" as a normal state, and it is how a failed upload is caught.
      if (!body.present) return undefined;
      return { bytes: body.bytes ?? 0, etag: body.etag };
    },
  };
}

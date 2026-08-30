/**
 * The seam between "move these bytes" and "whose bucket they land in".
 *
 * Spec 005 FR-A03. Everything above this interface is provider-agnostic; the
 * Cloudflare Worker implementation slots in underneath without the queue
 * changing. That is NFR-12's "external sources sit behind adapters" applied to
 * storage, and it is what lets the queue be tested without a network.
 *
 * Three methods, because presigned PUT, presigned GET and HEAD are the whole
 * S3-compatible contract this needs. Anything more would be inventing
 * requirements for a backend that does not exist yet.
 */

/**
 * Who and where, attached to every log line.
 *
 * A sync that does not say which account, which database and which
 * environment it touched cannot be diagnosed after the fact, and wrong-tier
 * writes are invisible without it. This is the DW_SYNC lesson stated as a
 * type: you cannot construct a sync run without declaring its identity.
 */
export interface SyncEnvironment {
  /** The signed-in subject. `'anonymous'` before Release 2's auth exists. */
  account: string;
  /** Which Dexie Cloud database, or `'none'` while records stay local. */
  databaseUrl: string;
  /** Which object store bucket. */
  bucket: string;
  /** `'production'` | `'uat'` | `'development'`. */
  environment: string;
}

/** A short-lived, authenticated URL. NFR-10 requires both properties. */
export interface SignedUrl {
  url: string;
  /** Absolute expiry, so a caller can tell "expired" from "rejected". */
  expiresAt: string;
}

/** What the store says it holds. Used to verify, never to trust blindly. */
export interface ObjectHead {
  bytes: number;
  /** Absent on backends that do not expose one; size alone still verifies. */
  etag?: string;
}

export interface MediaBackend {
  presignPut(key: string, mimeType: string): Promise<SignedUrl>;
  presignGet(key: string): Promise<SignedUrl>;
  /** Resolves undefined when the object is absent, rather than throwing. */
  head(key: string): Promise<ObjectHead | undefined>;
}

/**
 * Storage key for a blob, namespaced per account.
 *
 * Per-account prefixing is what makes one keeper's media unreachable from
 * another's signed URL, so it belongs here next to the interface rather than
 * being reconstructed at each call site.
 */
export function objectKeyFor(account: string, blobKey: string): string {
  return `users/${account}/${blobKey}`;
}

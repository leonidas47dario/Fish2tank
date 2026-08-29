/**
 * The boundary between "a subagent claimed this" and "this ships".
 *
 * Pure, so every rule is testable without a network. The download itself lives
 * in ingest-proposals.ts; this decides what to do with the result.
 *
 * These rules catch technical failures and self-contradictions. They cannot
 * catch a confident, well-argued mistake about which Hypancistrus is in the
 * photo. That is what `confidence` and the review file are for, and spec 002
 * records the residual risk rather than claiming the gate closes it.
 */
import type { Provenance } from './sources/wikimedia';

/**
 * Portraits render into a 480px-wide card. An image under this is upscaled,
 * and a blurry upscale looks worse than the silhouette it replaced.
 */
export const MIN_LONG_EDGE = 400;

/** A reason shorter than this is not evidence, it is a shrug. */
const MIN_REASON_CHARS = 25;

export interface Proposal {
  species_id: string;
  url: string | null;
  provenance: Provenance;
  license: string | null;
  artist: string | null;
  attribution_url: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  corrected_scientific_name: string | null;
}

export interface Downloaded {
  contentType: string;
  width: number;
  height: number;
  bytes: number;
}

export type Verdict =
  | { verdict: 'accept' }
  | { verdict: 'review'; reason: string }
  | { verdict: 'reject'; reason: string };

export function checkProposal(
  p: Proposal,
  got: Downloaded | null,
  claimedUrls: Set<string>,
): Verdict {
  if (!p.url) return { verdict: 'reject', reason: 'no url proposed' };
  if (!p.attribution_url) {
    return { verdict: 'reject', reason: 'no attribution url, so the source cannot be stated' };
  }
  if (!got) return { verdict: 'reject', reason: `download failed for ${p.url}` };
  if (!got.contentType.startsWith('image/')) {
    return { verdict: 'reject', reason: `content type is ${got.contentType}, not an image` };
  }
  const longEdge = Math.max(got.width, got.height);
  if (longEdge < MIN_LONG_EDGE) {
    return { verdict: 'reject', reason: `long edge ${longEdge}px is under ${MIN_LONG_EDGE}px` };
  }
  if (claimedUrls.has(p.url)) {
    return { verdict: 'reject', reason: `duplicate: another species already claims ${p.url}` };
  }
  if (p.confidence === 'low') {
    return { verdict: 'review', reason: `low confidence: ${p.reason}` };
  }
  if (p.reason.trim().length < MIN_REASON_CHARS) {
    return { verdict: 'review', reason: `reason too thin to audit: "${p.reason}"` };
  }
  return { verdict: 'accept' };
}

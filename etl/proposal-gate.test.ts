import { describe, expect, it } from 'vitest';
import { MIN_LONG_EDGE, checkProposal, type Downloaded, type Proposal } from './proposal-gate';

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  species_id: 'sp_x',
  url: 'https://example.com/fish.jpg',
  provenance: 'web',
  license: null,
  artist: 'Someone',
  attribution_url: 'https://example.com/page',
  confidence: 'high',
  reason: 'Caption names the binomial and the fish matches the described markings.',
  corrected_scientific_name: null,
  ...over,
});

const ok: Downloaded = { contentType: 'image/jpeg', width: 1200, height: 800, bytes: 240_000 };

describe('checkProposal', () => {
  it('accepts a well-formed high-confidence proposal', () => {
    expect(checkProposal(proposal(), ok, new Set())).toEqual({ verdict: 'accept' });
  });

  it('reviews a low-confidence proposal instead of shipping it', () => {
    const r = checkProposal(proposal({ confidence: 'low' }), ok, new Set());
    expect(r.verdict).toBe('review');
  });

  it('rejects a proposal with no url', () => {
    const r = checkProposal(proposal({ url: null }), null, new Set());
    expect(r).toEqual({ verdict: 'reject', reason: 'no url proposed' });
  });

  it('rejects a url that would not download', () => {
    const r = checkProposal(proposal(), null, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain('download failed');
  });

  it('rejects a non-image content type', () => {
    // A subagent handing back an HTML page URL is the commonest failure, and
    // it looks exactly like a working proposal until you fetch it.
    const r = checkProposal(proposal(), { ...ok, contentType: 'text/html' }, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain('text/html');
  });

  it('rejects an image too small to beat the silhouette', () => {
    const r = checkProposal(proposal(), { ...ok, width: 320, height: 240 }, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain(String(MIN_LONG_EDGE));
  });

  it('rejects a duplicate of an image already claimed by another species', () => {
    // Two species resolving to one photo means at least one is wrong, and
    // shipping both would put the same fish on two different cards.
    const r = checkProposal(proposal(), ok, new Set(['https://example.com/fish.jpg']));
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain('duplicate');
  });

  it('rejects a proposal with no attribution url', () => {
    const r = checkProposal(proposal({ attribution_url: null }), ok, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain('attribution');
  });

  it('reviews a proposal whose reason is too thin to audit', () => {
    // "reason" is the field a human reads when checking a doubtful call. Two
    // words are not evidence.
    const r = checkProposal(proposal({ reason: 'looks right' }), ok, new Set());
    expect(r.verdict).toBe('review');
    expect(r.verdict === 'review' && r.reason).toContain('reason');
  });
});

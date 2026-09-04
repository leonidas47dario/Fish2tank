/**
 * Spec 060. These tables exist because a rule could not reach these cases, so
 * what has to be guarded is the thing a table can get wrong: an entry nobody
 * checked, and a match that is too generous.
 */
import { describe, expect, it } from 'vitest';
import {
  SF_SLUG_ALIASES, SF_SAME_FISH, SLUG_BY_BINOMIAL, sameFish,
} from './seriously-fish-aliases';

describe('curated correspondences cite their evidence', () => {
  // The rule species-overrides.ts already sets for curated data: "an uncited
  // correction is a guess wearing a lab coat". Asserted, not left to review.
  it.each([...SF_SLUG_ALIASES, ...SF_SAME_FISH])('$binomial cites a source', (entry) => {
    expect(entry.source.trim().length).toBeGreaterThan(30);
  });

  it('names each binomial once, so no entry silently overrides another', () => {
    const names = SF_SLUG_ALIASES.map((a) => a.binomial.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('indexes every alias case-insensitively', () => {
    expect(SLUG_BY_BINOMIAL.get('axelrodia riesei')).toBe('axelrodi-riesei');
    expect(SLUG_BY_BINOMIAL.get('AXELRODIA RIESEI'.toLowerCase())).toBe('axelrodi-riesei');
  });
});

describe('sameFish', () => {
  it('accepts every slug alias against the name its slug is built from', () => {
    /*
     * The regression this file was rewritten for. All three alias entries found
     * the right SF page and were then rejected by the wrong-animal guard,
     * because the page states the name the slug is built from and the alias
     * table alone never told the guard they were one fish. The equivalences are
     * now DERIVED from the aliases, and this asserts that they stay so.
     */
    for (const a of SF_SLUG_ALIASES) {
      expect(sameFish(a.binomial, a.slug.replace(/-/g, ' '))).toBe(true);
    }
  });

  it('accepts a curated pair in both directions', () => {
    expect(sameFish('Brachydanio rerio', 'Danio rerio')).toBe(true);
    expect(sameFish('Danio rerio', 'Brachydanio rerio')).toBe(true);
  });

  it('accepts a name against itself', () => {
    expect(sameFish('Danio rerio', 'danio rerio')).toBe(true);
  });

  it('REFUSES two species that merely look related', () => {
    // Spec 056 rejected these and spec 060 does not overturn it: bivittatum and
    // bitaeniatum are different Aphyosemion, and SF folding N. brichardi into
    // N. pulcher is contested rather than settled.
    expect(sameFish('Aphyosemion bivittatum', 'Aphyosemion bitaeniatum')).toBe(false);
    expect(sameFish('Neolamprologus brichardi', 'Neolamprologus pulcher')).toBe(false);
  });

  it('REFUSES the epithet collisions that motivated spec 060', () => {
    expect(sameFish('Esox niger', 'Oxydoras niger')).toBe(false);
    expect(sameFish('Carassius auratus', 'Melanochromis auratus')).toBe(false);
  });

  it('is false rather than throwing when a name is missing', () => {
    expect(sameFish(undefined, 'Danio rerio')).toBe(false);
    expect(sameFish('Danio rerio', undefined)).toBe(false);
  });
});

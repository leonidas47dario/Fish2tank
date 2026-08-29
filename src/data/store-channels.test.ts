import { describe, expect, it } from 'vitest';
import { STORE_CHANNELS } from './store-channels';
import { MARKET_INDEX } from './market';
import { STORES } from '../../etl/types';

describe('every tracked vendor is classified', () => {
  it('covers every store the ETL declares', () => {
    expect(STORES.filter((s) => !STORE_CHANNELS[s.id]).map((s) => s.id)).toEqual([]);
  });

  it('covers every source in the shipped index', () => {
    expect(MARKET_INDEX.sources.filter((s) => !STORE_CHANNELS[s.id]).map((s) => s.id)).toEqual([]);
  });

  it('has no entry for a store that does not exist', () => {
    const known = new Set(STORES.map((s) => s.id));
    expect(Object.keys(STORE_CHANNELS).filter((id) => !known.has(id))).toEqual([]);
  });
});

describe('the classification the rating depends on', () => {
  it('keeps the big online specialists out of the local-shelf sample', () => {
    for (const id of [
      'predatory-fins',
      // Ryan's call, backed by catalogue shape: 70.9% of its species are
      // carried by no other tracked store, against PF's 79.2%.
      'aquatic-arts',
      'global-exoticquatics',
      'j4-flowerhorns',
      'flip-aquatics',
      // Marine-dominant, so its silence about a freshwater fish means nothing.
      'liveaquaria',
    ]) {
      expect(STORE_CHANNELS[id]).toBe('specialist');
    }
  });

  it('counts the generalist shops as shelves', () => {
    for (const id of ['imperial-tropicals', 'aquahuna', 'aquarium-coop', 'nu-aqua']) {
      expect(STORE_CHANNELS[id]).toBe('community');
    }
  });
});

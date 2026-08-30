import { describe, expect, it } from 'vitest';
import { isDeveloperMode, passphraseMatches, sha256Hex } from './dev-mode';

/**
 * The passphrase itself is not here either - spec 013 says the plaintext must
 * not appear anywhere in the repository, and a test file is in the
 * repository. What is asserted is the shape of the check.
 *
 * The storage and banner behaviour is not asserted here: this suite runs under
 * node with no `localStorage` and no `window`, and buying a DOM environment
 * for two booleans would be worse than verifying them the way spec 013 was
 * actually verified - by driving the real build in a browser.
 */
const COMMITTED_DIGEST = 'a93162b0fb583a3ff9f8c78b4c76f5e1a0f7f21705a709bf962248f555b504e2';

describe('developer mode (spec 013)', () => {
  it('refuses a passphrase that does not match', async () => {
    expect(await passphraseMatches('not the passphrase')).toBe(false);
  });

  it('refuses an empty passphrase', async () => {
    expect(await passphraseMatches('')).toBe(false);
  });

  it('refuses the digest itself, typed in as if it were the passphrase', async () => {
    // The digest is public in the source. Accepting it would make the commit
    // that hides the plaintext pointless.
    expect(await passphraseMatches(COMMITTED_DIGEST)).toBe(false);
  });

  it('answers no rather than throwing where there is no storage', () => {
    // Node has no `localStorage`, so this is the real no-storage path and not
    // a simulation of it. The gate renders on the first frame of a cold start;
    // this must never be the thing that fails.
    expect(isDeveloperMode()).toBe(false);
  });

  it('hashes with SHA-256, hex, lower case', async () => {
    // The empty-string digest is a fixed published value. If this drifts, the
    // committed digest means something else and no passphrase works.
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(COMMITTED_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });
});

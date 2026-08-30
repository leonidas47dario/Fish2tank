/**
 * Developer mode - spec 013. A deliberate, visible way past the sign-in gate.
 *
 * WHAT THIS IS NOT: a secret. The check runs in the browser, in a public
 * repository. Only the SHA-256 of the passphrase is committed, so the string
 * itself is not published, but anyone who wants in can read the bundle, set
 * the storage key by hand, and skip the passphrase entirely. No client-side
 * check can prevent that, and this file will not imply otherwise.
 *
 * That is acceptable only because of what developer mode gets you: the app,
 * SIGNED OUT, with an empty local database and the bundled species catalog.
 * Records live in Dexie Cloud behind a Google sign-in and photos live in R2
 * behind the Worker's token check; neither is touched here. It unlocks an
 * empty app on the device it is typed into. If it protected anything real, a
 * passphrase in a bundle would be the wrong tool entirely.
 *
 * Spec 010's gate exists because a signed-out device looked healthy while
 * silently accumulating data that could not survive it. So this is never
 * quiet: DeveloperBanner says so on every route for as long as it is on.
 */

/**
 * SHA-256 of the passphrase.
 *
 * To rotate, replace this with a new digest - the plaintext must not appear
 * here or anywhere else in the repository:
 *
 *   node -e "console.log(require('crypto').createHash('sha256')
 *     .update('NEW PASSPHRASE','utf8').digest('hex'))"
 */
const DEVELOPER_PASSPHRASE_SHA256 =
  'a93162b0fb583a3ff9f8c78b4c76f5e1a0f7f21705a709bf962248f555b504e2';

/** Namespaced so it cannot collide with the theme's older loose keys. */
const STORAGE_KEY = 'fish2tank.developerMode';

/** Fired on the window when the mode changes, so the UI can react in place. */
export const DEVELOPER_MODE_EVENT = 'fish2tank:developer-mode';

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether developer mode is on.
 *
 * Total: a browser with storage disabled, a private window that throws on
 * access, or node with no `localStorage` at all answers "no" rather than
 * taking the app down on the first line it renders. The `catch` covers the
 * ReferenceError as well as the SecurityError.
 */
export function isDeveloperMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Whether a typed passphrase is the right one.
 *
 * Split out from `enterDeveloperMode` so the check itself can be tested
 * without a DOM - this repo's suite runs under node with no `localStorage`
 * and no `window`, and adding a DOM environment for one boolean would be a
 * dependency bought with nothing.
 */
export async function passphraseMatches(passphrase: string): Promise<boolean> {
  return (await sha256Hex(passphrase)) === DEVELOPER_PASSPHRASE_SHA256;
}

/**
 * Check the passphrase and, if it matches, turn developer mode on.
 *
 * Returns whether it matched rather than throwing: a typo is an ordinary
 * outcome of a password field, not an exception.
 */
export async function enterDeveloperMode(passphrase: string): Promise<boolean> {
  if (!(await passphraseMatches(passphrase))) return false;
  try {
    localStorage.setItem(STORAGE_KEY, 'on');
  } catch (cause) {
    // Storage refused, so the mode cannot survive a reload. Said out loud
    // rather than reported as a success that quietly evaporates.
    console.warn('[dev-mode] could not persist developer mode', cause);
    return false;
  }
  console.info('[dev-mode] on - signed out, nothing is syncing');
  announce();
  return true;
}

export function leaveDeveloperMode(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (cause) {
    console.warn('[dev-mode] could not clear developer mode', cause);
  }
  console.info('[dev-mode] off');
  announce();
}

/** Guarded so the module can be imported outside a browser at all. */
function announce(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DEVELOPER_MODE_EVENT));
}

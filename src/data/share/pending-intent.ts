/**
 * The thing a guest was trying to do before they were asked to sign in.
 *
 * Spec 015, FR-S06. Without this the funnel leaks at its last step: somebody
 * taps the heart on a Betta, signs up, lands somewhere else entirely, and
 * never finds the fish that interested them. The tap has to survive the round
 * trip or it may as well not have been offered.
 *
 * WHY localStorage AND NOT sessionStorage. Google sign-in can return through a
 * full-page redirect, and on some browsers that lands in a context where the
 * session store has been discarded. localStorage survives it. The window is
 * short and the payload is a species id, so the durability costs nothing.
 *
 * WHY IT IS CONSUMED ON READ. An intent left behind would re-fire on every
 * later visit to that page, quietly adding a fish to somebody's Dream List
 * weeks after they asked for it once.
 */

const KEY = 'fish2tank:share:pending-intent';

/**
 * How long an intent stays good.
 *
 * Long enough for a sign-in that involves creating an account, picking a
 * Google profile and a consent screen. Short enough that a tab reopened
 * tomorrow does not act on a tap from yesterday.
 */
const TTL_MS = 15 * 60 * 1000;

export interface PendingIntent {
  action: 'heart' | 'profile';
  speciesId: string;
  /** The route to come back to, so the guest lands on the tank they were reading. */
  returnTo: string;
  /** For the TTL. Epoch millis. */
  at: number;
}

/**
 * Remember what to do after signing in.
 *
 * Never throws. Safari in private mode throws on write, and a heart that
 * cannot be remembered must degrade to a heart that is not remembered - not
 * to a page that fell over.
 */
export function remember(intent: Omit<PendingIntent, 'at'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }));
    console.info('[share] intent remembered', { action: intent.action, speciesId: intent.speciesId });
  } catch (cause) {
    // Logged, not swallowed: the sign-in will still work, and the heart will
    // silently not be applied, so this line is the only trace of why.
    console.warn('[share] intent could not be stored', { cause: String(cause) });
  }
}

/**
 * Take the pending intent, if there is a fresh one. Reading removes it.
 *
 * Returns undefined for absent, unparseable and expired alike - all three mean
 * "nothing to do", and a caller that had to tell them apart would be deciding
 * something it has no information about.
 */
export function takePending(now = Date.now()): PendingIntent | undefined {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw !== null) localStorage.removeItem(KEY);
  } catch (cause) {
    console.warn('[share] intent could not be read', { cause: String(cause) });
    return undefined;
  }
  if (!raw) return undefined;

  let parsed: Partial<PendingIntent>;
  try {
    parsed = JSON.parse(raw) as Partial<PendingIntent>;
  } catch {
    console.warn('[share] intent was not readable JSON, discarding');
    return undefined;
  }

  if (
    (parsed.action !== 'heart' && parsed.action !== 'profile')
    || typeof parsed.speciesId !== 'string'
    || typeof parsed.returnTo !== 'string'
    || typeof parsed.at !== 'number'
  ) {
    console.warn('[share] intent was not the right shape, discarding');
    return undefined;
  }

  if (now - parsed.at > TTL_MS) {
    console.info('[share] intent expired, discarding', { ageMs: now - parsed.at });
    return undefined;
  }

  return parsed as PendingIntent;
}

/** Drop anything pending without acting on it. */
export function clearPending(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do and nothing at risk: an intent that cannot be removed will
    // expire on its own, and is consumed on the next read regardless.
  }
}

/**
 * Start a new screen at the top; put you back where you were on Back.
 *
 * A hash router changes the route without touching the scroll position, and
 * the browser does not restore one for a hash change either. Both halves of
 * that were wrong here, in opposite directions:
 *
 *   - Tapping a fish from deep in the catalog opened its page already
 *     scrolled past the photograph, the name and the care profile, landing on
 *     the store list. The deeper you browsed, the worse it got.
 *   - Coming back from that fish dropped you at the top of 2,178 species,
 *     with no way to find the row you were reading except to scroll again.
 *
 * The second is the one that matters. A collection browser you cannot back out
 * of without losing your place is a collection browser you use once.
 */
import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * How long to keep trying to restore before giving up.
 *
 * Restoration has to wait for the content. The catalog reads seven IndexedDB
 * tables and builds 2,178 view models before it has any height at all, which
 * measures at about 1.5s on a cold load; until then a scrollTo(6000) silently
 * clamps to the bottom of a placeholder. A 1.2s budget expired first and left
 * the page at 109px.
 */
const RESTORE_TIMEOUT_MS = 4000;

export function ScrollMemory() {
  const location = useLocation();
  const navigationType = useNavigationType();
  /*
   * Keyed by history entry, but the PATHNAME is stored alongside and checked
   * before restoring.
   *
   * HashRouter hands out the key `default` to any entry it has no state for,
   * which is every hash the address bar or a pasted deep link produces. Two
   * unrelated species pages therefore share one key, and restoring on the key
   * alone opened the second one at the first one's scroll position - halfway
   * down a market panel belonging to a different fish.
   */
  const positions = useRef(new Map<string, { pathname: string; y: number }>());

  /*
   * Everything lives in ONE layout effect, and that is load-bearing rather
   * than tidiness.
   *
   * Recording the outgoing position from a passive useEffect cleanup does not
   * work: passive cleanups run AFTER the incoming route's layout effect has
   * already scrolled to 0, so every entry recorded itself as 0 on the way out
   * and Back always returned to the top. A layout-effect cleanup runs before
   * the next layout effect, which is the only point where the old position is
   * still true.
   */
  useLayoutEffect(() => {
    const key = location.key;
    const { pathname } = location;
    const remember = () => positions.current.set(key, { pathname, y: window.scrollY });
    window.addEventListener('scroll', remember, { passive: true });

    const saved = positions.current.get(key);
    const target = navigationType === 'POP' && saved?.pathname === pathname ? saved.y : 0;

    let frame = 0;
    let abandoned = false;
    /*
     * A scrollbar drag is a deliberate scroll that fires none of wheel,
     * touchstart or keydown, so without the pointer events the hold below
     * would fight a mouse user for the rest of the budget.
     */
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown', 'mousedown'] as const;
    const surrender = () => { abandoned = true; };

    if (target) {
      /* Several seconds is long enough that the user may well start scrolling
         first, and a page that yanks itself out from under a deliberate flick
         is worse than one that forgot where you were. Any input wins. */
      for (const e of events) window.addEventListener(e, surrender, { passive: true, once: true });

      /*
       * HOLDS the position for the whole budget rather than stopping at the
       * first frame that reaches it.
       *
       * Reaching the target once is not the same as staying there. A record
       * page fills in from seven live queries, and when a panel ABOVE the
       * restored position grows, Chrome's scroll anchoring shifts the page
       * down by exactly that much to keep the visible content still - which is
       * the right instinct and the wrong outcome here, because it is fighting
       * a restore rather than a reader. Measured on a specimen record: land on
       * 794, settle at 947, every time.
       *
       * Stopping early cannot fix that, since the shift happens after the last
       * frame the old loop ran. So it keeps re-asserting, and the surrender
       * listeners above are what stop it being a fight - any real input from
       * the reader wins immediately.
       */
      const deadline = performance.now() + RESTORE_TIMEOUT_MS;
      const tryRestore = () => {
        if (abandoned) return;
        if (Math.abs(window.scrollY - target) >= 2) window.scrollTo(0, target);
        if (performance.now() < deadline) frame = requestAnimationFrame(tryRestore);
      };
      frame = requestAnimationFrame(tryRestore);
    } else {
      window.scrollTo(0, 0);
    }

    return () => {
      remember();
      window.removeEventListener('scroll', remember);
      cancelAnimationFrame(frame);
      for (const e of events) window.removeEventListener(e, surrender);
    };
  }, [location.key, location.pathname, navigationType]);

  return null;
}

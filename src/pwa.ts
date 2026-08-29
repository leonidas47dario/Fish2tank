/**
 * Register the service worker, and reload once when a new build takes over.
 *
 * WHY THIS IS NOT THE PLUGIN'S DEFAULT REGISTRATION. `registerType: 'autoUpdate'`
 * gives the worker `skipWaiting` + `clientsClaim`, so a fresh deploy installs and
 * activates in the background - but the page already on screen keeps the HTML and
 * JS the *old* worker handed it. The visible symptom is that a new release only
 * appears on the second visit: the first one silently swaps the worker underneath
 * unchanged content. On a staging site that is reloaded constantly to review
 * changes, that reads as "the deploy didn't happen".
 *
 * `controllerchange` fires exactly when the new worker claims this page, which is
 * the first moment a reload is guaranteed to serve the new build.
 */
const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

export function registerServiceWorker(): void {
  // No worker is generated in dev, so there is nothing to register.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // Captured before registration. On a first-ever visit there is no controller,
  // and the controllerchange that follows is just the worker taking over a page
  // that already holds the newest build - reloading there would be a pointless
  // flash. Only a *replaced* controller means the content on screen is stale.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    // Keeps the hash route, so the reload lands back on the same screen.
    window.location.reload();
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(SW_URL, { scope: import.meta.env.BASE_URL })
      // A failed registration costs offline support, not the app: the page is
      // already rendered and every screen works from IndexedDB.
      .catch((e: unknown) => console.warn('Service worker registration failed', e));
  });
}

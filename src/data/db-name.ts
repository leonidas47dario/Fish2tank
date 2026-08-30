/**
 * Which IndexedDB database a build should open (BUG-04).
 *
 * IndexedDB is scoped per ORIGIN, not per path. Both environments deploy to
 * `leonidas47dario.github.io` - production at `/Fish2tank/` and staging at
 * `/Fish2tank/uat/` - so until this existed they shared one database called
 * `fish2tank`. A UAT build with a schema bug could corrupt production records,
 * which is the exact thing the UAT gate (FR-R14) exists to prevent. Spec 005
 * notes that enabling sync would make that corruption propagate to every
 * device, which is why this lands before the addon does.
 *
 * PRODUCTION KEEPS THE NAME `fish2tank`. That is not an aesthetic choice. The
 * real collection lives in a database with that name today, and renaming it
 * would present an empty app to the person whose fish they are. Only staging
 * moves, and staging opening empty once is the intended, one-time cost.
 *
 * Lives in its own module so `vite.config.ts` and the test can both import it,
 * rather than the rule being written twice and drifting.
 */

/** The production database name. Never change this without a migration. */
export const PRODUCTION_DB_NAME = 'fish2tank';

/**
 * @param base The Vite base path the build was made with, e.g. `/Fish2tank/uat/`.
 *   Staging is identified the same way `vite.config.ts` already identifies it
 *   for the service worker denylist.
 */
export function databaseNameFor(base: string): string {
  return base.endsWith('/uat/') ? `${PRODUCTION_DB_NAME}-uat` : PRODUCTION_DB_NAME;
}

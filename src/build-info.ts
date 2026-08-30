/**
 * Which build this device is actually running.
 *
 * Defined by Vite at build time (see the `define` block in vite.config.ts).
 * Under Vitest there is no define, so both fall back rather than throwing - a
 * missing build stamp must never take a test or a screen down.
 */
import { PRODUCTION_DB_NAME } from '@/data/db-name';

declare const __BUILD_ID__: string;
declare const __BUILT_AT__: string;
declare const __DB_NAME__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const BUILT_AT: string = typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : '';

/**
 * Which IndexedDB this build opens (BUG-04). Falls back to the production name
 * under Vitest, which is correct: tests that care pass an explicit name, and a
 * test run must not depend on a build-time define existing.
 */
export const DB_NAME: string =
  typeof __DB_NAME__ === 'string' ? __DB_NAME__ : PRODUCTION_DB_NAME;

/**
 * Which build this device is actually running.
 *
 * Defined by Vite at build time (see the `define` block in vite.config.ts).
 * Under Vitest there is no define, so both fall back rather than throwing - a
 * missing build stamp must never take a test or a screen down.
 */
declare const __BUILD_ID__: string;
declare const __BUILT_AT__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const BUILT_AT: string = typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : '';

/**
 * Where the cached source text lives.
 *
 * Its own module because both the fetcher and the gate need it, and
 * `fetch-care-text.ts` runs its `main()` on import - importing the paths from
 * there would start a network fetch every time the gate ran.
 */
import { join } from 'node:path';

export const CARE_DIR = 'data/care';
export const TEXT_DIR = join(CARE_DIR, 'text');

export const wikiPath = (speciesId: string) => join(TEXT_DIR, `${speciesId}.wikipedia.txt`);
export const vendorPath = (speciesId: string) => join(TEXT_DIR, `${speciesId}.vendor.txt`);

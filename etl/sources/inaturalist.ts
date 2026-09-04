/**
 * A commercially usable photograph for one species, from iNaturalist.
 *
 * Spec 058. The catalog's portrait gap is 1,166 species and 866 of them are
 * marine, which is the half Wikimedia is thin on and the vendor route only
 * reaches when a tracked shop happens to list the fish. iNaturalist covers reef
 * species densely because divers photograph them.
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE, both measured rather than assumed:
 *
 * 1. ONLY `cc0`, `cc-by`, `cc-by-sa`. CC BY-NC is the licence that removed
 *    FishBase once spec 031 rev 3 settled "assume commercial", and it is the
 *    single largest bucket in iNaturalist's fish photos - 20 of 48 in the
 *    2026-09-04 probe. It must not come back in through a different door, so
 *    the filter is applied on the request AND re-checked on each photo, because
 *    `photo_license` filters the OBSERVATION and an observation can carry a
 *    mix.
 *
 * 2. EXACT BINOMIAL, case-insensitively. `?q=` is a fuzzy search: it will hand
 *    back a congener, or a genus, for a name that does not exist. Spec 056's
 *    ingest needed the same guard after a body-text binomial matched a
 *    superseded name and quietly attributed the wrong animal's care data.
 *
 * WHY NOT `default_photo`, WHICH WOULD BE ONE CALL INSTEAD OF TWO: it is one
 * photo per taxon, chosen by the community for how well it shows the animal and
 * not for its licence. Measured over the same 65-species sample, taking it gave
 * 15.4% coverage where filtering the observation set gave 60.0% - a 4x
 * difference, and in the direction that would have killed this route.
 */
import type { Provenance, SpeciesImage } from './wikimedia';

const API = 'https://api.inaturalist.org/v1';

/**
 * Identify the caller. iNaturalist asks for this and throttles anonymous
 * traffic harder; it is also simple courtesy to a free API.
 */
const UA = {
  'User-Agent': 'Fish2Tank-portraits/1.0 (+https://github.com/leonidas47dario/Fish2tank)',
};

/** The only licences this project can use. See rule 1 above. */
export const USABLE_LICENSES = new Set(['cc0', 'cc-by', 'cc-by-sa']);

/** Human-readable, for the credit line under the picture. */
const LICENSE_LABEL: Record<string, string> = {
  cc0: 'CC0',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
};

/**
 * How many observations to look at per species.
 *
 * One is not enough: the top-voted observation can carry a photo whose own
 * licence differs from the observation's, and a habitat shot outranks a fish
 * often enough to matter. Thirty is one page and one request.
 */
const PAGE = 30;

export interface InatPhoto {
  id: number;
  url?: string;
  license_code?: string | null;
  attribution?: string;
  original_dimensions?: { width?: number; height?: number };
}

export interface InatObservation {
  id: number;
  uri?: string;
  quality_grade?: string;
  photos?: InatPhoto[];
  user?: { login?: string; name?: string | null };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Injectable, in the shape `sources/wikimedia.ts` already uses, so the tests
 * exercise the real parsing against recorded API shapes without a network call
 * and without waiting out the rate-limit pause.
 */
export interface InatOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * One request, with a bounded retry on the failures that are worth retrying.
 *
 * 429 and 5xx are the API asking for patience. A 404 is an answer.
 */
async function get<T>(url: string, o: InatOptions, attempt = 0): Promise<T | undefined> {
  const res = await (o.fetchImpl ?? fetch)(url, { headers: UA });
  if (res.ok) return (await res.json()) as T;
  const retryable = res.status === 429 || res.status >= 500;
  if (!retryable || attempt >= 2) return undefined;
  await (o.sleepImpl ?? sleep)(1000 * 2 ** attempt);
  return get<T>(url, o, attempt + 1);
}

/**
 * `square.jpg` -> `large.jpg`.
 *
 * The API returns the square thumbnail on every photo object. `build-portraits`
 * downscales to 480px wide, so a 75px square would be upscaled into mush. Only
 * the last path segment is rewritten, so a URL shaped unexpectedly is left
 * alone rather than mangled into a 404.
 */
export function largeVariant(url: string): string {
  return url.replace(/\/(square|small|medium|thumb)\.(jpe?g|png)(\?.*)?$/i, '/large.$2$3');
}

/**
 * The photographer's name for the credit line.
 *
 * `attribution` reads `(c) Jane Diver, some rights reserved (CC BY)`, which
 * already contains the licence - repeating it in the credit would read as a
 * stutter. So the name is taken from it and the licence comes from the
 * structured field. Falls back to the observer's account, then their login,
 * because a portrait with no name attached fails `isPublishable`.
 */
export function photographerFrom(photo: InatPhoto, obs: InatObservation): string | undefined {
  const m = photo.attribution?.match(/^\(c\)\s*([^,]+)/i);
  const named = m?.[1]?.trim();
  return named || obs.user?.name?.trim() || obs.user?.login?.trim() || undefined;
}

/**
 * Pick the photograph to ship from one page of observations.
 *
 * Research grade is PREFERRED, not required. Requiring it would be a stricter
 * filter than the 60% coverage figure in spec 058 was measured under, and a
 * number stops being evidence for a build the moment the build changes the
 * question. Preferring it costs nothing and means a community-confirmed
 * identification wins whenever one is available at the same licence.
 */
export function pickPhoto(
  observations: InatObservation[],
): { photo: InatPhoto; obs: InatObservation } | undefined {
  const candidates: { photo: InatPhoto; obs: InatObservation }[] = [];
  for (const obs of observations) {
    for (const photo of obs.photos ?? []) {
      // Re-checked per photo: `photo_license` filters the observation, and an
      // observation can carry photos under different licences.
      if (!photo.url || !USABLE_LICENSES.has(photo.license_code ?? '')) continue;
      candidates.push({ photo, obs });
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates.find((c) => c.obs.quality_grade === 'research') ?? candidates[0];
}

/**
 * Resolve a taxon id for a binomial, or nothing.
 *
 * Exported so the exact-match guard can be tested without a photo lookup.
 */
export async function findTaxon(
  scientificName: string,
  o: InatOptions = {},
): Promise<number | undefined> {
  const q = encodeURIComponent(scientificName);
  const body = await get<{ results?: { id: number; name: string }[] }>(
    `${API}/taxa?q=${q}&rank=species&per_page=1`, o,
  );
  const t = body?.results?.[0];
  if (!t) return undefined;
  // Rule 2. A near miss is a different animal, not a close enough one.
  if (t.name.trim().toLowerCase() !== scientificName.trim().toLowerCase()) return undefined;
  return t.id;
}

/**
 * A portrait for this species, or nothing.
 *
 * Nothing is a valid and common answer: 40% of the sampled gap species have no
 * commercially usable photograph on iNaturalist, and they stay gaps rather than
 * borrowing a congener's picture (P6).
 */
export async function fetchInaturalistPortrait(
  speciesId: string,
  scientificName: string,
  o: InatOptions = {},
): Promise<SpeciesImage | undefined> {
  const taxonId = await findTaxon(scientificName, o);
  if (taxonId === undefined) return undefined;

  await (o.sleepImpl ?? sleep)(1100); // iNaturalist asks for <= 60 requests/minute.
  const licences = [...USABLE_LICENSES].join(',');
  const body = await get<{ results?: InatObservation[] }>(
    `${API}/observations?taxon_id=${taxonId}&photo_license=${licences}`
    + `&photos=true&per_page=${PAGE}&order_by=votes`, o,
  );
  const hit = pickPhoto(body?.results ?? []);
  if (!hit) return undefined;

  const { photo, obs } = hit;
  return {
    speciesId,
    role: 'portrait',
    source: 'inaturalist',
    provenance: 'inaturalist' satisfies Provenance,
    url: largeVariant(photo.url!),
    license: LICENSE_LABEL[photo.license_code!] ?? photo.license_code!,
    artist: photographerFrom(photo, obs),
    // A page a human can open to see where the picture came from - which is
    // what `isPublishable` actually requires (spec 002).
    attributionUrl: obs.uri ?? `https://www.inaturalist.org/observations/${obs.id}`,
    width: photo.original_dimensions?.width,
    height: photo.original_dimensions?.height,
    retrievedAt: new Date().toISOString(),
  };
}

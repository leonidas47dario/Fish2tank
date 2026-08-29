/**
 * Species portraits from Wikimedia Commons.
 *
 * WHY WIKIMEDIA AND NOT STORE PHOTOS. A 图鉴 needs a canonical portrait of the
 * SPECIES, and it needs to be one we are actually allowed to publish. Store
 * product photos are neither: they depict one animal that was for sale, they
 * are the vendor's copyrighted work, and hotlinking them would both break when
 * the listing is delisted and consume someone else's bandwidth.
 *
 * Wikimedia images come with machine-readable licence and author metadata,
 * which is the whole point - an image whose licence we cannot state is an
 * image we cannot ship. Every record here carries `license`, `artist` and an
 * `attribution_url` back to the file page, and the catalog UI renders them.
 *
 * Store photos still have a place, but attached to the LISTING they depict
 * rather than promoted to the species portrait.
 */

const API = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

const USER_AGENT =
  'Fish2TankResearch/0.1 (personal aquarium field guide; +https://github.com/leonidas47dario/Fish2tank)';

/** Where a portrait came from, and therefore how it must be credited. */
export type Provenance = 'wikimedia' | 'vendor' | 'web';

export interface SpeciesImage {
  speciesId: string;
  role: 'portrait';
  source: string;
  /**
   * Which credit line the card renders. Split from `source` because `source`
   * names the fetcher and this names the rights position - a Commons file and
   * a shop's product photo need different sentences under the picture.
   */
  provenance: Provenance;
  url: string;
  license?: string;
  artist?: string;
  attributionUrl?: string;
  width?: number;
  height?: number;
  retrievedAt: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The API appends its own analytics parameters to image URLs
 * (`?utm_source=en.wikipedia.org&utm_campaign=api...`). They must go before
 * the URL is stored or used to derive a File: title - left on, the Commons
 * lookup asks for a page that does not exist and every licence comes back
 * empty.
 */
export function stripTracking(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** Commons File: title implied by an upload URL. */
export function fileNameFromUrl(url: string): string | undefined {
  const last = stripTracking(url).split('/').pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Strip the HTML Commons returns in its Artist field down to a plain name. */
export function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

interface FetchOptions {
  fetchImpl?: typeof fetch;
  delayMs?: number;
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<any> {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

/**
 * The lead image of the species' Wikipedia article, plus its Commons licence.
 *
 * Two calls, deliberately: the article gives the canonical image for the
 * species, and Commons gives the licence. Publishing the first without the
 * second would be the exact mistake this module exists to avoid.
 */
export async function fetchSpeciesPortrait(
  speciesId: string,
  scientificName: string,
  options: FetchOptions = {},
): Promise<SpeciesImage | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retrievedAt = new Date().toISOString();

  // redirects=1 is essential, not optional: most aquarium fish are filed under
  // their common name, so "Betta splendens" is a redirect to "Siamese fighting
  // fish" and resolves to no image without it.
  const page = await getJson(
    `${API}?action=query&prop=pageimages&piprop=original&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(scientificName)}`,
    fetchImpl,
  );
  const original = page?.query?.pages?.[0]?.original;
  if (!original?.source) return undefined;

  const url = stripTracking(String(original.source));
  const fileName = fileNameFromUrl(url);
  if (!fileName) return undefined;

  await sleep(options.delayMs ?? 200);

  let license: string | undefined;
  let artist: string | undefined;
  let attributionUrl: string | undefined;
  try {
    const meta = await getJson(
      `${COMMONS}?action=query&prop=imageinfo&iiprop=url|extmetadata&format=json&formatversion=2&titles=File:${encodeURIComponent(fileName)}`,
      fetchImpl,
    );
    const info = meta?.query?.pages?.[0]?.imageinfo?.[0];
    license = info?.extmetadata?.LicenseShortName?.value;
    artist = plainText(info?.extmetadata?.Artist?.value);
    attributionUrl = info?.descriptionurl;
  } catch {
    // Licence lookup failed. Fall through - the caller drops unlicensed images.
  }

  return {
    speciesId,
    role: 'portrait',
    source: 'wikimedia',
    provenance: 'wikimedia',
    url,
    license,
    artist,
    attributionUrl,
    width: original.width,
    height: original.height,
    retrievedAt,
  };
}

/**
 * Only images we can point someone at are usable.
 *
 * This used to require a licence string. Spec 002 loosened it deliberately:
 * the product owner chose to accept vendor and web photos for this personal
 * field guide, and those have no CC licence to state. What has NOT been
 * loosened is traceability - every shipped portrait must carry a provenance
 * and a URL a human can open to see where the picture came from. An image we
 * cannot account for is still an image we do not ship.
 */
export function isPublishable(image: SpeciesImage | undefined): image is SpeciesImage {
  return Boolean(image?.url && image.provenance && image.attributionUrl);
}

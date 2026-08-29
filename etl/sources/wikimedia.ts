/**
 * Species portraits from Wikimedia Commons.
 *
 * WHY WIKIMEDIA FIRST. A 图鉴 needs a canonical portrait of the SPECIES, not
 * of one animal that happened to be for sale. Wikimedia images come with
 * machine-readable licence and author metadata, which is the whole point -
 * when a stated free licence exists, it beats borrowed art, so this source is
 * tried before any vendor or web fallback. Every record here still carries
 * `license` when Commons has one, plus `artist` and an `attribution_url` back
 * to the file page, and the catalog UI renders them.
 *
 * WHY STORE PHOTOS ARE NO LONGER RULED OUT. This module used to also argue
 * that store photos hotlink a vendor's CDN and rot when the listing is
 * delisted. Neither holds: `build-portraits.ts` downloads bytes once at build
 * time and commits them, so a delisting can only break the attribution link,
 * not the image, and a single build-time fetch is not the same as hotlinking
 * on every page load. What is left is that a product photo is the vendor's
 * copyrighted work, and that objection Spec 002 answers with a decision, not
 * an argument: the product owner chose to accept vendor and web photos for
 * this personal field guide, credited honestly, to cover the species Commons
 * has no article for. See `isPublishable` below for what "credited honestly"
 * requires.
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

/**
 * Files whose extension means "photograph of the animal".
 *
 * A binomial search on Commons returns range maps (.svg), scanned type
 * descriptions (.pdf, .tif) and the occasional .ogv alongside real photos. A
 * distribution map on a catalog card is worse than an empty frame.
 */
const PHOTO_EXT = /\.(jpe?g|png)$/i;

/**
 * Titles that mean "not a portrait of the living animal".
 *
 * Extension filtering is not enough. Measured against the real candidate lists
 * for all 138 species this route covers, 23 of the first picks were a
 * radiograph, a preserved holotype, a museum mollusc shell, a botanical
 * illustration from 1915, or a ZooKeys figure plate. Seven of those had a
 * usable photograph further down the same result set, including a literal
 * "(live)" file sitting one place below an X-ray of the same fish. The other
 * sixteen have no usable candidate and are correctly dropped, falling through
 * to the subagent stage where a hard case belongs.
 *
 * Deliberately NOT matched: a bare "shell", "plate" or "map". The catalog
 * stocks snails, and rejecting every title containing "shell" costs real
 * portraits to catch museum specimens that "mollusc shell" and the collection
 * prefixes already catch. Tested both ways: the broader pattern gained one
 * recovery and risked losing live snails, so this is the tighter of the two.
 */
const NOT_A_PORTRAIT =
  /radiograph|holotype|paratype|illustration|drawing|sketch|figure|fig[._ ]\d|mollusc shell|MNHN-|RMNH\.|USNM|10\.3897|zookeys|distribution map|range map|diagram|skeleton|x-ray/i;

/** Built separately so the quoting rule can be asserted without a network. */
export function commonsSearchUrl(scientificName: string): string {
  const q = encodeURIComponent(`"${scientificName}"`);
  return `${COMMONS}?action=query&format=json&formatversion=2&generator=search` +
    `&gsrnamespace=6&gsrlimit=8&gsrsearch=${q}&prop=imageinfo&iiprop=url|size|extmetadata`;
}

/**
 * A portrait from a Commons FILE SEARCH, for species with no Wikipedia article.
 *
 * WHY THIS EXISTS. `fetchSpeciesPortrait` needs an en.wikipedia article, and
 * measured across the 382 species with no bundled portrait, only 8 have one.
 * 138 more have a Commons file that names the binomial in its page text but no
 * article to hang it off. That is 36% of the gap recoverable with one extra
 * query against the same rights-clean source.
 *
 * The quoting is load-bearing. Unquoted, the search fuzzy-matches and
 * "Pangio anguillaris" came back suggesting "panagia angularis" with no hits.
 */
export async function searchCommonsPortrait(
  speciesId: string,
  scientificName: string,
  options: FetchOptions = {},
): Promise<SpeciesImage | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retrievedAt = new Date().toISOString();

  let pages: any[];
  try {
    const res = await getJson(commonsSearchUrl(scientificName), fetchImpl);
    pages = res?.query?.pages ?? [];
  } catch (e) {
    // Never swallow this silently. It is the only network call here, and a
    // Commons outage would otherwise be indistinguishable from 138 species
    // genuinely having no photograph: the run would look like ordinary
    // coverage gaps while actually being broken.
    console.log(`  commons search failed for ${scientificName}: ${e instanceof Error ? e.message : 'error'}`);
    return undefined;
  }

  const hit = pages.find((p) => {
    const title = String(p?.title ?? '');
    return PHOTO_EXT.test(title) && !NOT_A_PORTRAIT.test(title) && p?.imageinfo?.[0]?.url;
  });
  if (!hit) return undefined;

  const info = hit.imageinfo[0];
  return {
    speciesId,
    role: 'portrait',
    source: 'wikimedia-commons-search',
    provenance: 'wikimedia',
    url: stripTracking(String(info.url)),
    license: info?.extmetadata?.LicenseShortName?.value,
    artist: plainText(info?.extmetadata?.Artist?.value),
    attributionUrl: info?.descriptionurl,
    width: info.width,
    height: info.height,
    retrievedAt,
  };
}

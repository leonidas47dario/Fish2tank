/**
 * Species portraits from vendor product listings.
 *
 * WHY THIS EXISTS, GIVEN wikimedia.ts PREFERS COMMONS. That module tries a
 * stated free licence first and this is the fallback, for species Commons has
 * no article and no usable file for. Measured, that is 18 species whose only
 * photograph anywhere is the shop's own: line-bred colour morphs and hybrids
 * with no wild-type article, the Albino Millennium Rainbowfish being the case
 * that proved the route.
 *
 * These photos are the vendor's copyrighted work and carry no licence. Spec
 * 002 records the product owner's decision to accept them for this personal
 * field guide, credited visibly on every card. That is a decision, not a
 * technicality, and this module does not pretend otherwise.
 */
import type { SpeciesImage } from './wikimedia';

const USER_AGENT =
  'Fish2TankResearch/0.1 (personal aquarium field guide; +https://github.com/leonidas47dario/Fish2tank)';

/**
 * Vendors that answer from this network, with their display names.
 *
 * predatoryfins.com is deliberately absent. It holds 79 of the 88 product URLs
 * on uncovered species, and every one is unreachable: the corporate proxy
 * returns a 503 interstitial, and headless Chromium and WebFetch fail against
 * it too. Attempting them anyway spends a minute a run to log 79 identical
 * timeouts, which buries the failures that are real.
 */
const STORES: Record<string, string> = {
  'imperialtropicals.com': 'Imperial Tropicals',
  'globalexoticquatics.com': 'Global Exoticquatics',
  'aquaticarts.com': 'Aquatic Arts',
  'www.j4flowerhorns.com': 'J4 Flowerhorns',
};

function hostOf(productUrl: string): string {
  try {
    return new URL(productUrl).hostname;
  } catch {
    return '';
  }
}

export function isReachableVendor(productUrl: string): boolean {
  return hostOf(productUrl) in STORES;
}

export function storeNameFor(productUrl: string): string {
  const host = hostOf(productUrl);
  return STORES[host] ?? host;
}

interface FetchOptions { fetchImpl?: typeof fetch }

/**
 * The listing's own photograph of the fish.
 *
 * These are Shopify stores, so `<productUrl>.json` returns the product with
 * its images. Taking images[0] was measured, not assumed: of the 26 reachable
 * product URLs on species with no portrait, 25 answered (one, an
 * aquaticarts.com listing, 503'd behind the same corporate proxy that blocks
 * predatoryfins.com) and 24 of those 25 lead with an actual photograph of the
 * fish, confirmed by opening the file rather than trusting its name. The one
 * exception is Imperial Tropicals' Black Nasty Cichlid listing, whose only
 * image is `Imperial_Tropicals_Logo_Placeholder...jpg` - the vendor never
 * uploaded a real photo, so no other index in that listing would have done
 * better. images[0] is therefore either right, or, in the one case measured
 * wrong, the only image there was to pick from.
 */
export async function fetchVendorPortrait(
  speciesId: string,
  productUrl: string,
  options: FetchOptions = {},
): Promise<SpeciesImage | undefined> {
  if (!isReachableVendor(productUrl)) return undefined;

  const fetchImpl = options.fetchImpl ?? fetch;
  const clean = productUrl.split('?')[0]!.replace(/\/$/, '');

  let body: any;
  try {
    const res = await fetchImpl(`${clean}.json`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return undefined;
    body = await res.json();
  } catch (e) {
    // Never swallow this silently. Same rule as the Commons search: a caught
    // and unlogged error is an invisible branch, and a vendor outage would
    // otherwise look identical to a species that simply has no listing photo.
    console.log(`  vendor fetch failed for ${clean}: ${e instanceof Error ? e.message : 'error'}`);
    return undefined;
  }

  const image = body?.product?.images?.[0];
  if (!image?.src) return undefined;

  return {
    speciesId,
    role: 'portrait',
    source: hostOf(productUrl),
    provenance: 'vendor',
    url: String(image.src),
    // No licence, and there never will be one. isPublishable gates on
    // attributionUrl instead, which is the product page below.
    license: undefined,
    artist: storeNameFor(productUrl),
    attributionUrl: clean,
    width: typeof image.width === 'number' ? image.width : undefined,
    height: typeof image.height === 'number' ? image.height : undefined,
    retrievedAt: new Date().toISOString(),
  };
}

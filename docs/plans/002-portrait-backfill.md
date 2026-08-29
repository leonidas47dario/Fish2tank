# Portrait Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle a portrait for as many of the 382 uncovered catalog species as can be sourced, labelling every non-Wikimedia photo with its real provenance.

**Architecture:** Three stages. A script resolves the 164 mechanically-findable cases (Wikipedia lead image, Commons file search, vendor product JSON). Subagents propose photos for the ~218 residual, writing JSONL. A gate script downloads every proposal from this machine and rejects anything that is not a usable image before a byte ships. Provenance (`wikimedia` | `vendor` | `web`) is threaded from the image record through DuckDB into the catalog mart and the UI credit line.

**Tech Stack:** TypeScript, `tsx` for ETL entrypoints, Vitest (globals off - import `describe`/`it`/`expect`), DuckDB (`@duckdb/node-api`) for the warehouse, Playwright Chromium for image decode and downscale, React for the UI.

**Spec:** [docs/specs/002-portrait-backfill.md](../specs/002-portrait-backfill.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `etl/surrogate-key.ts` | FNV-1a key derivation, importable without side effects | **Create** |
| `etl/sources/wikimedia.ts` | Wikimedia resolvers, provenance on `SpeciesImage` | Modify |
| `etl/sources/wikimedia.test.ts` | Unit tests for the above | Modify |
| `etl/sources/vendor.ts` | Shopify product JSON to `SpeciesImage` | **Create** |
| `etl/sources/vendor.test.ts` | Unit tests for the above | **Create** |
| `etl/images-jsonl.ts` | Read/write/merge `images.jsonl`, one row shape in one place | **Create** |
| `etl/images-jsonl.test.ts` | Unit tests for the above | **Create** |
| `etl/build-images.ts` | Stage 1 orchestration, gap-fill | Modify |
| `etl/proposal-gate.ts` | Pure validation rules for a proposal | **Create** |
| `etl/proposal-gate.test.ts` | Unit tests for the above | **Create** |
| `etl/ingest-proposals.ts` | Stage 3 entrypoint: download, gate, split accept/review | **Create** |
| `etl/build-portraits.ts` | Bundle test changes from `license` to `attribution_url` | Modify |
| `etl/build-warehouse.ts` | `provenance` column on `dim_image` | Modify |
| `etl/build-marts.ts` | `provenance` into the mart, drop the licence-only filter | Modify |
| `src/data/catalog.ts` | `CatalogPortrait.provenance`, nullable `license`, `portraitCredit` | Modify |
| `src/data/catalog.test.ts` | `portraitCredit` tests | Modify or create |
| `src/ui/screens/SpeciesDetail.tsx` | Credit line per provenance | Modify |
| `src/ui/screens/Catalog.tsx` | Footer wording | Modify |

`etl/images-jsonl.ts` and `etl/proposal-gate.ts` exist so the row shape and the
gate rules are testable without network or DuckDB. Everything network-touching
stays in the entrypoints, which is the split the existing ETL already uses.

---

## Task 0: Stop `npm run images` from rebuilding the warehouse on import

**A pre-existing bug, fixed first because this plan makes it worse.**

`etl/build-warehouse.ts:244` calls `main()` at module scope. `etl/build-images.ts:11`
imports `surrogateKey` from it, so **importing the helper runs the entire
warehouse build**. That build throws immediately (`data/market/listings.jsonl`
is gitignored and absent), the `.catch` sets `process.exitCode = 1`, and
`npm run images` therefore exits non-zero on every run whether it worked or
not. Verified:

```
$ npx tsx -e "import('./etl/build-warehouse.ts').then(m => setTimeout(()=>console.log('exitCode', process.exitCode),1500))"
Error: data/market/listings.jsonl not found - run "npm run etl" first.
    at main (etl/build-warehouse.ts:51:11)
    at <anonymous> (etl/build-warehouse.ts:244:1)
exitCode 1
```

An exit code that is 1 on success is a status field that lies, and it would be
inherited by all three new modules in this plan.

**Files:**
- Create: `etl/surrogate-key.ts`
- Modify: `etl/build-warehouse.ts:21-31` (move the function out, import it back), `etl/build-images.ts:11`

- [ ] **Step 1: Reproduce the bug**

Run: `PORTRAIT_LIMIT=0 npx tsx etl/build-images.ts; echo "exit=$?"`
Expected: the warehouse error text appears, and `exit=1` despite the image step
having nothing to do and failing at nothing.

- [ ] **Step 2: Create the side-effect-free module**

Create `etl/surrogate-key.ts` by moving the function verbatim out of
`build-warehouse.ts`:

```ts
/**
 * Stable surrogate keys for the warehouse.
 *
 * Lives in its own module because build-warehouse.ts calls main() at module
 * scope, so importing anything from it runs a full warehouse build. That made
 * `npm run images` exit 1 on every run: the import triggered a build, the
 * build threw on a gitignored input file, and the exit code reported a failure
 * the image step never had.
 */

/** FNV-1a 64-bit. Stable across machines and runs, unlike an autoincrement. */
export function surrogateKey(...parts: Array<string | number>): bigint {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of Buffer.from(parts.join('|'), 'utf8')) {
    h = ((h ^ BigInt(byte)) * prime) & mask;
  }
  // Keep it inside signed BIGINT so every destination can store it.
  return h >> 1n;
}
```

- [ ] **Step 3: Rewire both callers**

In `etl/build-warehouse.ts`, delete the function body and re-export it so
nothing that already depends on the old path breaks:

```ts
export { surrogateKey } from './surrogate-key';
```

In `etl/build-images.ts:11`, change the import to:

```ts
import { surrogateKey } from './surrogate-key';
```

- [ ] **Step 4: Verify the bug is gone**

Run: `PORTRAIT_LIMIT=0 npx tsx etl/build-images.ts; echo "exit=$?"`
Expected: no warehouse error text, and `exit=0`.

Run: `npm test`
Expected: pass. The warehouse still builds correctly when run as an entrypoint,
because the re-export does not change its behaviour.

- [ ] **Step 5: Commit**

```bash
git add etl/surrogate-key.ts etl/build-warehouse.ts etl/build-images.ts
git commit -m "fix(etl): npm run images no longer builds the warehouse on import and exits 1"
```

---

## Task 1: Provenance on the image record

**Files:**
- Modify: `etl/sources/wikimedia.ts:25-36` (the `SpeciesImage` interface), `:132-143` (the return), `:146-154` (`isPublishable`)
- Test: `etl/sources/wikimedia.test.ts:48-62` (the `isPublishable` block)

- [ ] **Step 1: Write the failing test**

Replace the whole `describe('isPublishable', ...)` block in `etl/sources/wikimedia.test.ts` with:

```ts
describe('isPublishable', () => {
  const base = { speciesId: 's', role: 'portrait', retrievedAt: 'now' } as const;

  it('accepts a Wikimedia image with a stated licence', () => {
    expect(isPublishable({
      ...base, source: 'wikimedia', provenance: 'wikimedia',
      url: 'https://x/y.jpg', license: 'CC BY-SA 4.0',
      attributionUrl: 'https://commons.wikimedia.org/wiki/File:y.jpg',
    })).toBe(true);
  });

  it('accepts a vendor photo with no licence but a stated source', () => {
    // Spec 002: the test is "sourced", not "licensed". A vendor listing photo
    // has no CC licence and never will, but it has a page we can point at.
    expect(isPublishable({
      ...base, source: 'vendor', provenance: 'vendor',
      url: 'https://cdn.shopify.com/s/files/1/x/fish.jpg',
      attributionUrl: 'https://imperialtropicals.com/products/fish',
    })).toBe(true);
  });

  it('rejects an image we cannot point anyone at', () => {
    // No attribution URL means no way to answer "where did this come from",
    // which is the whole reason provenance exists.
    expect(isPublishable({
      ...base, source: 'web', provenance: 'web', url: 'https://x/y.jpg',
    })).toBe(false);
    expect(isPublishable(undefined)).toBe(false);
  });

  it('rejects an image with no url', () => {
    expect(isPublishable({
      ...base, source: 'web', provenance: 'web', url: '',
      attributionUrl: 'https://example.com/page',
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run etl/sources/wikimedia.test.ts`
Expected: FAIL. TypeScript errors on the unknown `provenance` property, and the vendor case returns `false` because the current `isPublishable` requires `license`.

- [ ] **Step 3: Write the implementation**

In `etl/sources/wikimedia.ts`, change the interface:

```ts
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
```

Note `source` widens from `'wikimedia'` to `string`, because the vendor
resolver puts a hostname there.

Replace `isPublishable` and its comment:

```ts
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
```

In `fetchSpeciesPortrait`, add `provenance: 'wikimedia',` to the returned object next to `source: 'wikimedia',`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run etl/sources/wikimedia.test.ts`
Expected: all tests in that file PASS.

Run: `npx tsc -b --noEmit`
Expected: errors remain in `build-images.ts` for the missing `provenance` field. That is Task 4's job and is expected here.

- [ ] **Step 5: Commit**

```bash
git add etl/sources/wikimedia.ts etl/sources/wikimedia.test.ts
git commit -m "feat(etl): provenance on SpeciesImage, gate on traceability not licence"
```

---

## Task 2: Commons file search resolver

The single biggest win: 138 of 382 species. `en.wikipedia` has no article, but
Commons holds a file whose page text names the binomial.

**Files:**
- Modify: `etl/sources/wikimedia.ts` (append after `fetchSpeciesPortrait`), and the import line at the top of `etl/sources/wikimedia.test.ts`
- Test: `etl/sources/wikimedia.test.ts`

- [ ] **Step 1: Write the failing test**

Change the import at the top of `etl/sources/wikimedia.test.ts` to add the two
new exports:

```ts
import {
  commonsSearchUrl, fileNameFromUrl, isPublishable, plainText,
  searchCommonsPortrait, stripTracking,
} from './wikimedia';
```

Append to the same file:

```ts
describe('commonsSearchUrl', () => {
  it('quotes the binomial', () => {
    // Unquoted, the search fuzzy-matches: "Pangio anguillaris" came back
    // suggesting "panagia angularis" and zero files.
    expect(commonsSearchUrl('Pangio anguillaris')).toContain('%22Pangio%20anguillaris%22');
  });

  it('searches the File namespace only', () => {
    expect(commonsSearchUrl('Pangio anguillaris')).toContain('gsrnamespace=6');
  });
});

describe('searchCommonsPortrait', () => {
  const page = (title: string) => ({
    title,
    imageinfo: [{
      url: `https://upload.wikimedia.org/wikipedia/commons/a/b/${title.replace('File:', '')}`,
      descriptionurl: `https://commons.wikimedia.org/wiki/${title}`,
      width: 1200,
      height: 800,
      extmetadata: {
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        Artist: { value: '<a href="/x">H. Zell</a>' },
      },
    }],
  });

  const stub = (pages: unknown[]) =>
    (async () => new Response(JSON.stringify({ query: { pages } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

  it('returns the first photographic file with its licence', async () => {
    const got = await searchCommonsPortrait('sp_x', 'Piabina argentea', {
      fetchImpl: stub([page('File:Piabina argentea.jpg')]),
    });
    expect(got?.provenance).toBe('wikimedia');
    expect(got?.license).toBe('CC BY-SA 4.0');
    expect(got?.artist).toBe('H. Zell');
    expect(got?.attributionUrl).toBe('https://commons.wikimedia.org/wiki/File:Piabina argentea.jpg');
  });

  it('skips non-photographic file types', async () => {
    // Commons returns range maps and PDFs against a binomial search. An SVG
    // distribution map is not a portrait of the fish.
    const got = await searchCommonsPortrait('sp_x', 'Piabina argentea', {
      fetchImpl: stub([page('File:Piabina argentea range.svg'), page('File:Piabina argentea.jpg')]),
    });
    expect(got?.url).toContain('.jpg');
  });

  it('returns undefined when the search finds nothing', async () => {
    const got = await searchCommonsPortrait('sp_x', 'Nonexistent binomial', {
      fetchImpl: (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
    });
    expect(got).toBeUndefined();
  });

  it('returns undefined rather than throwing when the API errors', async () => {
    const got = await searchCommonsPortrait('sp_x', 'Piabina argentea', {
      fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    });
    expect(got).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run etl/sources/wikimedia.test.ts`
Expected: FAIL with an import error for `commonsSearchUrl` / `searchCommonsPortrait`.

- [ ] **Step 3: Write the implementation**

Append to `etl/sources/wikimedia.ts`:

```ts
/**
 * Files whose extension means "photograph of the animal".
 *
 * A binomial search on Commons returns range maps (.svg), scanned type
 * descriptions (.pdf, .tif) and the occasional .ogv alongside real photos. A
 * distribution map on a catalog card is worse than an empty frame.
 */
const PHOTO_EXT = /\.(jpe?g|png)$/i;

/** Built separately so the quoting rule can be asserted without a network. */
export function commonsSearchUrl(scientificName: string): string {
  const q = encodeURIComponent(`"${scientificName}"`);
  return `${COMMONS}?action=query&format=json&formatversion=2&generator=search` +
    `&gsrnamespace=6&gsrlimit=8&gsrsearch=${q}&prop=imageinfo&iiprop=url|extmetadata`;
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
  } catch {
    // Search failed. The caller logs it as "no image" and moves on; a single
    // unreachable query must not take the whole run down.
    return undefined;
  }

  const hit = pages.find((p) => PHOTO_EXT.test(String(p?.title ?? '')) && p?.imageinfo?.[0]?.url);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run etl/sources/wikimedia.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Verify against the live API**

Run:
```bash
npx tsx -e "import('./etl/sources/wikimedia.ts').then(async m => console.log(await m.searchCommonsPortrait('sp_x','Piabina argentea')))"
```
Expected: an object with a real `upload.wikimedia.org` URL and a licence string.
This is the one step a stub cannot cover. If it returns `undefined`, the query
shape is wrong and no unit test will tell you.

- [ ] **Step 6: Commit**

```bash
git add etl/sources/wikimedia.ts etl/sources/wikimedia.test.ts
git commit -m "feat(etl): resolve portraits by Commons file search, covering 138 species with no article"
```

---

## Task 3: Vendor product JSON resolver

**Files:**
- Create: `etl/sources/vendor.ts`
- Test: `etl/sources/vendor.test.ts`

Verified live: `https://imperialtropicals.com/products/albino-millenium-rainbowfish-glossolepis-pseudoincisus.json`
returns `product.images[]` with a 2048x1365 photograph.

- [ ] **Step 1: Write the failing test**

Create `etl/sources/vendor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fetchVendorPortrait, isReachableVendor, storeNameFor } from './vendor';

const productJson = {
  product: {
    title: 'Albino Millennium Rainbowfish',
    images: [
      { src: 'https://cdn.shopify.com/s/files/1/x/Albino_Millennium_Male.jpg?v=1', width: 2048, height: 1365 },
      { src: 'https://cdn.shopify.com/s/files/1/x/Albino_Millennium_Female.jpg', width: 2048, height: 1366 },
    ],
  },
};

const stub = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;

describe('isReachableVendor', () => {
  it('accepts hosts that respond from this network', () => {
    expect(isReachableVendor('https://imperialtropicals.com/products/x')).toBe(true);
  });

  it('rejects predatoryfins, which the corporate proxy 503s', () => {
    // 79 of the 88 product URLs on uncovered species point here. Attempting
    // them wastes a minute per run and logs 79 identical failures.
    expect(isReachableVendor('https://www.predatoryfins.com/products/x')).toBe(false);
  });

  it('rejects a malformed url rather than throwing', () => {
    expect(isReachableVendor('not a url')).toBe(false);
  });
});

describe('storeNameFor', () => {
  it('gives a human-readable credit name', () => {
    expect(storeNameFor('https://imperialtropicals.com/products/x')).toBe('Imperial Tropicals');
  });

  it('falls back to the hostname for an unmapped store', () => {
    expect(storeNameFor('https://example-fish.com/products/x')).toBe('example-fish.com');
  });
});

describe('fetchVendorPortrait', () => {
  it('takes the first product image, credited to the store', async () => {
    const got = await fetchVendorPortrait(
      'sp_glossolepis_pseudoincisus',
      'https://imperialtropicals.com/products/albino-millenium-rainbowfish',
      { fetchImpl: stub(productJson) },
    );
    expect(got?.url).toBe('https://cdn.shopify.com/s/files/1/x/Albino_Millennium_Male.jpg?v=1');
    expect(got?.provenance).toBe('vendor');
    expect(got?.license).toBeUndefined();
    expect(got?.artist).toBe('Imperial Tropicals');
    expect(got?.attributionUrl)
      .toBe('https://imperialtropicals.com/products/albino-millenium-rainbowfish');
    expect(got?.width).toBe(2048);
  });

  it('returns undefined for a product with no images', async () => {
    const got = await fetchVendorPortrait('sp_x', 'https://imperialtropicals.com/products/y',
      { fetchImpl: stub({ product: { title: 'y', images: [] } }) });
    expect(got).toBeUndefined();
  });

  it('returns undefined for a delisted product', async () => {
    const got = await fetchVendorPortrait('sp_x', 'https://imperialtropicals.com/products/gone',
      { fetchImpl: stub({}, 404) });
    expect(got).toBeUndefined();
  });

  it('does not attempt an unreachable host', async () => {
    let called = false;
    const spy = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    const got = await fetchVendorPortrait('sp_x', 'https://www.predatoryfins.com/products/z',
      { fetchImpl: spy });
    expect(got).toBeUndefined();
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run etl/sources/vendor.test.ts`
Expected: FAIL, cannot resolve `./vendor`.

- [ ] **Step 3: Write the implementation**

Create `etl/sources/vendor.ts`:

```ts
/**
 * Species portraits from vendor product listings.
 *
 * WHY THIS EXISTS, GIVEN wikimedia.ts ARGUES AGAINST IT. That module's header
 * rejects store photos on three grounds. Two are answered by how this pipeline
 * already works: the bytes are downloaded once and committed, so a delisting
 * cannot break the image (only its attribution link), and one build-time fetch
 * is not hotlinking someone's CDN on every page load.
 *
 * The third, copyright, is not answered. Spec 002 records the product owner's
 * decision to accept vendor photos for this personal field guide, with visible
 * attribution on every card. That is a decision, not a technicality, and this
 * module does not pretend otherwise.
 *
 * What it buys: 18 species that Wikimedia will never cover, because they are
 * line-bred colour morphs and hybrids with no wild-type article - the Albino
 * Millennium Rainbowfish being the case that proved the route.
 */
import type { SpeciesImage } from './wikimedia';

const USER_AGENT =
  'Fish2TankResearch/0.1 (personal aquarium field guide; +https://github.com/leonidas47dario/Fish2tank)';

/**
 * Vendors that answer from this network, with their display names.
 *
 * predatoryfins.com is deliberately absent. It holds 79 of the 88 product URLs
 * on uncovered species, and every one of them is unreachable: DRW's Menlo
 * Security proxy returns a 503 interstitial, and headless Chromium and
 * WebFetch fail against it too. Attempting them anyway spends a minute a run
 * to log 79 identical timeouts, which buries the failures that are real.
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
 * its images. The first image is the one the store chose to lead with, which
 * is the closest thing a listing has to a considered portrait.
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
  } catch {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run etl/sources/vendor.test.ts`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Verify against the live vendor**

Run:
```bash
npx tsx -e "import('./etl/sources/vendor.ts').then(async m => console.log(await m.fetchVendorPortrait('sp_glossolepis_pseudoincisus','https://imperialtropicals.com/products/albino-millenium-rainbowfish-glossolepis-pseudoincisus')))"
```
Expected: a `cdn.shopify.com` URL, `provenance: 'vendor'`, `artist: 'Imperial Tropicals'`, width 2048.

- [ ] **Step 6: Commit**

```bash
git add etl/sources/vendor.ts etl/sources/vendor.test.ts
git commit -m "feat(etl): source portraits from vendor listings for morphs Wikimedia will never cover"
```

---

## Task 4: images.jsonl as a module, and gap-fill

`build-images.ts` currently rebuilds the whole file, so re-running it re-fetches
700 images it already has. Gap-fill makes it idempotent and cheap.

**Files:**
- Create: `etl/images-jsonl.ts`, `etl/images-jsonl.test.ts`
- Modify: `etl/build-images.ts`

- [ ] **Step 1: Write the failing test**

Create `etl/images-jsonl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeRows, toRow, type ImageRow } from './images-jsonl';

const row = (species_id: string, url: string): ImageRow => ({
  image_key: '1', species_id, role: 'portrait', source: 'wikimedia',
  provenance: 'wikimedia', url, license: 'CC0', artist: null,
  attribution_url: 'https://commons.wikimedia.org/wiki/File:x.jpg',
  width: 800, height: 600, retrieved_at: '2026-08-29T00:00:00.000Z',
});

describe('toRow', () => {
  it('flattens a SpeciesImage into the jsonl shape, nulling absent fields', () => {
    const out = toRow({
      speciesId: 'sp_x', role: 'portrait', source: 'imperialtropicals.com',
      provenance: 'vendor', url: 'https://cdn.shopify.com/a.jpg',
      artist: 'Imperial Tropicals', attributionUrl: 'https://imperialtropicals.com/products/x',
      retrievedAt: '2026-08-29T00:00:00.000Z',
    });
    expect(out.license).toBeNull();
    expect(out.width).toBeNull();
    expect(out.provenance).toBe('vendor');
    expect(out.image_key).toMatch(/^\d+$/);
  });
});

describe('mergeRows', () => {
  it('keeps existing rows and appends new species', () => {
    const merged = mergeRows([row('sp_a', 'https://x/a.jpg')], [row('sp_b', 'https://x/b.jpg')]);
    expect(merged.map((r) => r.species_id)).toEqual(['sp_a', 'sp_b']);
  });

  it('lets a new row replace an existing one for the same species', () => {
    // Re-running after a manual fix must not leave the old row behind, or
    // build-marts picks the widest of the two and the fix does nothing.
    const merged = mergeRows([row('sp_a', 'https://x/old.jpg')], [row('sp_a', 'https://x/new.jpg')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.url).toBe('https://x/new.jpg');
  });

  it('drops rows for species no longer in the catalog when given a keep-set', () => {
    const merged = mergeRows(
      [row('sp_a', 'https://x/a.jpg'), row('sp_gone', 'https://x/g.jpg')],
      [],
      new Set(['sp_a']),
    );
    expect(merged.map((r) => r.species_id)).toEqual(['sp_a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run etl/images-jsonl.test.ts`
Expected: FAIL, cannot resolve `./images-jsonl`.

- [ ] **Step 3: Write the implementation**

Create `etl/images-jsonl.ts`:

```ts
/**
 * The on-disk shape of data/market/images.jsonl, in one place.
 *
 * It was inline in build-images.ts (writer) and build-portraits.ts (reader),
 * which is two definitions of one contract. Adding `provenance` to both by
 * hand is exactly how they drift.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Provenance, SpeciesImage } from './sources/wikimedia';
// From surrogate-key.ts, NOT build-warehouse.ts: that module calls main() at
// import time, which is the bug Task 0 fixed. Do not reintroduce it here.
import { surrogateKey } from './surrogate-key';

export const IMAGES_PATH = 'data/market/images.jsonl';

export interface ImageRow {
  image_key: string;
  species_id: string;
  role: string;
  source: string;
  provenance: Provenance;
  url: string;
  license: string | null;
  artist: string | null;
  attribution_url: string | null;
  width: number | null;
  height: number | null;
  retrieved_at: string;
}

export function toRow(image: SpeciesImage): ImageRow {
  return {
    image_key: surrogateKey(image.url).toString(),
    species_id: image.speciesId,
    role: image.role,
    source: image.source,
    provenance: image.provenance,
    url: image.url,
    license: image.license ?? null,
    artist: image.artist ?? null,
    attribution_url: image.attributionUrl ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    retrieved_at: image.retrievedAt,
  };
}

export function readRows(path = IMAGES_PATH): ImageRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as ImageRow)
    // Rows written before spec 002 have no provenance. They are all Wikimedia
    // by construction, since that was the only route that existed.
    .map((r) => ({ ...r, provenance: r.provenance ?? 'wikimedia' }));
}

export function writeRows(rows: ImageRow[], path = IMAGES_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/**
 * Existing rows plus new ones, newest winning per species.
 *
 * `keep` drops rows whose species has left the catalog. Passing it is optional
 * because a gap-fill run that cannot read the catalog should not silently
 * delete history.
 */
export function mergeRows(existing: ImageRow[], fresh: ImageRow[], keep?: Set<string>): ImageRow[] {
  const by = new Map<string, ImageRow>();
  for (const r of existing) by.set(r.species_id, r);
  for (const r of fresh) by.set(r.species_id, r);
  const out = [...by.values()];
  return keep ? out.filter((r) => keep.has(r.species_id)) : out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run etl/images-jsonl.test.ts`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Rewrite build-images.ts to gap-fill**

Replace the imports at the top of `etl/build-images.ts` (keeping the file's
header comment) with:

```ts
import { readFileSync, existsSync } from 'node:fs';
import {
  fetchSpeciesPortrait, searchCommonsPortrait, isPublishable, type SpeciesImage,
} from './sources/wikimedia';
import { fetchVendorPortrait } from './sources/vendor';
import { IMAGES_PATH, mergeRows, readRows, toRow, writeRows } from './images-jsonl';
```

The old `surrogateKey`, `mkdirSync` and `writeFileSync` imports and the `OUT`
constant are all deleted; `images-jsonl.ts` owns those now. Keep `CATALOG` and
`MARKET`.

Then replace everything from the `LIMIT` constant to the end of the file with:

```ts
const LIMIT = Number(process.env.PORTRAIT_LIMIT ?? Number.POSITIVE_INFINITY);

interface CatalogRow { speciesId: string; commonName: string; scientificName?: string }

/**
 * Species that still need a picture, most-listed first.
 *
 * Gap-fill, not rebuild. This used to re-fetch all 700 rows it already had on
 * every run, which made a re-run cost ten minutes of Wikimedia calls to change
 * nothing. Now it attempts only species with no row, so the step is idempotent
 * and safe to run after every catalog change.
 */
function targets(have: Set<string>): CatalogRow[] {
  if (!existsSync(CATALOG)) {
    throw new Error(`${CATALOG} not found - run "npm run marts" first.`);
  }
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as { species: CatalogRow[] };
  const market = existsSync(MARKET)
    ? (JSON.parse(readFileSync(MARKET, 'utf8')) as { species: Record<string, { totalListings: number }> })
    : { species: {} };

  return catalog.species
    .filter((s) => s.scientificName)
    .filter((s) => !have.has(s.speciesId))
    .sort((a, b) =>
      (market.species[b.speciesId]?.totalListings ?? 0) - (market.species[a.speciesId]?.totalListings ?? 0) ||
      a.commonName.localeCompare(b.commonName))
    .slice(0, LIMIT);
}

/** Product URLs on record for a species, in-stock listings first. */
function productUrls(speciesId: string): string[] {
  if (!existsSync(MARKET)) return [];
  const market = JSON.parse(readFileSync(MARKET, 'utf8')) as {
    species: Record<string, { stores?: { productUrl?: string; productInStock?: boolean }[] }>;
  };
  return (market.species[speciesId]?.stores ?? [])
    .filter((s) => s.productUrl)
    .sort((a, b) => Number(b.productInStock ?? false) - Number(a.productInStock ?? false))
    .map((s) => s.productUrl!);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Routes in preference order.
 *
 * Wikipedia first, then Commons search, then the shop. A stated free licence
 * beats borrowed art whenever both exist, so the order is the policy.
 */
async function resolve(species: CatalogRow): Promise<{ image: SpeciesImage; via: string } | undefined> {
  const article = await fetchSpeciesPortrait(species.speciesId, species.scientificName!);
  if (isPublishable(article)) return { image: article, via: 'article' };

  await sleep(200);
  const commons = await searchCommonsPortrait(species.speciesId, species.scientificName!);
  if (isPublishable(commons)) return { image: commons, via: 'commons' };

  for (const url of productUrls(species.speciesId)) {
    await sleep(200);
    const vendor = await fetchVendorPortrait(species.speciesId, url);
    if (isPublishable(vendor)) return { image: vendor, via: 'vendor' };
  }
  return undefined;
}

async function main() {
  const existing = readRows();
  const have = new Set(existing.map((r) => r.species_id));
  const wanted = targets(have);

  console.log(`  ${have.size} species already have an image row`);
  console.log(`  attempting ${wanted.length} without one\n`);

  const found: SpeciesImage[] = [];
  const byRoute: Record<string, number> = { article: 0, commons: 0, vendor: 0 };
  const missing: string[] = [];

  for (const species of wanted) {
    process.stdout.write(`  ${species.commonName.slice(0, 26).padEnd(26)}`);
    try {
      const hit = await resolve(species);
      if (hit) {
        found.push(hit.image);
        byRoute[hit.via] = (byRoute[hit.via] ?? 0) + 1;
        console.log(`ok  via ${hit.via}  ${hit.image.license ?? hit.image.provenance}`);
      } else {
        missing.push(species.commonName);
        console.log('no image on any route');
      }
    } catch (e) {
      missing.push(species.commonName);
      console.log(`failed (${e instanceof Error ? e.message : 'error'})`);
    }
    await sleep(300);
  }

  const merged = mergeRows(existing, found.map(toRow));
  writeRows(merged);

  console.log('\n─── images ───');
  console.log(`  attempted           ${wanted.length}`);
  console.log(`  resolved            ${found.length}  ${JSON.stringify(byRoute)}`);
  console.log(`  still uncovered     ${missing.length}`);
  console.log(`  rows in ${IMAGES_PATH}  ${merged.length}`);
  if (found.length === 0 && wanted.length > 0) {
    console.log('  WARNING: attempted species but resolved none - check network and API shapes.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Verify the gap-fill claim, before running it for real**

Run: `PORTRAIT_LIMIT=0 npx tsx etl/build-images.ts`
Expected: `700 species already have an image row`, `attempting 0 without one`,
`rows in data/market/images.jsonl  700`.

Run: `git diff --stat data/market/images.jsonl`
Expected: no output. A gap-fill that rewrites the file on a no-op run is not a
gap-fill. If this shows a diff, `readRows`/`writeRows` are not round-tripping
and the field order or the trailing newline is wrong.

- [ ] **Step 7: Commit**

```bash
git add etl/images-jsonl.ts etl/images-jsonl.test.ts etl/build-images.ts
git commit -m "refactor(etl): images.jsonl in one module, and make npm run images idempotent gap-fill"
```

---

## Task 5: Run Stage 1 and report

No new code. This is the checkpoint spec acceptance criterion 2 names.

- [ ] **Step 1: Run the real fetch**

Run: `npx tsx etl/build-images.ts 2>&1 | tee /tmp/stage1.log`
Expected: roughly 20 minutes for 382 species. The summary should show
`resolved` near 164 with a route breakdown near `{"article":8,"commons":138,"vendor":18}`.

- [ ] **Step 2: Check the result against the spec's prediction**

Create `/tmp/check-stage1.mjs`:

```js
import { readFileSync } from 'node:fs';
const rows = readFileSync('data/market/images.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const catalog = JSON.parse(readFileSync('src/data/seed/marts/catalog.json', 'utf8'));
const by = rows.reduce((a, r) => { const k = r.provenance ?? 'wikimedia'; a[k] = (a[k] ?? 0) + 1; return a; }, {});
console.log('rows', rows.length, 'of', catalog.species.length, 'species');
console.log('by provenance', JSON.stringify(by));
```

Run: `node /tmp/check-stage1.mjs`
Expected: roughly 864 rows of 1,076. If `resolved` came in materially under
150, stop and diagnose the route that underperformed rather than proceeding to
subagents on a wrong residual.

- [ ] **Step 3: Commit the data**

```bash
git add data/market/images.jsonl
git commit -m "data: stage 1 portrait backfill, +164 image rows from article/commons/vendor routes"
```

---

## Task 6: The proposal gate, as pure rules

**Files:**
- Create: `etl/proposal-gate.ts`, `etl/proposal-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `etl/proposal-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MIN_LONG_EDGE, checkProposal, type Downloaded, type Proposal } from './proposal-gate';

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  species_id: 'sp_x',
  url: 'https://example.com/fish.jpg',
  provenance: 'web',
  license: null,
  artist: 'Someone',
  attribution_url: 'https://example.com/page',
  confidence: 'high',
  reason: 'Caption names the binomial and the fish matches the described markings.',
  corrected_scientific_name: null,
  ...over,
});

const ok: Downloaded = { contentType: 'image/jpeg', width: 1200, height: 800, bytes: 240_000 };

describe('checkProposal', () => {
  it('accepts a well-formed high-confidence proposal', () => {
    expect(checkProposal(proposal(), ok, new Set())).toEqual({ verdict: 'accept' });
  });

  it('reviews a low-confidence proposal instead of shipping it', () => {
    const r = checkProposal(proposal({ confidence: 'low' }), ok, new Set());
    expect(r.verdict).toBe('review');
  });

  it('rejects a proposal with no url', () => {
    const r = checkProposal(proposal({ url: null }), null, new Set());
    expect(r).toEqual({ verdict: 'reject', reason: 'no url proposed' });
  });

  it('rejects a url that would not download', () => {
    const r = checkProposal(proposal(), null, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain('download failed');
  });

  it('rejects a non-image content type', () => {
    // A subagent handing back an HTML page URL is the commonest failure, and
    // it looks exactly like a working proposal until you fetch it.
    const r = checkProposal(proposal(), { ...ok, contentType: 'text/html' }, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain('text/html');
  });

  it('rejects an image too small to beat the silhouette', () => {
    const r = checkProposal(proposal(), { ...ok, width: 320, height: 240 }, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain(String(MIN_LONG_EDGE));
  });

  it('rejects a duplicate of an image already claimed by another species', () => {
    // Two species resolving to one photo means at least one is wrong, and
    // shipping both would put the same fish on two different cards.
    const r = checkProposal(proposal(), ok, new Set(['https://example.com/fish.jpg']));
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain('duplicate');
  });

  it('rejects a proposal with no attribution url', () => {
    const r = checkProposal(proposal({ attribution_url: null }), ok, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.verdict === 'reject' && r.reason).toContain('attribution');
  });

  it('reviews a proposal whose reason is too thin to audit', () => {
    // "reason" is the field a human reads when checking a doubtful call. Two
    // words are not evidence.
    const r = checkProposal(proposal({ reason: 'looks right' }), ok, new Set());
    expect(r.verdict).toBe('review');
    expect(r.verdict === 'review' && r.reason).toContain('reason');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run etl/proposal-gate.test.ts`
Expected: FAIL, cannot resolve `./proposal-gate`.

- [ ] **Step 3: Write the implementation**

Create `etl/proposal-gate.ts`:

```ts
/**
 * The boundary between "a subagent claimed this" and "this ships".
 *
 * Pure, so every rule is testable without a network. The download itself lives
 * in ingest-proposals.ts; this decides what to do with the result.
 *
 * These rules catch technical failures and self-contradictions. They cannot
 * catch a confident, well-argued mistake about which Hypancistrus is in the
 * photo. That is what `confidence` and the review file are for, and spec 002
 * records the residual risk rather than claiming the gate closes it.
 */
import type { Provenance } from './sources/wikimedia';

/**
 * Portraits render into a 480px-wide card. An image under this is upscaled,
 * and a blurry upscale looks worse than the silhouette it replaced.
 */
export const MIN_LONG_EDGE = 400;

/** A reason shorter than this is not evidence, it is a shrug. */
const MIN_REASON_CHARS = 25;

export interface Proposal {
  species_id: string;
  url: string | null;
  provenance: Provenance;
  license: string | null;
  artist: string | null;
  attribution_url: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  corrected_scientific_name: string | null;
}

export interface Downloaded {
  contentType: string;
  width: number;
  height: number;
  bytes: number;
}

export type Verdict =
  | { verdict: 'accept' }
  | { verdict: 'review'; reason: string }
  | { verdict: 'reject'; reason: string };

export function checkProposal(
  p: Proposal,
  got: Downloaded | null,
  claimedUrls: Set<string>,
): Verdict {
  if (!p.url) return { verdict: 'reject', reason: 'no url proposed' };
  if (!p.attribution_url) {
    return { verdict: 'reject', reason: 'no attribution url, so the source cannot be stated' };
  }
  if (!got) return { verdict: 'reject', reason: `download failed for ${p.url}` };
  if (!got.contentType.startsWith('image/')) {
    return { verdict: 'reject', reason: `content type is ${got.contentType}, not an image` };
  }
  const longEdge = Math.max(got.width, got.height);
  if (longEdge < MIN_LONG_EDGE) {
    return { verdict: 'reject', reason: `long edge ${longEdge}px is under ${MIN_LONG_EDGE}px` };
  }
  if (claimedUrls.has(p.url)) {
    return { verdict: 'reject', reason: `duplicate: another species already claims ${p.url}` };
  }
  if (p.confidence === 'low') {
    return { verdict: 'review', reason: `low confidence: ${p.reason}` };
  }
  if (p.reason.trim().length < MIN_REASON_CHARS) {
    return { verdict: 'review', reason: `reason too thin to audit: "${p.reason}"` };
  }
  return { verdict: 'accept' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run etl/proposal-gate.test.ts`
Expected: PASS, all 9 cases.

- [ ] **Step 5: Commit**

```bash
git add etl/proposal-gate.ts etl/proposal-gate.test.ts
git commit -m "feat(etl): proposal gate rules, with every rejection path under test"
```

---

## Task 7: The ingest entrypoint

**Files:**
- Create: `etl/ingest-proposals.ts`
- Modify: `package.json` (add the script)

- [ ] **Step 1: Write the implementation**

Create `etl/ingest-proposals.ts`:

```ts
/**
 * Turn subagent portrait proposals into shipped image rows, or into review items.
 *
 *   npm run ingest:portraits
 *
 * Reads  data/market/portrait-proposals.jsonl
 * Writes data/market/images.jsonl          (accepted, merged)
 *        data/market/portrait-review.jsonl (rejected, low-confidence, taxonomy notes)
 *
 * Every proposal is DOWNLOADED FROM THIS MACHINE before it is accepted. A URL
 * a subagent could read but the build host cannot fetch is worthless, and this
 * is where that fails fast and visibly instead of at bundle time.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { checkProposal, type Downloaded, type Proposal } from './proposal-gate';
import { IMAGES_PATH, mergeRows, readRows, toRow, writeRows } from './images-jsonl';
import type { SpeciesImage } from './sources/wikimedia';

const PROPOSALS = 'data/market/portrait-proposals.jsonl';
const REVIEW = 'data/market/portrait-review.jsonl';
const UA = 'Fish2TankResearch/0.1 (personal aquarium field guide; +https://github.com/leonidas47dario/Fish2tank)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch far enough to know it is a real image of a usable size.
 *
 * Chromium decodes it rather than a header parser, for the same reason
 * build-portraits.ts uses it: it handles every format these hosts serve,
 * including the ones a minimal library does not.
 */
async function download(url: string, page: Page): Promise<Downloaded | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.log(`\n      download -> HTTP ${res.status}`);
      return null;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!contentType.startsWith('image/')) {
      return { contentType, width: 0, height: 0, bytes: buf.length };
    }
    const dims = await page.evaluate(async ({ b64, mime }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${b64}`;
      try {
        await img.decode();
      } catch {
        return { w: 0, h: 0 };
      }
      return { w: img.naturalWidth, h: img.naturalHeight };
    }, { b64: buf.toString('base64'), mime: contentType });
    return { contentType, width: dims.w, height: dims.h, bytes: buf.length };
  } catch (e) {
    console.log(`\n      download threw: ${e instanceof Error ? e.message : 'error'}`);
    return null;
  }
}

async function main() {
  if (!existsSync(PROPOSALS)) {
    throw new Error(`${PROPOSALS} not found - the subagent stage has not run.`);
  }

  const proposals = readFileSync(PROPOSALS, 'utf8').trim().split('\n')
    .filter(Boolean).map((l) => JSON.parse(l) as Proposal);
  const existing = readRows();
  const claimed = new Set(existing.map((r) => r.url));

  console.log(`  ${proposals.length} proposals, against ${existing.length} existing image rows\n`);

  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage();

  const accepted: SpeciesImage[] = [];
  const review: object[] = [];
  const tally = { accept: 0, review: 0, reject: 0 };

  for (const p of proposals) {
    process.stdout.write(`  ${p.species_id.padEnd(34)}`);
    const got = p.url ? await download(p.url, page) : null;
    const v = checkProposal(p, got, claimed);
    tally[v.verdict] += 1;

    if (v.verdict === 'accept') {
      claimed.add(p.url!);
      accepted.push({
        speciesId: p.species_id,
        role: 'portrait',
        source: new URL(p.attribution_url!).hostname,
        provenance: p.provenance,
        url: p.url!,
        license: p.license ?? undefined,
        artist: p.artist ?? undefined,
        attributionUrl: p.attribution_url!,
        width: got!.width,
        height: got!.height,
        retrievedAt: new Date().toISOString(),
      });
      console.log(`accept  ${p.provenance}  ${got!.width}x${got!.height}`);
    } else {
      review.push({ ...p, verdict: v.verdict, gate_reason: v.reason });
      console.log(`${v.verdict}  ${v.reason}`);
    }

    // Taxonomy findings are recorded whatever the verdict. They are a separate
    // problem from the picture and must not be lost with a rejected proposal.
    if (p.corrected_scientific_name) {
      review.push({
        species_id: p.species_id,
        kind: 'taxonomy',
        corrected_scientific_name: p.corrected_scientific_name,
        gate_reason: 'proposed name correction, NOT applied - see spec 002 Scope/Out',
      });
    }
    await sleep(200);
  }

  await browser.close();

  writeRows(mergeRows(existing, accepted.map(toRow)));
  writeFileSync(REVIEW, review.map((r) => JSON.stringify(r)).join('\n') + '\n');

  console.log('\n─── ingest ───');
  console.log(`  accepted  ${tally.accept}`);
  console.log(`  review    ${tally.review}`);
  console.log(`  rejected  ${tally.reject}`);
  console.log(`  wrote ${IMAGES_PATH} and ${REVIEW}`);
  if (tally.accept === 0 && proposals.length > 0) {
    // A run that processes proposals and ships nothing must not read as success.
    console.log('\n  WARNING: every proposal was rejected. Check network reachability first.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, immediately after the `"portraits"` line:

```json
    "ingest:portraits": "tsx etl/ingest-proposals.ts",
```

- [ ] **Step 3: Demonstrate the gate rejects, on real URLs**

This is spec acceptance criterion 4, and it must be shown rather than asserted.
Write `data/market/portrait-proposals.jsonl` with these four lines (one per
line, no wrapping):

```jsonl
{"species_id":"sp_gate_deadurl","url":"https://upload.wikimedia.org/wikipedia/commons/0/00/DoesNotExist_zzz.jpg","provenance":"web","license":null,"artist":"x","attribution_url":"https://example.com/p","confidence":"high","reason":"A deliberately dead URL, to prove the gate really downloads.","corrected_scientific_name":null}
{"species_id":"sp_gate_html","url":"https://en.wikipedia.org/wiki/Fish","provenance":"web","license":null,"artist":"x","attribution_url":"https://example.com/p","confidence":"high","reason":"An HTML page, to prove the content type check works.","corrected_scientific_name":null}
{"species_id":"sp_gate_noattr","url":"https://upload.wikimedia.org/wikipedia/commons/a/a2/Guppy_pho_0048.jpg","provenance":"web","license":null,"artist":"x","attribution_url":null,"confidence":"high","reason":"No attribution URL, to prove traceability is required.","corrected_scientific_name":null}
{"species_id":"sp_gate_dupe","url":"https://upload.wikimedia.org/wikipedia/commons/a/a2/Guppy_pho_0048.jpg","provenance":"web","license":null,"artist":"x","attribution_url":"https://example.com/p","confidence":"high","reason":"Already claimed by sp_guppy, to prove duplicate detection.","corrected_scientific_name":null}
```

Run: `npm run ingest:portraits`
Expected: `accepted 0`, `rejected 4`, with four distinct reasons: HTTP 404,
`content type is text/html`, `no attribution url`, `duplicate`. Exit code 1
with the WARNING line, because a run that ships nothing must not read as green.

Run: `git diff --stat data/market/images.jsonl`
Expected: no output. Nothing was written into the real data.

- [ ] **Step 4: Clean up the fixture**

```bash
rm data/market/portrait-proposals.jsonl data/market/portrait-review.jsonl
```

- [ ] **Step 5: Commit**

```bash
git add etl/ingest-proposals.ts package.json
git commit -m "feat(etl): proposal ingest gate, verified rejecting dead/html/unattributed/duplicate urls"
```

---

## Task 8: Provenance through warehouse, marts and the app

**Files:**
- Modify: `etl/build-warehouse.ts:166-177`, `etl/build-marts.ts:41-50` `:68` `:137-212`, `etl/build-portraits.ts:78-105`, `src/data/catalog.ts:15-22` `:45-49`

- [ ] **Step 1: Add the column to dim_image**

In `etl/build-warehouse.ts`, change the `CREATE TABLE dim_image` and its `INSERT`:

```ts
  await c.run(`CREATE TABLE dim_image (
    image_key BIGINT, species_id VARCHAR, role VARCHAR, source VARCHAR,
    provenance VARCHAR, url VARCHAR,
    license VARCHAR, artist VARCHAR, attribution_url VARCHAR,
    width INTEGER, height INTEGER, retrieved_at TIMESTAMP)`);

  if (existsSync(IMAGES) && readFileSync(IMAGES, 'utf8').trim()) {
    await c.run(`INSERT INTO dim_image SELECT
      CAST(image_key AS BIGINT), species_id, role, source,
      coalesce(provenance, 'wikimedia'), url, license, artist,
      attribution_url, CAST(width AS INTEGER), CAST(height AS INTEGER),
      CAST(retrieved_at AS TIMESTAMP)
      FROM read_json_auto('${IMAGES}', format='newline_delimited')`);
  }
```

- [ ] **Step 2: Carry it into the mart, and stop filtering on licence**

In `etl/build-marts.ts`, change the `best_image` CTE (line 141):

```sql
    WITH best_image AS (
      SELECT species_id, url, provenance, license, artist, attribution_url, width, height,
             row_number() OVER (PARTITION BY species_id ORDER BY width DESC NULLS LAST) AS rn
      FROM read_parquet('${WAREHOUSE}/dim/dim_image.parquet')
      WHERE role = 'portrait' AND attribution_url IS NOT NULL
    )
```

Add `i.provenance AS img_provenance,` to the outer SELECT, next to
`i.license AS img_license,`.

Change the `CatalogEntry.portrait` type (lines 41-50) to:

```ts
  /**
   * The card's portrait, and where it came from.
   *
   * Absent when no source could be found at all - the card renders a
   * placeholder rather than pretending. `license` is present for Wikimedia
   * images and absent for vendor and web photos, which have none; see spec
   * 002 for why those are shipped and how they are credited.
   */
  portrait?: {
    url: string;
    provenance: 'wikimedia' | 'vendor' | 'web';
    license?: string;
    artist?: string;
    attributionUrl?: string;
    width?: number;
    height?: number;
  };
```

Change the mapping (lines 194-206) from `url && license` to `url && attribution`.
Add `const attribution = nn(r.img_attribution);` beside the existing
`const url = nn(r.img_url);`, delete the now-unused `const license` line, and
replace the spread with:

```ts
      // Only ship a picture we can account for. The test used to be a licence
      // string; spec 002 changed it to traceability, because vendor photos
      // have no licence and are shipped deliberately with visible credit.
      ...(url && attribution
        ? {
            portrait: {
              url,
              provenance: (nn(r.img_provenance) ?? 'wikimedia') as 'wikimedia' | 'vendor' | 'web',
              license: nn(r.img_license),
              artist: nn(r.img_artist),
              attributionUrl: attribution,
              width: num(r.img_width),
              height: num(r.img_height),
            },
          }
        : {}),
```

Bump the mart schema version: `schemaVersion: 2;` in the interface at line 68,
and `schemaVersion: 2,` in the value at line 212.

- [ ] **Step 3: Change the bundling test in build-portraits**

In `etl/build-portraits.ts`, delete the local `ImageRow` interface (lines
78-82) and import it instead:

```ts
import { readRows, type ImageRow } from './images-jsonl';
```

Replace the file-reading lines in `main()` with `const rows: ImageRow[] = readRows();`,
and change the skip test at line 104:

```ts
    // Never bundle a picture we cannot account for. This used to test for a
    // licence string. Spec 002 changed it to traceability: vendor and web
    // photos have no licence and are shipped deliberately, but every one of
    // them still has a URL a human can open to see where it came from.
    if (!row.attribution_url) continue;
```

- [ ] **Step 4: Update the app's type**

In `src/data/catalog.ts:15-22`:

```ts
export interface CatalogPortrait {
  url: string;
  /** Which credit line to render. See spec 002. */
  provenance: 'wikimedia' | 'vendor' | 'web';
  /** Present for Wikimedia images only; vendor and web photos have none. */
  license?: string;
  artist?: string;
  attributionUrl?: string;
  width?: number;
  height?: number;
}
```

- [ ] **Step 5: Rebuild and verify the chain**

Run: `npm run warehouse && npm run marts`
Expected: the marts summary reports a higher `with a portrait` percentage than before.

Run: `npx tsc -b --noEmit`
Expected: clean, except possibly `SpeciesDetail.tsx`, which Task 9 fixes.

Create `/tmp/check-provenance.mjs`:

```js
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('src/data/seed/marts/catalog.json', 'utf8'));
const withArt = c.species.filter((s) => s.portrait);
console.log('schemaVersion', c.schemaVersion);
console.log('with portrait', withArt.length, 'of', c.species.length);
console.log('missing provenance', withArt.filter((s) => !s.portrait.provenance).length);
console.log('missing attributionUrl', withArt.filter((s) => !s.portrait.attributionUrl).length);
```

Run: `node /tmp/check-provenance.mjs`
Expected: `schemaVersion 2`, and both "missing" counts **0**. That is spec
acceptance criterion 3.

- [ ] **Step 6: Commit**

```bash
git add etl/build-warehouse.ts etl/build-marts.ts etl/build-portraits.ts src/data/catalog.ts src/data/seed/marts warehouse
git commit -m "feat(etl): thread provenance to the mart, gate portraits on traceability not licence"
```

---

## Task 9: Credit line per provenance

**Files:**
- Modify: `src/data/catalog.ts` (add `portraitCredit`), `src/ui/screens/SpeciesDetail.tsx:261-272`, `src/ui/screens/Catalog.tsx:290-293`
- Test: `src/data/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/data/catalog.test.ts`, creating the file with this content if it
does not exist:

```ts
import { describe, expect, it } from 'vitest';
import { portraitCredit } from './catalog';

describe('portraitCredit', () => {
  it('credits a Wikimedia photo to its photographer and licence', () => {
    expect(portraitCredit({
      url: 'x', provenance: 'wikimedia', license: 'CC BY 3.0', artist: 'Per Harald Olsen',
    })).toBe('Per Harald Olsen, CC BY 3.0');
  });

  it('credits a Wikimedia photo with no named artist to the licence alone', () => {
    expect(portraitCredit({ url: 'x', provenance: 'wikimedia', license: 'CC0' })).toBe('CC0');
  });

  it('credits a vendor photo to the shop, and says it is a listing photo', () => {
    // No CC licence exists for these, and implying one would be a lie.
    expect(portraitCredit({
      url: 'x', provenance: 'vendor', artist: 'Imperial Tropicals',
    })).toBe('Photo: Imperial Tropicals (product listing)');
  });

  it('credits a web photo to its site', () => {
    expect(portraitCredit({
      url: 'x', provenance: 'web', artist: 'Fishbase',
    })).toBe('Photo: Fishbase');
  });

  it('says the source is unrecorded rather than inventing one', () => {
    expect(portraitCredit({ url: 'x', provenance: 'web' })).toBe('Source not recorded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/catalog.test.ts`
Expected: FAIL, `portraitCredit` is not exported from `./catalog`.

- [ ] **Step 3: Write the implementation**

Append to `src/data/catalog.ts`:

```ts
/**
 * The sentence under a portrait, which differs by where the picture came from.
 *
 * A Wikimedia file is used under a stated licence and credits its
 * photographer. A vendor listing photo has no licence at all and is used by
 * the owner's decision (spec 002), so it names the shop plainly instead of
 * borrowing the shape of a licence line. Dressing the second up as the first
 * would be the actual dishonesty here.
 */
export function portraitCredit(p: CatalogPortrait): string {
  if (p.provenance === 'wikimedia' && p.license) {
    return p.artist ? `${p.artist}, ${p.license}` : p.license;
  }
  if (p.provenance === 'vendor' && p.artist) return `Photo: ${p.artist} (product listing)`;
  if (p.artist) return `Photo: ${p.artist}`;
  return 'Source not recorded';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/catalog.test.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Wire it into the screens**

In `src/ui/screens/SpeciesDetail.tsx`, add `portraitCredit` to the existing
import from `@/data/catalog`, then replace the paragraph inside the attribution
section (lines 265-271) with:

```tsx
          <p className="small" style={{ marginBottom: 0 }}>
            <strong>{portraitCredit(species.portrait)}</strong>
            {species.portrait.attributionUrl && (
              <> — <a href={species.portrait.attributionUrl} target="_blank" rel="noreferrer">source</a></>
            )}
          </p>
```

In `src/ui/screens/Catalog.tsx`, replace the footer paragraph (lines 290-293):

```tsx
      <p className="xs muted">
        Portraits come from Wikimedia Commons under their stated licences, from vendor product
        listings, or from the open web; each card&apos;s detail page names its source. Where you
        have your own photo of a fish, it is used instead.
      </p>
```

- [ ] **Step 6: Verify in the running app**

Create `/tmp/find-one-each.mjs`:

```js
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('src/data/seed/marts/catalog.json', 'utf8'));
for (const p of ['wikimedia', 'vendor', 'web']) {
  const s = c.species.find((x) => x.portrait && x.portrait.provenance === p);
  console.log(p, s ? `${s.speciesId}  ${s.commonName}` : 'NONE YET');
}
```

Run: `node /tmp/find-one-each.mjs`, then `npm run dev` and open each species'
detail page.
Expected: three credit lines, each in its correct form. That is spec acceptance
criterion 7. (`web` will read NONE YET until Task 10 has run; check it then.)

- [ ] **Step 7: Commit**

```bash
git add src/data/catalog.ts src/data/catalog.test.ts src/ui/screens/SpeciesDetail.tsx src/ui/screens/Catalog.tsx
git commit -m "feat(ui): credit portraits by provenance, and stop claiming they are all Wikimedia"
```

---

## Task 10: Subagent sourcing, in waves

Not a code task. Roughly 218 species remain after Stage 1. Dispatch in waves of
six agents, about 12 species each, and judge wave one before spending the rest.

- [ ] **Step 1: Build the work list**

Create `/tmp/build-todo.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('src/data/seed/marts/catalog.json', 'utf8'));
const m = JSON.parse(readFileSync('src/data/seed/marts/market-index.json', 'utf8'));
const have = new Set(readFileSync('data/market/images.jsonl', 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l).species_id));
const todo = c.species.filter((s) => !have.has(s.speciesId)).map((s) => ({
  speciesId: s.speciesId,
  commonName: s.commonName,
  scientificName: s.scientificName ?? null,
  family: s.family ?? null,
  productUrls: (m.species[s.speciesId]?.stores ?? []).map((x) => x.productUrl).filter(Boolean),
}));
writeFileSync('/tmp/portrait-todo.json', JSON.stringify(todo, null, 1));
console.log(todo.length, 'species need a subagent');
```

Run: `node /tmp/build-todo.mjs`
Expected: roughly 218.

- [ ] **Step 2: Dispatch wave one, six agents of ~12 species each**

Each agent gets this brief, with its slice of `/tmp/portrait-todo.json` inlined:

> Find one good portrait photograph for each of these aquarium species. For each, work these routes in order and stop at the first that yields a usable image:
>
> 1. **Check the name first.** These names come from vendor listings and some are wrong: misspellings, or genus names superseded by a recent revision. If you find a correction, search Wikimedia Commons under the corrected name before anything else, because a free licence beats borrowed art. Two confirmed examples: `Notropsis chrosomus` is a misspelling of *Notropis chrosomus*; `Osteogaster aeneus` is the 2024 reclassification of *Corydoras aeneus*. Both have Commons photos under the correct name.
> 2. **The store listing**, if a `productUrls` entry is given. These are Shopify stores, so `<url>.json` returns `product.images`. Note that `predatoryfins.com` is unreachable and will always fail; do not retry it.
> 3. **The open web**, for anything still uncovered.
>
> Append one JSON object per species, one per line, to `data/market/portrait-proposals.jsonl`. Output nothing else.
>
> ```jsonc
> {"species_id":"sp_x","url":"https://.../photo.jpg","provenance":"wikimedia|vendor|web","license":"CC BY-SA 4.0, or null","artist":"photographer, site or shop","attribution_url":"https://page-a-human-can-open","confidence":"high|medium|low","reason":"why this image is this species","corrected_scientific_name":"corrected binomial, or null"}
> ```
>
> Rules:
> - `url` must be a **direct image URL**, not a page containing one. Verify it returns an image before proposing it.
> - `attribution_url` is required. It is the page a human opens to check the source. A proposal without one is rejected.
> - **Return `"url": null` rather than guess.** A blank card is a correct outcome. Do not propose a photo of a congener, a distribution map, a museum specimen, or an aquarium scene where the fish is incidental.
> - `reason` must state *why this image is this species*: a caption naming the binomial, a diagnostic marking, the source's own identification. "Looks like a pleco" is not a reason. This is the field a human reads when auditing a doubtful call, and anything under 25 characters is sent to review.
> - Set `confidence: "low"` whenever you are unsure. Low-confidence proposals go to a review list rather than being dropped, so flagging costs nothing and guessing costs credibility.

- [ ] **Step 3: Judge wave one before spending the rest**

Run: `npm run ingest:portraits`

Read `data/market/portrait-review.jsonl`, then spot-check five accepted
proposals by eye against the species name. If the accept rate is under half, or
any spot-check is the wrong fish, revise the brief before dispatching wave two.

- [ ] **Step 4: Dispatch remaining waves and ingest**

Repeat steps 2 and 3 until the list is exhausted. `portrait-review.jsonl` is
overwritten each run, so copy it aside between waves if you want the full
history.

- [ ] **Step 5: Commit the data**

```bash
git add data/market/images.jsonl data/market/portrait-proposals.jsonl data/market/portrait-review.jsonl
git commit -m "data: subagent-sourced portraits, with the review list of everything the gate held back"
```

---

## Task 11: Bundle, verify, ship

**Files:**
- Modify: `src/data/seed/assets/portraits/` (generated), `README.md` if it states a portrait count

- [ ] **Step 1: Record the before state**

Run: `ls src/data/seed/assets/portraits | wc -l && du -sh src/data/seed/assets/portraits`
Expected: 695 files, 9.6M. Write both numbers down; step 6 compares against them.

Run: `git show HEAD:src/data/seed/marts/catalog.json > /tmp/catalog-before.json`
This is the baseline for the regression check in step 4.

- [ ] **Step 2: Bundle**

Run: `npm run portraits`
Expected: `bundled` well above 695, `failed` small, total under 20MB.

- [ ] **Step 3: Rebuild the serving marts**

Run: `npm run warehouse && npm run marts`

- [ ] **Step 4: Verify no species lost a portrait**

This is spec acceptance criterion 6, and it must be measured, not assumed.

Create `/tmp/check-no-loss.mjs`:

```js
import { readFileSync } from 'node:fs';
const before = JSON.parse(readFileSync('/tmp/catalog-before.json', 'utf8'));
const after = JSON.parse(readFileSync('src/data/seed/marts/catalog.json', 'utf8'));
const had = new Set(before.species.filter((s) => s.portrait).map((s) => s.speciesId));
const has = new Set(after.species.filter((s) => s.portrait).map((s) => s.speciesId));
const lost = [...had].filter((id) => !has.has(id));
console.log('portraits before', had.size, '-> after', has.size);
console.log('LOST:', lost.length, lost.slice(0, 10));
if (lost.length > 0) process.exitCode = 1;
```

Run: `node /tmp/check-no-loss.mjs`
Expected: `LOST: 0` and exit code 0. Any non-zero result is a regression and
blocks the task.

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run build && npm run smoke`
Expected: all pass. Record the test count for the PR body.

- [ ] **Step 6: Report the growth**

Run: `du -sh src/data/seed/assets/portraits && ls src/data/seed/assets/portraits | wc -l`
Expected: roughly 15MB across roughly 1,050 files. This is spec acceptance
criterion 9 and goes in the PR body against the 9.6MB / 695 baseline.

If `README.md` states a portrait or species count, update it now; a stale count
there is exactly the drift spec 001 exists to stop.

- [ ] **Step 7: Commit**

```bash
git add src/data/seed/assets/portraits src/data/seed/marts warehouse README.md
git commit -m "data: bundle the backfilled portraits"
```

- [ ] **Step 8: Ship to UAT**

Push the branch, then push to `uat` and give Ryan the deployed URL to review.
Do **not** merge to `main` without his explicit sign-off; that is the delivery
loop this project uses.

---

## Notes for the implementer

**Do not apply taxonomy corrections.** Subagents will find them and they are
recorded in `portrait-review.jsonl`. Renaming a species changes its ID, which
changes the portrait filename, the market index key and the user's own
IndexedDB records. That is a separate change with a separate blast radius, and
spec 002 puts it explicitly out of scope.

**The gate exists because subagents are confidently wrong sometimes.** If you
find yourself loosening a rule in `proposal-gate.ts` to get a proposal through,
that is the gate working. Fix the proposal, not the gate.

**`data/market/` rows are committed on purpose.** They are the provenance
record. `images.jsonl` is what lets anyone answer "where did this picture come
from" a year from now, and `portrait-review.jsonl` is what lets them see what
was rejected and why.

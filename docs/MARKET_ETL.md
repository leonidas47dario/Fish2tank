# Market price ETL

Sources listed prices from twelve vendors and builds the reference data the app
ships with.

```bash
npm run etl              # fetch, normalize, index
npm run etl -- --offline # rebuild from the cached raw snapshot, no network
```

## Sources

Ten of the twelve are Shopify storefronts and expose the public
`/products.json` endpoint. Their `robots.txt` states: *"Public product,
collection, page, blog, policy, cart, and localized HTML is crawlable"*, and
none of them disallow `/products.json`. Reading that documented endpoint is
both kinder to the stores and far less brittle than parsing storefront HTML.

| Store | Host | Products (2026-08-29) |
|---|---|---|
| Global Exoticquatics | globalexoticquatics.com | 303 |
| J4 Flowerhorns | www.j4flowerhorns.com | 621 |
| Predatory Fins | www.predatoryfins.com | 943 |
| Imperial Tropicals | imperialtropicals.com | 1,396 |
| Aquatic Arts | aquaticarts.com | 1,498 |
| Aquarium Co-Op | www.aquariumcoop.com | 319 |
| Flip Aquatics | flipaquatics.com | 917 |
| AquaHuna | www.aquahuna.com | 606 |
| Nu Aqua *(Orland Park IL)* | nuaquashop.com | 936 |
| LiveAquaria | www.liveaquaria.com | 3,256 |

The client identifies itself with a contactable User-Agent, waits a second
between page requests, honours `Retry-After`, backs off on 429/5xx, and stops
at a page cap so a pagination bug cannot become a hammering loop. That client
now lives in `etl/sources/http.ts` and every source shares it, so a new vendor
cannot ship without the manners.

## The two big-box vendors

Added 2026-08-29. Neither is Shopify, so each needed its own reader — and each
was permission-checked on its own host rather than by brand. They did not give
the same answer.

### PetSmart — 254 live listings, and 8 Chicago stores

`www.petsmart.com` is readable and generous about it. Three surfaces, all ones
PetSmart maintains deliberately for machines:

| Surface | What it gives |
|---|---|
| `sitemap_index.xml` → product sitemaps | 45,336 URLs; PetSmart's own list of what it wants read |
| schema.org `Product` JSON-LD on each product page | sku, name, price, availability, image, GTIN |
| `/api/search/1/indexes/p-inventories/query` | **on-hand count per sku per store** |

That last one is the interesting one. `robots.txt` names it explicitly, for
every user agent:

```
Allow: /api/search/1/indexes/p-inventories/query?*
```

It is an Algolia-backed index keyed by sku, with a column per store. So for the
first time this dataset can answer *is this fish in a tank down the road today*
rather than only *can it be shipped to me*. Every other tracked vendor is a
specialist importer or mail order.

**What robots.txt forbids, and what that costs.** `Disallow: /*?` bans every
URL with a query string except those API paths. Category pages return 40
products at a time and paginate on `?start=`, so the cheap route — 5 category
requests instead of 254 product requests — is off limits. The crawl walks the
sitemap and reads one product page each. It is fifty times the requests, and it
is the one they said yes to.

**Scope.** The `/fish/` department is 1,544 product URLs, of which ~1,300 are
ornaments, filters, gravel and food that `isLivestock` drops the moment they
are normalized. Fetching them would be 1,300 requests at PetSmart's expense to
produce nothing, so the crawl is scoped to the live-animal aisles — live fish
and live aquatic plants, 256 URLs. `LIVE_PATH_PREFIXES` widens it in one line.

### Petco — two hosts, two different answers

Petco is one brand behind two very different doors, and the reader treats them
as separate sources that happen to share a logo.

**`stores.petco.com` is open, and read every run.** A Yext-hosted store
directory serving a `robots.txt` with **no Disallow rules at all**, pointing at
its own sitemaps (12,911 URLs), publishing each branch as schema.org `PetStore`
JSON-LD — address, geo, phone, hours, and the departments that branch operates,
*including "Aquatics Department"*. That answers a question the price data never
could: **which Chicago branches actually keep fish.** Seven of the eight do.
It is a location fact, so it lands in `dim_local_store` and never in
`fact_listing`.

**`www.petco.com` is asked every run, and so far refuses.** The storefront sits
behind a CDN bot manager that, from a datacentre IP, answers HTTP 403 to every
path — *including `/robots.txt` itself* — with a "Whoops! We can't find what
you're looking for" page carrying an error id and the caller's IP. It is not a
User-Agent check: a plain browser User-Agent gets the identical 403.

**So why is there a full Petco listings reader in the tree?** Because the block
is a property of the network, not of the code. Akamai-class bot managers
routinely refuse cloud egress while passing ordinary residential traffic, so
the same pipeline run from a laptop may be waved straight through. Hard-coding
*"Petco has no catalogue"* would bake an accident of hosting into the design.
Instead `probeStorefront()` asks on every run — one request, to `robots.txt`,
because that is the right thing to ask for first — and the outcome becomes
data:

| Probe says | Run does |
|---|---|
| robots.txt returns and permits reading | walk the sitemap, read schema.org `Product` JSON-LD, populate listings |
| robots.txt returns and disallows everything | stop. A 200 that says "no" is still a no |
| 403, or unreachable | keep the locations, record the status and reason, carry on |

The refusal is written into `market-index.json` as
`sources[].accessNote`, so a zero next to Petco in the shipped data is always
explained rather than left looking like a broken pipeline. Today it reads:

> `www.petco.com` answered HTTP 403 for /robots.txt. The CDN edge refuses
> automated clients from this network, so no crawl permission is published and
> none is assumed. Locations only this run.

**Two rules the reader will not bend.** Permission is checked *per host, not
per brand* — which is why the open directory is read and the refusing
storefront is asked rather than assumed either way. And a refusal is never
routed around: no disguised User-Agent, no proxy, no scraping a cache. If
Petco's edge says no, the answer recorded is no.

Until it says yes, the nearest honest stand-in for Petco's prices is
**LiveAquaria** — Petco's own aquatics brand, already tracked as its own vendor.

### Neither of them is Shopify, and that turned out to be the design

There is no `/products.json` here and no shared platform to lean on, so the
question was what these two *do* maintain for machines. The answer is
schema.org: every SEO-driven retailer publishes `Product` JSON-LD on its
product pages, because Google requires it to show a price in search results.
That block is deliberate, vendor-maintained, machine-facing — the same bargain
as Shopify's documented endpoint, and far more stable than markup a redesign
will change next quarter.

So `etl/sources/schema-org.ts` holds the extraction contract, and both big-box
readers share it. A third non-Shopify vendor needs a sitemap filter and a
store-number rule, not a new parser.

## Sampling Chicago

Chicago, because that is where the owner actually shops, and because the PRD's
rarity language is about Chicago encounters specifically. City-wide rather than
a hand-picked few — eight branches each is small enough to be polite and
complete enough that "no Chicago store has it" means something.

| | PetSmart | Petco |
|---|---|---|
| Chicago branches read | 8 | 8 |
| With an aquatics department | not published | 7 |
| Store/sku inventory rows | 2,032 | — |
| skus actually carried | 1,351 | — |
| sku/store pairs with stock on hand | 1,082 | — |

The busiest tanks on the day of the pull: Chicago Brickyard (3,347 animals and
plants on hand across 246 skus), South Loop (3,019), Goose Island (2,971). One
branch — Wrigleyville — reported zero across every sku, which is recorded as
zero rather than dropped.

`SAMPLED_CITY` in `etl/types.ts` moves the sample to another city in one line.

### A distinction worth the extra column

The inventory index reports `store_1658: 0` for a sku the store stocks and has
none of today, and **omits the key entirely** for one the store does not carry
at all. Those are different answers to "is it worth driving there", so they are
kept apart: `carried: true, onHand: 0` versus `carried: false, onHand: null`.
Flattening both to zero would get one of the two wrong.

## Where the history comes from

Shopify keeps sold-out products published, so a single pull captures years of
back catalogue rather than just today's stock:

- **18,443 of 24,624 listings (75%) are sold out**
- The oldest listing still published dates to **December 2013**; Predatory
  Fins' own catalogue reaches back to **May 2021**

PetSmart is the exception and is honest about it: its sitemap lists what is
currently sold, so there is no back catalogue to inherit — only the branch
counts, which are today's and only today's.

There is no separate price-history API, and the Wayback Machine has no
archived `products.json` for any of these stores — checked. So a listing's
price is the price *at the moment it was published*, frozen. That is a real
limitation and the app surfaces it: any species whose newest listing is over a
year old renders a staleness warning rather than passing off a 2021 price as
today's market.

## Pipeline

```
etl/sources/http.ts        the shared polite client: UA, delay, Retry-After, backoff
etl/sources/schema-org.ts  the extraction contract for every non-Shopify vendor
etl/sources/shopify.ts     paginated /products.json client
etl/sources/petsmart.ts    sitemap → JSON-LD → per-store inventory
etl/sources/petco.ts       open store directory + probed storefront
etl/normalize/size.ts      "4 - 4.5 inches" → 4.25in;  "Large" → unknown
etl/normalize/species.ts   title → catalog species
etl/normalize/listing.ts   Shopify product + variant → MarketListing
etl/normalize/retail.ts    non-Shopify product → MarketListing
etl/index-builder.ts       listings → per-species stats + size ladder
etl/run.ts                 orchestration, dispatching on StoreConfig.platform
```

### Outputs

| Path | What |
|---|---|
| `data/market/listings.csv` | Every normalized listing, one row per variant |
| `data/market/listings.jsonl` | Same, structure preserved |
| `data/market/local-stores.jsonl` | Sampled physical branches, one row each |
| `data/market/store-inventory.jsonl` | On-hand counts, one row per (branch, sku) |
| `src/data/seed/marts/market-index.json` | Aggregate shipped with the app |
| `etl/raw/*.json` | Raw API snapshots (gitignored, re-fetchable) |

## Three decisions that shape the data

**Unparseable sizes stay unknown.** `"Large"` is four inches on a goby and
fourteen on a bichir. Guessing a number would silently poison every median
downstream, so 74% of listings carry a real size and the rest are excluded
from price comparison rather than mis-compared.

**A big-box title names a trade, not a taxon.** A specialist writes
"Delhezi Bichir (Polypterus delhezi)"; PetSmart writes "Delhezi Bichir". So the
high-precision binomial path never fires for these vendors, and **only 12 of
PetSmart's 254 listings resolve to a species** — the rest match nothing at all.
That is the correct outcome, not a gap to paper over: the vendor never said
which species it was, and inferring one from a trade name is exactly the
mis-match that would file *Bass* under *Peacock Bass*. The listings are still
captured in full, with `speciesId` null.

The same reasoning leaves their **size unknown**. Big-box live fish are sold at
one unstated size, and the titles that *do* contain a number mean something
else — "Live Aquarium Plant for Fish Tanks - 4 in" is the pot. Nothing mines a
marketing string for its first number, so these listings are excluded from
price comparison rather than compared against a ladder they have no rung on.

**Unmatched species stay unmatched.** 886 titles carry a scientific name in
parentheses, which is the high-precision path. Beyond that, a single-word
common name only matches when the title is essentially just that word —
because `Bass` is an alias of Largemouth Bass and *Peacock Bass* is an
entirely different fish. A substring match would have filed one under the
other and corrupted both medians. There is a test named for that trap.

Currently **12,084 of 24,624 listings (49%)** resolve to a species, giving
**2,176 species** with enough listings to publish price stats. 24% of listings
carry a usable size, which is the ceiling on how many can be *size-compared*,
and the big-box vendors state no size at all.

## The size ladder

A single median is close to useless for these fish. The real Predatory Fins
jaguar cichlid ladder:

| Size | Listed |
|---|---|
| 1″ | $12 |
| 3″ | $25 |
| 5″ | $55 |
| 6″ | $85 |
| 9″ | $195 |
| 12″ | $250 |

Pooling that range gives a median of $55, which describes no actual fish. The
app compares against the band matching the size in front of you instead.

Concretely: the Panther at 6″ for $75 reads **36% above market** against the
pooled median, and **12% below** the size-matched $85. The second answer is
the true one.

## What this must never do

`FR-P05`: *"Online availability never increases collecting rarity in the MVP."*
`FR-R07` forbids objective rarity claims below a sample threshold.

Mail-order retailers measure how easy a fish is to **buy online**, which is not
how rarely you **encounter** one in a Chicago shop. Nothing in the market index
feeds the Discovery Tier, the app renders it in a separate panel, and
`index-builder.test.ts` fails if a rarity or tier field ever appears in the
index.

**The Chicago branch data does not change this.** It is tempting to read "no
Chicago PetSmart carries it" as rarity, and `fact_store_inventory` is
deliberately not wired to the tier engine. Eight branches of one chain in one
city is a fact about that chain's buying, not about how hard a fish is to find
— FR-R07's sample threshold exists for exactly this. What the branch data is
for is the opposite direction: telling you a fish **is** twenty minutes away.

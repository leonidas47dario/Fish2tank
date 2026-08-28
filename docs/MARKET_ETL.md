# Market price ETL

Sources listed prices from three Shopify storefronts and builds the reference
data the app ships with.

```bash
npm run etl              # fetch, normalize, index
npm run etl -- --offline # rebuild from the cached raw snapshot, no network
```

## Sources

| Store | Host | Listings |
|---|---|---|
| Global Exoticquatics | globalexoticquatics.com | 303 products |
| J4 Flowerhorns | www.j4flowerhorns.com | 622 products |
| Predatory Fins | www.predatoryfins.com | 943 products |

All three are Shopify and expose the public `/products.json` endpoint. Their
`robots.txt` states: *"Public product, collection, page, blog, policy, cart,
and localized HTML is crawlable"*, and none of them disallow `/products.json`.
Reading that documented endpoint is both kinder to the stores and far less
brittle than parsing storefront HTML.

The client identifies itself with a contactable User-Agent, waits a second
between page requests, honours `Retry-After`, backs off on 429/5xx, and stops
at a page cap so a pagination bug cannot become a hammering loop.

## Where the history comes from

Shopify keeps sold-out products published, so a single pull captures years of
back catalogue rather than just today's stock:

- **2,842 of 3,395 listings (84%) are sold out**
- Predatory Fins' catalogue reaches back to **May 2021**

There is no separate price-history API, and the Wayback Machine has no
archived `products.json` for any of these stores — checked. So a listing's
price is the price *at the moment it was published*, frozen. That is a real
limitation and the app surfaces it: any species whose newest listing is over a
year old renders a staleness warning rather than passing off a 2021 price as
today's market.

## Pipeline

```
etl/sources/shopify.ts     paginated, rate-limited /products.json client
etl/normalize/size.ts      "4 - 4.5 inches" → 4.25in;  "Large" → unknown
etl/normalize/species.ts   title → catalog species
etl/normalize/listing.ts   product + variant → MarketListing
etl/index-builder.ts       listings → per-species stats + size ladder
etl/run.ts                 orchestration
```

### Outputs

| Path | What |
|---|---|
| `data/market/listings.csv` | Every normalized listing, one row per variant |
| `data/market/listings.jsonl` | Same, structure preserved |
| `src/data/seed/market/market-index.json` | 36 KB aggregate shipped with the app |
| `etl/raw/*.json` | Raw API snapshots (gitignored, re-fetchable) |

## Two decisions that shape the data

**Unparseable sizes stay unknown.** `"Large"` is four inches on a goby and
fourteen on a bichir. Guessing a number would silently poison every median
downstream, so 74% of listings carry a real size and the rest are excluded
from price comparison rather than mis-compared.

**Unmatched species stay unmatched.** 886 titles carry a scientific name in
parentheses, which is the high-precision path. Beyond that, a single-word
common name only matches when the title is essentially just that word —
because `Bass` is an alias of Largemouth Bass and *Peacock Bass* is an
entirely different fish. A substring match would have filed one under the
other and corrupted both medians. There is a test named for that trap.

Currently **249 of 3,395 listings (7%)** resolve to a catalog species, giving
**22 species** with enough sized listings to publish. The rest is not lost:
the index reports the top 100 unmatched binomials, which is a ranked to-do
list for the species catalog. The biggest gaps by listing count are
*Astronotus ocellatus*, *Potamotrygon leopoldi*, *Pterophyllum scalare*,
*Phractocephalus hemioliopterus* and *Osteoglossum bicirrhosum*.

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

Three mail-order retailers measure how easy a fish is to **buy online**, which
is not how rarely you **encounter** one in a Chicago shop. Nothing in the
market index feeds the Discovery Tier, the app renders it in a separate panel,
and `index-builder.test.ts` fails if a rarity or tier field ever appears in
the index.

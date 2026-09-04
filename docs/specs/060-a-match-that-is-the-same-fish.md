# 060 — A match that is the same fish

## What was asked

> continue to work on the seriously fish feature

The care pipeline (spec 056) shipped and is in production. This is what reading
its own rejection log turned up.

## The problem, measured

`matchSlugs` has two routes. Attributing every one of spec 056's wrong-animal
rejections back to the route that proposed it:

| Slug route | Candidates | Rejected as the wrong animal |
|---|---:|---:|
| Exact | 455 | **4 (0.9%)** |
| Unique-epithet fallback | 79 | **74 (94%)** |

**The fallback is wrong 94% of the time.** It produced `Esox niger`, a pickerel,
landing on *Oxydoras niger*, a catfish; `Carassius auratus`, a goldfish, landing
on *Melanochromis auratus*, a cichlid; and `Hemibarbus longirostris` proposed for
three unrelated asks at once.

The bug is in one sentence, and the existing comment gets close enough to it to
be frustrating — it warns that "two fish sharing one epithet in different genera
is exactly the case where a guess lands on the wrong animal", then tests
uniqueness **in SF's slug set** rather than identity with our fish. "niger"
appearing exactly once on seriouslyfish.com is not evidence that the fish it
names is ours. **Uniqueness in the target set is not evidence of identity.**

Two consequences beyond the wrong matches themselves:

- **74 wasted fetches** from a small site this project otherwise paces itself
  against at 700 ms.
- **The reported figure is soft.** "534 reachable, 55.1%" is really 455 exact
  plus 79 guesses of which 5 held up; accepted coverage is 456 of 955
  addressable non-marine fish, **47.7%**.

Nothing shipped wrong, because the binomial guard caught all 74. But a matcher
that is mostly wrong, kept safe by a downstream check, is one loosened guard away
from shipping the wrong animal's care data — which is the failure P6 exists to
prevent.

## What the five successes actually were

The five epithet candidates that survived the guard are not epithet luck. Each
has a specific, nameable cause:

```
Polypterus endlicheri     -> polypterus-endlicheri-endlicheri   nominate subspecies
Fundulopanchax gardneri   -> fundulopanchax-gardneri-gardneri   nominate subspecies
Polypterus senegalus      -> polypterus-senegalus-senegalus     nominate subspecies
Axelrodia riesei          -> axelrodi-riesei                    SF's slug has a typo
Darienheros calobrensis   -> amphilophus-calobrensis            genus synonym
```

Three are one rule. **A trinomial slug whose first two parts are exactly our
binomial** requires the genus *and* the epithet to match, so it cannot cross to
another animal the way the epithet index can. The other two are single facts a
person can check, which is what the curated tables in this repo are for.

## Three expansions measured, two rejected

Written before building anything, because spec 058's lesson was that a route
probed in isolation overstates its value.

| Route | Reach | Precision |
|---|---:|---|
| **Exact trinomial** | 4 species (3 already reached, 1 new) | genus + epithet must both match |
| **Catalog's own binomial aliases** | **3 species** | 3 of 3 correct |
| **iNaturalist accepted names** | ~35 projected (3 of 60 sampled) | **1 of the 3 hits was the wrong fish** |

**iNaturalist is rejected on precision, not on yield.** In a 60-species sample it
proposed `Trichogaster lalia -> Trichogaster fasciata`: the dwarf gourami mapped
onto the banded gourami, because "lalia" is not the accepted spelling
(*T. lalius*) and the fuzzy search returned a congener. That is the same disease
as the epithet fallback with a more authoritative-looking oracle, and this spec
is about removing that disease rather than re-importing it. `Danio frankei ->
Danio rerio` and `Toxotes siamensis -> Toxotes chatareus` were both correct; one
wrong in three is still one wrong in three.

The alias route is correct but tiny, and costs nothing — it reads data the
catalog already holds, with no oracle and no network.

## What changes

1. **The unique-epithet fallback is removed** from `matchSlugs`, along with its
   `how: 'epithet'` kind and the `ambiguous` counter that only it fed.
2. **An exact trinomial rule replaces it.** `<genus>-<epithet>-*` where
   `<genus>-<epithet>` is exactly our binomial.
3. **A curated slug table**, `SF_SLUG_ALIASES`, for the cases a rule cannot
   reach: the SF typo, the genus synonym, and the three binomial aliases the
   catalog already holds. Every entry cites a source, as
   `species-overrides.ts` already requires of curated data.
4. **A curated equivalence list for the guard**, `SF_SAME_FISH`, for the two
   exact-slug rejections that are genuine taxonomy rather than a wrong page:
   `Danio rerio` ≡ `Brachydanio rerio` and `Puntius tambraparniei` ≡
   `Dawkinsia tambraparniei`. The guard stays strict for everything else,
   including the two it is right to reject — `Aphyosemion bivittatum` /
   `bitaeniatum` are different species, and SF folding *Neolamprologus
   brichardi* into *N. pulcher* is contested.

## What this costs and returns

Roughly coverage-neutral and much more precise:

```
                    candidates   accepted   precision
  before                   534        456         85%
  after (projected)       ~461       ~458        ~99%
```

−74 wrong candidates, −74 fetches from a small site, +1 new species from the
trinomial rule, +7 from the two curated tables. **This is not a coverage
feature**, and saying so plainly matters more than the arithmetic: it makes an
existing figure honest and removes a mechanism that only works because something
downstream is catching it.

## Scope

**Out:** iNaturalist synonyms (rejected above); the 426 addressable species SF
does not cover at all, which is the ceiling spec 031 rev 3 predicted — *"care
coverage is now capped by SeriouslyFish's freshwater catalog until a
commercially usable bulk source turns up"* — and remains true.

## Acceptance criteria

1. `matchSlugs` returns no match for a species whose only relation to a slug is
   a shared epithet. Driven with the real `Esox niger` / `oxydoras-niger` case.
2. A trinomial slug matches only when genus and epithet both match exactly;
   `polypterus-endlicheri-endlicheri` matches *Polypterus endlicheri* and
   nothing else.
3. Every `SF_SLUG_ALIASES` and `SF_SAME_FISH` entry cites a source, asserted by
   a test rather than by review.
4. The guard still rejects `Aphyosemion bivittatum` against a page stating
   `bitaeniatum`.
5. Re-running the ingest over the existing cache produces **zero** wrong-animal
   rejections attributable to a slug this matcher proposed.

## Requirements touched

- **P6, never invent a number** — applied to sourcing rather than rendering,
  which is the framing spec 056 already used for this guard.

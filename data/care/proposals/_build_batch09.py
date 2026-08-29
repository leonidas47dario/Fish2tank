#!/usr/bin/env python3
"""Build data/care/proposals/batch-09.jsonl, verifying every quote verbatim."""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TEXT = os.path.join(ROOT, "data", "care", "text")
OUT = os.path.join(ROOT, "data", "care", "proposals", "batch-09.jsonl")

W = "wikipedia"
V = "vendor"

_cache = {}


def body(species_id, source):
    """Return the article body (everything after the two '# ' header lines)."""
    key = (species_id, source)
    if key not in _cache:
        path = os.path.join(TEXT, f"{species_id}.{source}.txt")
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        # drop the leading '# ' header lines
        i = 0
        while i < len(lines) and lines[i].startswith("# "):
            i += 1
        _cache[key] = "\n".join(lines[i:])
    return _cache[key]


ERRORS = []


def field(species_id, source, quote, **vals):
    b = body(species_id, source)
    if quote not in b:
        ERRORS.append(f"{species_id}: quote not found in {source} body: {quote!r}")
    if len(quote) < 12:
        ERRORS.append(f"{species_id}: quote shorter than 12 chars: {quote!r}")
    d = dict(vals)
    d["quote"] = quote
    d["source"] = source
    return d


def size(species_id, source, value, quote):
    return field(species_id, source, quote, value=value)


def aggr(species_id, source, value, quote):
    assert value in ("peaceful", "semi-aggressive", "aggressive", "highly-aggressive")
    return field(species_id, source, quote, value=value)


def vol(species_id, source, value, quote):
    return field(species_id, source, quote, value=value)


def temp(species_id, source, lo, hi, quote):
    return field(species_id, source, quote, min=lo, max=hi)


rows = []


def row(species_id, adult=None, volume=None, aggression=None, temperature=None,
        confidence="high", notes=None, corrected=None):
    r = {
        "species_id": species_id,
        "adult_size_in": adult,
        "min_volume_gal": volume,
        "aggression": aggression,
        "temp_c": temperature,
        "confidence": confidence,
    }
    if notes:
        r["notes"] = notes
    if corrected:
        r["corrected_scientific_name"] = corrected
    rows.append(r)


# 1 -----------------------------------------------------------------------
s = "sp_rohanella_titteya"
row(
    s,
    adult=size(s, W, 1.97, "It reaches 5 cm in length"),
    aggression=aggr(s, W, "peaceful",
                    "The younger male is generally peaceful, but a mature male can be "
                    "aggressive when breeding"),
    temperature=temp(s, W, 22.8, 27.2, "a temperature range of 73–81 °F"),
    confidence="medium",
    notes="Sources disagree on size: Wikipedia gives 5 cm max (1.97 in); the vendor page "
          "gives an average, not maximum, of 1-1.5 in. Took the larger Wikipedia maximum. "
          "Temperature converted from 73-81 F. No tank volume stated in either source.",
)

# 2 -----------------------------------------------------------------------
s = "sp_puntius_titteya"
row(
    s,
    adult=size(s, W, 1.97, "It reaches 5 cm in length"),
    aggression=aggr(s, W, "peaceful",
                    "The younger male is generally peaceful, but a mature male can be "
                    "aggressive when breeding"),
    temperature=temp(s, W, 22.8, 27.2, "a temperature range of 73–81 °F"),
    confidence="high",
    notes="Article states the 1929 name Puntius titteya was superseded by the monospecific "
          "genus Rohanella in 2023. Temperature converted from 73-81 F.",
    corrected="Rohanella titteya",
)

# 3 -----------------------------------------------------------------------
s = "sp_gyrinocheilus_aymonieri"
row(
    s,
    adult=size(s, W, 11.0, "G. aymonieri has been recorded as reaching at least 28 cm SL"),
    confidence="high",
    notes="No aquarium temperature range, tank volume or temperament statement in the article.",
)

# 4 -----------------------------------------------------------------------
s = "sp_siniperca_chuatsi"
row(
    s,
    adult=size(s, W, 27.6, "The maximum recorded total length of 70 cm"),
    confidence="high",
    notes="The only temperatures given are feeding (>15 C) and breeding (>21 C) thresholds, "
          "not an aquarium range, so temp_c is null. Piscivory is diet, not a stated "
          "temperament, so aggression is null.",
)

# 5 -----------------------------------------------------------------------
s = "sp_stenomelania_torulosa"
row(
    s,
    confidence="high",
    notes="Correct species, but the cached article is a two-line stub covering only "
          "distribution (India) and a pollution tolerance value. No size, volume, "
          "temperature or temperament stated.",
)

# 6 -----------------------------------------------------------------------
s = "sp_pelodiscus_sinensis"
row(
    s,
    adult=size(s, W, 13.0,
               "can reach a straight-line carapace length of up to 33 cm"),
    aggression=aggr(s, W, "aggressive",
                    "Kotabe chose the species because of its aggressive nature"),
    confidence="medium",
    notes="Size is female straight-line carapace length (33 cm); males reach 27 cm. The only "
          "sentence characterising disposition is in the cultural-depictions section "
          "(Bowser design inspiration), hence medium confidence on aggression. No aquarium "
          "temperature range or tank volume given.",
)

# 7 -----------------------------------------------------------------------
s = "sp_pseudorinelepis_genibarbis"
row(
    s,
    adult=size(s, W, 14.0,
               "P. genibarbis is large and bulky and reaches a length of 35.6 cm SL"),
    aggression=aggr(s, W, "peaceful",
                    "From the viewpoint of the aquarist the fish is peaceful, sociable with "
                    "others of its own type, non-territorial and omnivorous"),
    temperature=temp(s, W, 23, 27,
                     "the temperature range may fluctuate gently between 23 and 27 °C"),
    confidence="high",
    notes="Cached page is the monospecific genus article Pseudorinelepis, which covers "
          "P. genibarbis explicitly. No tank volume stated.",
)

# 8 -----------------------------------------------------------------------
s = "sp_gymnogeophagus_lipokarenos"
row(
    s,
    confidence="high",
    notes="Correct species, but the cached article is a one-paragraph stub of diagnostic "
          "osteology and range only. No size, volume, temperature or temperament stated.",
)

# 9 -----------------------------------------------------------------------
s = "sp_amatitlania_nigrofasciata"
row(
    s,
    adult=size(s, W, 4.7,
               "The maximum standard length has been reported to be 10 centimeters, with "
               "total length near 12 cm"),
    volume=vol(s, W, 20,
               "Most experts agree that a pair of convicts should be kept in a 20-gallon "
               "aquarium or larger"),
    aggression=aggr(s, W, "aggressive",
                    "Convict cichlids are aggressively territorial during breeding and pairs "
                    "are best kept alone"),
    temperature=temp(s, W, 26, 29, "The daily water temperature ranged from 26–29 °C"),
    confidence="medium",
    notes="Size taken as total length 12 cm (max SL is 10 cm). Temperature is a measured "
          "natural-habitat range at four Costa Rican sites, not an explicit aquarium "
          "recommendation, hence medium confidence.",
)

# 10 ----------------------------------------------------------------------
s = "sp_hypselecara_temporalis"
row(
    s,
    adult=size(s, W, 11.8, "It can reach lengths of up to 30 cm"),
    temperature=temp(s, W, 25, 30,
                     "The fish lives in tropical climates, in temperatures between "
                     "25–30 °C"),
    confidence="medium",
    notes="Temperature is given as the species' climate range rather than an explicit "
          "aquarium recommendation. No volume or temperament stated.",
)

# 11 ----------------------------------------------------------------------
s = "sp_apistogramma_trifasciata"
row(
    s,
    confidence="high",
    notes="Correct species, but the cached article is a single sentence on distribution. "
          "No size, volume, temperature or temperament stated.",
)

# 12 ----------------------------------------------------------------------
s = "sp_neolamprologus_multifasciatus"
row(
    s,
    adult=size(s, W, 1.97,
               "The male reaches 5 cm in length, and the female only 2.5 cm in the aquarium"),
    temperature=temp(s, W, 23.9, 26.7, "tropical in temperature, 75–80 °F"),
    confidence="medium",
    notes="Size is the aquarium male maximum (5 cm); wild fish reach only ~3 cm. Temperature "
          "is the Lake Tanganyika shoreline range converted from 75-80 F, not an explicit "
          "aquarium recommendation. Aggression left null: the article only describes "
          "intraspecific shell-territory competition, not aquarium temperament. Tank size is "
          "described qualitatively (suitable for smaller tanks) with no figure.",
)

# 13 ----------------------------------------------------------------------
s = "sp_andinoacara_stalsbergi"
row(
    s,
    adult=size(s, W, 4.4,
               "the largest officially measured A. stalsbergi only had a standard length of "
               "11.3 cm"),
    aggression=aggr(s, W, "aggressive",
                    "A. stalsbergi live up to the name aquarium trade name green terror"),
    temperature=temp(s, W, 20, 24, "They prefer a temperature in the range 20-24 °C"),
    confidence="medium",
    notes="Size is the largest officially measured specimen; the article adds that the species "
          "is known to reach a size comparable to A. rivulatus but gives no figure for that. "
          "No tank volume stated.",
)

# 14 ----------------------------------------------------------------------
s = "sp_geophagus_brasiliensis"
row(
    s,
    adult=size(s, W, 9.8, "The males can reach a length up to 25 cm"),
    confidence="medium",
    notes="The same article also says males reach 'just over a foot', which is larger but "
          "carries no numeral to quote, so the precise 25 cm figure was used. Aggression left "
          "null: the only territoriality mentioned is around the breeding space. No "
          "temperature or volume stated.",
)

# 15 ----------------------------------------------------------------------
s = "sp_anomalochromis_thomasi"
row(
    s,
    adult=size(s, W, 3.1, "It is a small cichlid growing to a length of 6–8 cm"),
    confidence="high",
    notes="Cached page is the monospecific genus article Anomalochromis, which covers "
          "A. thomasi explicitly. The 30 C figure is a dry-season stream temperature, not an "
          "aquarium range, so temp_c is null. Territoriality mentioned is breeding-pair "
          "territoriality only, so aggression is null.",
)

# 16 ----------------------------------------------------------------------
s = "sp_syntripsa_flavichela"
row(
    s,
    confidence="high",
    notes="Correct species, but the cached article is a single distribution sentence plus a "
          "reference list. No size, volume, temperature or temperament stated.",
)

# 17 ----------------------------------------------------------------------
s = "sp_marsilea_hirsuta"
row(
    s,
    confidence="high",
    notes="Correct species, but the cached article covers only habitat and nomenclature. No "
          "size, volume, temperature or temperament stated.",
)

# 18 ----------------------------------------------------------------------
s = "sp_chitala_ornata"
row(
    s,
    adult=size(s, W, 39.6, "Adults can reach up to 3.3 ft long in the wild"),
    aggression=aggr(s, W, "semi-aggressive",
                    "Adults are known to be territorial and prefer to travel alone"),
    confidence="medium",
    notes="The article also states 'The clown featherback reaches 1 m in length' (39.4 in); "
          "took the larger 3.3 ft figure. Territoriality is described for wild adults rather "
          "than in an aquarium context, hence medium confidence. Tank need is described only "
          "as outgrowing all but the largest aquaria, with no volume figure.",
)

# 19 ----------------------------------------------------------------------
s = "sp_labidochromis_chisumulae"
row(
    s,
    confidence="high",
    notes="Correct species, but the cached article is a two-sentence stub on endemism and "
          "habitat. No size, volume, temperature or temperament stated.",
)

# 20 ----------------------------------------------------------------------
s = "sp_chromobotia_macracanthus"
row(
    s,
    adult=size(s, W, 19.7, "Although specimens in the wild will reach 40 to 50 cm"),
    aggression=aggr(s, W, "peaceful",
                    "They make suitable tank-mates for any non-aggressive community fishes, "
                    "but do not thrive when kept with larger, more dominant species"),
    temperature=temp(s, W, 25, 30,
                     "the fish is found in water with a temperature range of "
                     "25–30 °C"),
    confidence="medium",
    notes="The article gives conflicting sizes: 20-30 cm estimates and 15-20 cm typical in "
          "aquaria, but 40-50 cm in the wild. Took the largest stated maximum (50 cm). "
          "Temperature is the native-habitat range, not an explicit aquarium recommendation. "
          "No tank volume stated.",
)

# 21 ----------------------------------------------------------------------
s = "sp_hephaestus_carbo"
row(
    s,
    adult=size(s, W, 13.0, "The maximum recorded standard length is 33 cm"),
    confidence="high",
    notes="The only temperature given is a habitat floor (always in excess of 15 C), not a "
          "range, so temp_c is null. Predatory diet is not a stated temperament, so "
          "aggression is null.",
)

# 22 ----------------------------------------------------------------------
s = "sp_arius_jordani"
row(
    s,
    confidence="medium",
    notes="The cached page is the Tete sea catfish article, which names our common name "
          "(Colombian shark catfish) but places it under Ariopsis seemanni; our binomial "
          "Arius jordani never appears, though 'Jordan's catfish' is listed as a trade name. "
          "Treated as the same animal under a superseded name. The article gives no numbers "
          "at all: tank need is stated only as 'a very large tank'.",
    corrected="Ariopsis seemanni",
)

# 23 ----------------------------------------------------------------------
s = "sp_hypancistrus_debilittera"
row(
    s,
    adult=size(s, W, 2.6, "The holotype has a standard length of 67 mm"),
    confidence="medium",
    notes="The only length in the article is the holotype's standard length (67 mm), which is "
          "not necessarily the species maximum, hence medium confidence. No volume, "
          "temperature or temperament stated.",
)

# 24 ----------------------------------------------------------------------
s = "sp_rineloricaria_parva"
row(
    s,
    adult=size(s, W, 4.3, "This species reaches a standard length of 11 cm"),
    confidence="high",
    notes="No volume, temperature or temperament stated in the article.",
)

# 25 ----------------------------------------------------------------------
s = "sp_anubias_heterophylla"
row(
    s,
    temperature=temp(s, W, 24, 27, "It prefers a temperature range of 24 to 27 °C"),
    confidence="high",
    notes="Aquatic plant. adult_size_in left null: the article gives leaf-blade (up to 38 cm) "
          "and leaf-stem (up to 66 cm) dimensions but no overall plant size. Tank need is "
          "described only as 'spacious aquariums', with no volume figure.",
)


if ERRORS:
    for e in ERRORS:
        print("QUOTE CHECK FAILED:", e, file=sys.stderr)
    sys.exit(1)

with open(OUT, "w", encoding="utf-8") as fh:
    for r in rows:
        fh.write(json.dumps(r, ensure_ascii=False) + "\n")

print(f"wrote {OUT}: {len(rows)} rows")
for f in ("adult_size_in", "min_volume_gal", "aggression", "temp_c"):
    print(f"  {f}: {sum(1 for r in rows if r[f] is not None)} non-null")
print(f"  corrected_scientific_name: "
      f"{sum(1 for r in rows if 'corrected_scientific_name' in r)}")

#!/usr/bin/env python3
"""Build batch-20.jsonl. Every quote is verified verbatim against its source file."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
TEXT = os.path.join(ROOT, "data", "care", "text")

CACHE = {}


def body(species_id, source):
    key = (species_id, source)
    if key not in CACHE:
        path = os.path.join(TEXT, f"{species_id}.{source}.txt")
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        # drop the two "# " header lines
        assert lines[0].startswith("# ") and lines[1].startswith("# "), path
        CACHE[key] = "\n".join(lines[2:])
    return CACHE[key]


ERRORS = []


def q(species_id, source, text):
    """Verify a quote is present verbatim in the article body."""
    if len(text) < 12:
        ERRORS.append(f"{species_id}: quote too short: {text!r}")
    if text not in body(species_id, source):
        ERRORS.append(f"{species_id} [{source}]: NOT FOUND verbatim: {text!r}")
    return text


def size(sid, src, value, quote):
    return {"value": value, "quote": q(sid, src, quote), "source": src}


def vol(sid, src, value, quote):
    return {"value": value, "quote": q(sid, src, quote), "source": src}


def agg(sid, src, value, quote):
    assert value in ("peaceful", "semi-aggressive", "aggressive", "highly-aggressive")
    return {"value": value, "quote": q(sid, src, quote), "source": src}


def temp(sid, src, lo, hi, quote):
    return {"min": lo, "max": hi, "quote": q(sid, src, quote), "source": src}


rows = []


def row(species_id, adult=None, volume=None, aggression=None, temperature=None,
        confidence="high", notes=None, corrected=None):
    d = {
        "species_id": species_id,
        "adult_size_in": adult,
        "min_volume_gal": volume,
        "aggression": aggression,
        "temp_c": temperature,
        "confidence": confidence,
    }
    if notes:
        d["notes"] = notes
    if corrected:
        d["corrected_scientific_name"] = corrected
    rows.append(d)


# 1
s = "sp_mastacembelus_armatus"
row(s,
    adult=size(s, "wikipedia", 36,
               "Mastacembelus armatus can reach up to 36 in in its natural habitat but does not usually exceed 20 in in captivity"),
    volume=vol(s, "wikipedia", 55,
               "larger M. armatus necessitate aquariums measuring at least 48 in with 55 gallons (209 liters) capacity"),
    aggression=agg(s, "wikipedia", "semi-aggressive",
                   "they are aggressive to members of the same fish family but peaceful to other fish species with similar care level requirements, size, and temperament"),
    temperature=temp(s, "wikipedia", 22.8, 27.2,
                     "temperatures that are maintained between 73–81 °F"),
    confidence="high",
    notes="Aquarium section also gives 35 gallons for 6 in juveniles; took the 55 gallon adult figure. Captivity maximum is given as 20 in, wild maximum as 36 in; took the larger.")

# 2
s = "sp_placidochromis_phenochilus"
row(s,
    adult=size(s, "vendor", 7.0, 'Max Size : 7"'),
    aggression=agg(s, "vendor", "aggressive", "Aggressiveness : Aggressive"),
    temperature=temp(s, "vendor", 23.3, 27.8, "Temperature : 74-82°"),
    confidence="medium",
    notes="Sources disagree on size: Wikipedia says 15.7 cm TL (6.2 in), vendor says 7 in; took the larger. Vendor page is for an albino strain of the same species. No tank volume stated.")

# 3
s = "sp_hemiancistrus_medians"
row(s,
    adult=size(s, "wikipedia", 15.4,
               "This species is large for a loricariid, reaching a total length of 39 cm"),
    notes="Short taxonomic/distribution article. No tank volume, temperament, or temperature stated.")

# 4
s = "sp_megalechis_thoracata"
row(s,
    adult=size(s, "wikipedia", 6.0,
               "with the main difficulty being the maximum size of around 6 in"),
    volume=vol(s, "wikipedia", 55,
               "they need a minimum tank size of 55 US liquid gallons"),
    aggression=agg(s, "wikipedia", "peaceful",
                   "They are a very peaceful fish, with the only exception being when the males are guarding a bubble nest at breeding time"),
    temperature=temp(s, "wikipedia", 24, 28,
                     "the optimal temperature for them is around 24–28 °C"),
    notes="Article also gives a tolerable 22-30 C range; used the stated optimal range.")

# 5
s = "sp_pao_suvattii"
row(s,
    adult=size(s, "wikipedia", 4.5,
               "It is a medium-sized pufferfish, reaching 11.5 cm SL"),
    aggression=agg(s, "wikipedia", "highly-aggressive",
                   "P. suvattii is among the most aggressive of puffers in captivity"),
    notes="Article states it must be kept alone and is aggressive towards other fish and humans. No tank volume or temperature stated.")

# 6
s = "sp_melanotaenia_trifasciata"
row(s,
    adult=size(s, "wikipedia", 5.9,
               "An adult banded rainbowfish can reach a standard length of 12–15 cm"),
    aggression=agg(s, "wikipedia", "peaceful",
                   "a hardy and peaceful shoaling fish, they make easy additions to most peaceful community aquariums"),
    notes="No tank volume or temperature stated.")

# 7
s = "sp_lilaeopsis_brasiliensis"
row(s,
    adult=size(s, "wikipedia", 3.0,
               "Reaches a height of about 1.5 - 3 inches (4 - 7 cm)"),
    notes="Aquarium plant; adult_size_in records maximum plant height. Cultivation section mentions 'a tropical temperature range' with no figures, so temp is null.")

# 8
s = "sp_microsorum_pteropus"
row(s,
    corrected="Leptochilus pteropus",
    notes="Article is titled Leptochilus pteropus and gives Microsorum pteropus as a synonym, so the binomial is superseded. No size, volume, or temperature figures anywhere in the text.")

# 9
s = "sp_mikrogeophagus_ramirezi"
row(s,
    adult=size(s, "wikipedia", 1.6,
               "Males are slightly larger than females, with this species reaching 34–40 mm"),
    temperature=temp(s, "wikipedia", 25.5, 29.5,
                     "The natural habitat of M. ramirezi are warm (25.5–29.5 °C)"),
    notes="Temperature is the stated natural habitat range; no aquarium range is given. 'the males do not tolerate other males' appears in the reproduction section as wild/spawning behaviour, so aggression is null.")

# 10
s = "sp_neritina_pulligera"
row(s,
    aggression=agg(s, "wikipedia", "peaceful",
                   "It is popular for its peaceful nature and ease of care"),
    temperature=temp(s, "wikipedia", 23, 29,
                     "N. pulligera is most commonly reported under warm water temperatures (between 23–29 °C)"),
    notes="Shell size sentences in the cached text have their measurements stripped ('typically measures in length, although some can reach .'), so size is null. Temperature is the reported habitat range.")

# 11
s = "sp_cambarellus_diminutus"
row(s,
    adult=size(s, "wikipedia", 0.8,
               "this animal is typically 1–2 cm in size"),
    confidence="medium",
    notes="Only a typical size range is given (1-2 cm), not a stated maximum; took the top of the range. Nothing on volume, temperament, or temperature.")

# 12
s = "sp_cambarellus_shufeldtii"
row(s,
    aggression=agg(s, "wikipedia", "aggressive",
                   "This species is aggressive and will enter conflict with other crayfish species"),
    notes="Short article. No size, volume, or temperature stated.")

# 13
s = "sp_polypterus_mokelembembe"
row(s,
    adult=size(s, "wikipedia", 14.0,
               "reaching a maximum recorded adult length of 14 inches (36 cm)"),
    aggression=agg(s, "wikipedia", "peaceful",
                   "P. mokelembembe is very docile for a bichir and tends to be submissive to its tankmates in captivity"),
    notes="No tank volume or temperature stated.")

# 14
s = "sp_poecilia_sphenops"
row(s,
    adult=size(s, "vendor", 4.0, 'Max Size : 4"'),
    aggression=agg(s, "vendor", "peaceful",
                   "Mollies ( Poecilia sphenops ) are peaceful community fish that reproduce with ease"),
    temperature=temp(s, "vendor", 18.3, 26.7, "Temperature : 65-80°"),
    confidence="medium",
    notes="Sources disagree slightly on size: Wikipedia gives 10 cm total length (3.9 in), vendor gives 4 in; took the larger. Wikipedia's 20-35 C figure is a thermal acclimation range, not a recommended aquarium range, so used the vendor temperature. No tank volume stated.")

# 15
s = "sp_poecilia_salvatoris"
row(s,
    adult=size(s, "wikipedia", 3.0,
               "Maximum length is about 3 in, with females generally larger than males"),
    volume=vol(s, "wikipedia", 30,
               "three males and six females would be suitable in a 30-gallon aquarium"),
    aggression=agg(s, "wikipedia", "semi-aggressive",
                   "the liberty molly can be aggressive towards other tankmates and nip the fins of other fishes in the tank"),
    notes="Aggression is conditional fin-nipping plus male-on-male aggression, so scored semi-aggressive rather than aggressive. No temperature stated.")

# 16
s = "sp_bacopa_monnieri"
row(s,
    notes="Article is about the medicinal herb: taxonomy, ethnobotany, FDA warnings, phytochemistry. The only measurement is leaf thickness (4-6 mm), which is not a plant size. No aquarium care data at all.")

# 17
s = "sp_monodactylus_argenteus"
row(s,
    adult=size(s, "wikipedia", 10.6,
               "This species reaches a maximum length of about 27 cm"),
    aggression=agg(s, "wikipedia", "semi-aggressive",
                   "Although this species displays territorial behavior, it can be kept in saltwater aquaria and is easy to rear in captivity"),
    notes="No tank volume or temperature stated.")

# 18
s = "sp_cichla_monoculus"
row(s,
    adult=size(s, "wikipedia", 31.5,
               "It reaches 80 cm in length and 9 kg in weight"),
    notes="One-paragraph article. No volume, temperament, or temperature stated.")

# 19
s = "sp_vesicularia_montagnei"
row(s,
    notes="Three-sentence stub on distribution and ornamental use. No size, volume, or temperature figures.")

# 20
s = "sp_danio_dangila"
row(s,
    adult=size(s, "wikipedia", 6.0,
               "Adults individuals can grow up to 15 cm (6 inches)"),
    aggression=agg(s, "wikipedia", "peaceful",
                   "where its relatively passive nature allows it to be housed in a community tank"),
    notes="No tank volume or temperature stated.")

# 21
s = "sp_tyrannochromis_macrostoma"
row(s,
    adult=size(s, "wikipedia", 11.8,
               "This species can reach a length of 30 cm TL"),
    notes="One-paragraph article. No volume, temperament, or temperature stated.")

# 22
s = "sp_maccullochella_peelii"
row(s,
    adult=size(s, "wikipedia", 70.9,
               "Murray cod are capable of growing well over 1 m in length and the largest on record was over 1.8 m and about 113 kg in weight"),
    notes="Took the 1.8 m record maximum; adults regularly reach 80-100 cm. Long article, but entirely wild ecology, fisheries, and conservation; no aquarium volume, temperament, or temperature. Spawning temperatures (15-21 C) are wild spawning cues, not an aquarium range.")

# 23
s = "sp_esox_masquinongy"
row(s,
    adult=size(s, "wikipedia", 72.0,
               "Muskellunge are typically 28–48 in long and weigh 15–36 lb, though some have reached up to 6 ft and almost 70 lb"),
    notes="Took the 6 ft (72 in) maximum; the IGFA record fish is listed separately at 60.25 in. No aquarium volume, temperament, or temperature stated.")

# 24
s = "sp_panaqolus_albomaculatus"
row(s,
    adult=size(s, "wikipedia", 4.9,
               "This species reaches a standard length 12.4 cm"),
    notes="One-paragraph article. No volume, temperament, or temperature stated.")

# 25
s = "sp_heros_notatus"
row(s,
    notes="Four-line stub covering range and a note that the species is uncommon in the trade. No size, volume, temperament, or temperature.")

if ERRORS:
    for e in ERRORS:
        print("FAIL:", e, file=sys.stderr)
    sys.exit(1)

out = os.path.join(ROOT, "data", "care", "proposals", "batch-20.jsonl")
with open(out, "w", encoding="utf-8") as fh:
    for d in rows:
        fh.write(json.dumps(d, ensure_ascii=False) + "\n")

print(f"wrote {len(rows)} rows to {out}")
for field in ("adult_size_in", "min_volume_gal", "aggression", "temp_c"):
    print(f"  {field}: {sum(1 for d in rows if d[field] is not None)} non-null")

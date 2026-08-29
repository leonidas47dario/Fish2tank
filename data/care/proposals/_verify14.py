import json, os, sys

root = "/home/rliao/projects/Fish2tank/.claude/worktrees/feat+care-profile-backfill"
man = json.load(open(os.path.join(root, "data/care/batches/batch-14.json")))
byid = {s["speciesId"]: s for s in man["species"]}

rows = []
with open(os.path.join(root, "data/care/proposals/batch-14.jsonl")) as f:
    for i, line in enumerate(f, 1):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception as e:
            print("PARSE FAIL line", i, e); sys.exit(1)

print("rows:", len(rows), "manifest:", len(byid))
seen = set()
counts = {"adult_size_in": 0, "min_volume_gal": 0, "aggression": 0, "temp_c": 0}
ok = True

cache = {}
def body(path):
    if path not in cache:
        txt = open(os.path.join(root, path), encoding="utf-8").read()
        lines = txt.split("\n")
        # strip the two '# ' header lines
        assert lines[0].startswith("# ") and lines[1].startswith("# "), path
        cache[path] = "\n".join(lines[2:])
    return cache[path]

for r in rows:
    sid = r["species_id"]
    seen.add(sid)
    if sid not in byid:
        print("NOT IN MANIFEST:", sid); ok = False; continue
    sp = byid[sid]
    for field in counts:
        v = r.get(field, "MISSING")
        if v == "MISSING":
            print("MISSING FIELD", sid, field); ok = False; continue
        if v is None:
            continue
        counts[field] += 1
        src = v["source"]
        key = "wikipediaFile" if src == "wikipedia" else "vendorFile"
        if key not in sp:
            print("NO SUCH SOURCE FILE", sid, field, src); ok = False; continue
        q = v["quote"]
        if len(q) < 12:
            print("QUOTE TOO SHORT", sid, field, repr(q)); ok = False
        if q not in body(sp[key]):
            print("QUOTE NOT FOUND", sid, field, repr(q)); ok = False
    a = r.get("aggression")
    if a and a["value"] not in ("peaceful", "semi-aggressive", "aggressive", "highly-aggressive"):
        print("BAD AGGRESSION", sid, a["value"]); ok = False
    if r.get("confidence") not in ("high", "medium", "low"):
        print("BAD CONFIDENCE", sid); ok = False

missing = set(byid) - seen
if missing:
    print("MISSING SPECIES:", missing); ok = False

print("counts:", counts)
print("OK" if ok else "FAILURES ABOVE")

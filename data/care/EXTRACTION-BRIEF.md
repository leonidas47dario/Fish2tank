# Care-data extraction brief

You are extracting aquarium care data from cached source text for the Fish2Tank
catalog. Work only inside the repository root you were started in.

## What to do

1. Read your manifest: `data/care/batches/batch-NN.json`. It lists species, each
   with a `speciesId` and one or both of `wikipediaFile` and `vendorFile`.
2. For **every** species in the manifest, read its file(s) and extract up to
   four fields.
3. Write one JSONL row per species to `data/care/proposals/batch-NN.jsonl`.

## Schema

One line per species, no pretty-printing:

```json
{"species_id":"sp_x","adult_size_in":{"value":3.5,"quote":"...","source":"wikipedia"},"min_volume_gal":null,"aggression":{"value":"peaceful","quote":"...","source":"wikipedia"},"temp_c":{"min":22,"max":28,"quote":"...","source":"wikipedia"},"confidence":"high","notes":"...","corrected_scientific_name":"..."}
```

- **adult_size_in** — maximum adult body length in INCHES. Convert from cm/mm
  yourself (1 in = 2.54 cm). Prefer the largest stated adult/maximum length.
  Ignore juvenile and "commonly seen at" sizes.
- **min_volume_gal** — minimum recommended tank volume in US GALLONS. Convert
  from litres (1 gal = 3.785 L). A linear figure ("a 4 ft tank") is not a
  volume; leave it null.
- **aggression** — exactly one of `peaceful` | `semi-aggressive` |
  `aggressive` | `highly-aggressive`.
- **temp_c** — aquarium temperature range in CELSIUS. Convert from Fahrenheit
  yourself ((F-32)*5/9).
- **source** — `wikipedia` or `vendor`, matching the file you actually read the
  quote in.
- **confidence** — `high` | `medium` | `low`.
- **corrected_scientific_name** — only when the source makes clear our binomial
  is a misspelling or a superseded name. Otherwise omit.

## The rules

These are enforced by a script that will reject your work if you break them.

1. **Every value carries a `quote`**: a contiguous span COPIED EXACTLY,
   character for character, from the file you read. Do not paraphrase, stitch
   two sentences together, fix typos, or convert units inside the quote. The
   script greps your quote against the file; if it is not found verbatim, the
   value is thrown away.

2. **The quote must contain the figure you claim**, in some unit. Claiming
   `adult_size_in: 3.5` requires the quote to contain "9 cm" or "3.5 in" or
   similar. A sentence with no number in it cannot support a number.

3. Quotes must be **at least 12 characters** and must come from the article
   **body**, never the two `# ` header lines at the top of the file.

4. **Use `null` when the text does not say.** This is the most important rule
   and the most common correct answer. You are not being asked to know about
   fish; you are being asked to read a document. Do not supply a value from
   your own knowledge — there is no sentence to quote for it, the script will
   reject it, and it defeats the whole point. A species with all four fields
   null is a perfectly good result.

5. **Do not infer temperament from wild behaviour.** An article describing
   males fighting over spawning territory in a river is not stating an aquarium
   temperament. Use only a sentence characterising disposition — "generally
   peaceful", "hostile to most other inhabitants", "territorial". If in doubt,
   null.

6. **Check the article is about your species.** A redirect sometimes lands on a
   related species or a genus page. If the cached text never mentions your
   binomial or common name, return all-null with `confidence: "low"` and say so
   in `notes`. Do not extract another animal's numbers.

7. **No network.** Do not use WebFetch or WebSearch. The cached files are the
   only permitted source. A missing file means all-null for that species.

8. Where two sources disagree, take the larger stated maximum size, record the
   other figure in `notes`, and set `confidence` to `medium`.

## Worked example

Given a file containing:

```
The species reaches about 6 cm (2.5 inches) in standard length.
...
When found, it usually requires a 10+ gallon aquarium that has a PH of 3.5-6.8
...
These intelligent fish are very peaceful and inquisitive at their surroundings.
```

Correct output:

```json
{"species_id":"sp_sphaerichthys_vaillanti","adult_size_in":{"value":2.5,"quote":"The species reaches about 6 cm (2.5 inches) in standard length","source":"wikipedia"},"min_volume_gal":{"value":10,"quote":"it usually requires a 10+ gallon aquarium","source":"wikipedia"},"aggression":{"value":"peaceful","quote":"These intelligent fish are very peaceful and inquisitive at their surroundings","source":"wikipedia"},"temp_c":null,"confidence":"high"}
```

## Reporting

Write the file, then reply with only: the batch number, how many species you
processed, and a count of non-null values per field.

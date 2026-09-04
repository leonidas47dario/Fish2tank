/**
 * Stage 2 for Seriously Fish: cached pages become shipped care data - spec 045.
 *
 *   npm run sf:ingest
 *   npm run sf:ingest -- --dry-run     # report only, writes nothing
 *
 * THE BOUNDARY BETWEEN A CLAIM AND SHIPPED DATA, so the logging standard
 * applies with force: every species lands in exactly one outcome bucket, every
 * bucket prints whether it is empty or not, and a run that accepts nothing
 * throws rather than writing an empty file over a good one.
 *
 * PRECEDENCE: Seriously Fish outranks Wikipedia and vendor text, and - the
 * decision spec 045 records as taken deliberately - it outranks the 47 curated
 * profiles too. All 47 are already complete on the four original fields, so
 * "SF fills the gaps" would have been a no-op; what SF can do to them is
 * DISAGREE. Every such disagreement is kept with both figures and printed, so
 * a change to a hand-written value is readable before it lands rather than
 * discovered afterwards.
 *
 * THE SLUG CANNOT PROVE WHICH ANIMAL IT LANDED ON. `quoteFound` proves a
 * fragment is in the cached text; it says nothing about whose page that text
 * is. A slug built from a superseded binomial can redirect to a different
 * fish, so every page states its own binomial and a mismatch is rejected
 * outright - which is what makes the 79 epithet candidates safe to attempt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseSeriouslyFish, type SfProfile } from './sources/seriously-fish';
import { sfTextPath, type SlugMatch } from './care/seriously-fish-slugs';
import { sameFish } from './care/seriously-fish-aliases';
import { inRange, quoteFound } from './care/quote';

const MATCHES = 'data/care/seriously-fish-matches.json';
const CARE = 'src/data/seed/species-care.json';
const OVERRIDES = 'data/care/seriously-fish-overrides.json';

const dryRun = process.argv.includes('--dry-run');

interface CareValue<T> { value: T; quote: string; source: string; sourceUrl?: string }
interface CareRow {
  speciesId: string;
  adultSizeIn?: CareValue<number>;
  minVolumeGal?: CareValue<number>;
  aggression?: CareValue<string>;
  tempC?: CareValue<{ min: number; max: number }>;
  // Spec 045's new fields.
  lengthBasis?: 'SL' | 'TL' | 'unstated';
  ph?: CareValue<{ min: number; max: number }>;
  hardnessDgh?: CareValue<{ min: number; max: number }>;
  tankBaseIn?: CareValue<{ length: number; width: number }>;
  difficulty?: { source: string; sourceUrl?: string; measures: Array<{ measure: string; word: string }> };
}

/** Same genus-species comparison the matcher uses, so both agree on "same fish". */
const binomialOf = (s: string) =>
  s.toLowerCase().replace(/[^a-z ]+/g, '').trim().split(/\s+/).slice(0, 2).join(' ');

function main(): void {
  if (!existsSync(MATCHES)) throw new Error(`${MATCHES} missing - run npm run sf:fetch first`);
  const matches = JSON.parse(readFileSync(MATCHES, 'utf8')) as SlugMatch[];
  const care = JSON.parse(readFileSync(CARE, 'utf8')) as {
    schemaVersion: number; builtAt: string; species: CareRow[];
  };
  const byId = new Map(care.species.map((r) => [r.speciesId, r]));

  const buckets = {
    noCache: 0, unparsed: 0, wrongAnimal: 0, accepted: 0, nothingUsable: 0,
  };
  const rejections: Array<{ speciesId: string; field: string; reason: string; claimed?: unknown }> = [];
  const overrides: Array<{ speciesId: string; field: string; was: unknown; wasSource: string; now: unknown }> = [];
  const fieldCounts: Record<string, number> = {};

  for (const m of matches) {
    const path = sfTextPath(m.speciesId);
    if (!existsSync(path)) { buckets.noCache += 1; continue; }

    const raw = readFileSync(path, 'utf8');
    const url = (raw.split('\n')[1] ?? '').replace(/^#\s*/, '').trim();
    const text = raw.split('\n').slice(2).join('\n');
    const p: SfProfile = parseSeriouslyFish(text);

    /*
     * The wrong-animal guard. The page decides: a slug match is a proposal, and
     * a page stating a different binomial means it is a different fish.
     *
     * SPEC 060 ADDED ONE EXCEPTION AND KEPT IT NARROW. Some pages state a
     * genuine synonym rather than a redirect - SF calls the zebra danio
     * `Brachydanio rerio` - and rejecting those loses real care data for no
     * safety. `sameFish` consults a curated, cited list and nothing else; it is
     * deliberately not a taxonomy service, because the automatic version of
     * this was measured and mapped a dwarf gourami onto a banded one.
     */
    if (p.statedBinomial
      && binomialOf(p.statedBinomial) !== binomialOf(m.scientificName)
      && !sameFish(p.statedBinomial, m.scientificName)) {
      buckets.wrongAnimal += 1;
      rejections.push({
        speciesId: m.speciesId, field: 'binomial',
        reason: `page states "${p.statedBinomial}", asked for "${m.scientificName}"`,
      });
      continue;
    }

    const row: CareRow = byId.get(m.speciesId) ?? { speciesId: m.speciesId };
    const cite = <T>(value: T, quote: string): CareValue<T> =>
      ({ value, quote, source: 'seriouslyfish', sourceUrl: url });

    /** Accept a figure only if bounded AND its quote is really in this page. */
    const take = (field: string, quote: string, bound: boolean): boolean => {
      if (!bound) { rejections.push({ speciesId: m.speciesId, field, reason: 'outside the plausible range', claimed: quote }); return false; }
      if (!quoteFound(quote, text)) { rejections.push({ speciesId: m.speciesId, field, reason: 'quote not found in the cached page', claimed: quote }); return false; }
      return true;
    };

    /** Record what a curated or previously-sourced value is being replaced by. */
    const note = (field: string, was: CareValue<unknown> | undefined, now: unknown) => {
      if (was && was.source !== 'seriouslyfish') {
        overrides.push({ speciesId: m.speciesId, field, was: was.value, wasSource: was.source, now });
      }
    };

    let used = 0;
    if (p.minVolumeGal && take('minVolumeGal', p.minVolumeGal.quote, inRange('min_volume_gal', p.minVolumeGal.value))) {
      note('minVolumeGal', row.minVolumeGal, p.minVolumeGal.value);
      row.minVolumeGal = cite(p.minVolumeGal.value, p.minVolumeGal.quote); used += 1;
      fieldCounts.minVolumeGal = (fieldCounts.minVolumeGal ?? 0) + 1;
    }
    if (p.adultSizeIn && take('adultSizeIn', p.adultSizeIn.quote, inRange('adult_size_in', p.adultSizeIn.value))) {
      note('adultSizeIn', row.adultSizeIn, p.adultSizeIn.value);
      row.adultSizeIn = cite(p.adultSizeIn.value, p.adultSizeIn.quote);
      // The basis travels with the figure or it is worse than useless.
      if (p.lengthBasis) row.lengthBasis = p.lengthBasis;
      used += 1; fieldCounts.adultSizeIn = (fieldCounts.adultSizeIn ?? 0) + 1;
    }
    if (p.tempC && take('tempC', p.tempC.quote, inRange('temp_c', p.tempC.value.min) && inRange('temp_c', p.tempC.value.max) && p.tempC.value.min <= p.tempC.value.max)) {
      note('tempC', row.tempC, p.tempC.value);
      row.tempC = cite(p.tempC.value, p.tempC.quote); used += 1;
      fieldCounts.tempC = (fieldCounts.tempC ?? 0) + 1;
    }
    if (p.ph && take('ph', p.ph.quote, inRange('ph', p.ph.value.min) && inRange('ph', p.ph.value.max) && p.ph.value.min <= p.ph.value.max)) {
      row.ph = cite(p.ph.value, p.ph.quote); used += 1;
      fieldCounts.ph = (fieldCounts.ph ?? 0) + 1;
    }
    if (p.hardnessDgh && take('hardnessDgh', p.hardnessDgh.quote, inRange('hardness_dgh', p.hardnessDgh.value.min) && inRange('hardness_dgh', p.hardnessDgh.value.max) && p.hardnessDgh.value.min <= p.hardnessDgh.value.max)) {
      row.hardnessDgh = cite(p.hardnessDgh.value, p.hardnessDgh.quote); used += 1;
      fieldCounts.hardnessDgh = (fieldCounts.hardnessDgh ?? 0) + 1;
    }
    if (p.tankBaseIn && take('tankBaseIn', p.tankBaseIn.quote, inRange('tank_base_in', p.tankBaseIn.value.length) && inRange('tank_base_in', p.tankBaseIn.value.width))) {
      row.tankBaseIn = cite(p.tankBaseIn.value, p.tankBaseIn.quote); used += 1;
      fieldCounts.tankBaseIn = (fieldCounts.tankBaseIn ?? 0) + 1;
    }
    /*
     * The difficulty measures are SF's editorial rating with no sentence
     * behind them. Stored ATTRIBUTED AND UNGATED, never pretending to be a
     * sourced figure - the one exception the provenance test allows, for this
     * field group and nothing else.
     */
    if (p.difficulty.length > 0) {
      row.difficulty = { source: 'seriouslyfish', sourceUrl: url, measures: p.difficulty };
      fieldCounts.difficulty = (fieldCounts.difficulty ?? 0) + 1;
    }

    if (used === 0 && !row.difficulty) { buckets.nothingUsable += 1; continue; }
    buckets.accepted += 1;
    byId.set(m.speciesId, row);
  }

  const out = { schemaVersion: care.schemaVersion, builtAt: new Date().toISOString(), species: [...byId.values()].sort((a, b) => a.speciesId.localeCompare(b.speciesId)) };

  console.info('[sf-ingest] outcomes', { matched: matches.length, ...buckets });
  console.info('[sf-ingest] fields written', fieldCounts);
  console.info('[sf-ingest] rejections', { count: rejections.length });
  console.info('[sf-ingest] overrides of non-SF values', { count: overrides.length });
  for (const o of overrides.slice(0, 25)) {
    console.info(`[sf-ingest]   ${o.speciesId} ${o.field}: ${JSON.stringify(o.was)} (${o.wasSource}) -> ${JSON.stringify(o.now)}`);
  }
  if (overrides.length > 25) console.info(`[sf-ingest]   ...and ${overrides.length - 25} more, see ${OVERRIDES}`);

  if (buckets.accepted === 0) throw new Error('sf:ingest accepted nothing - refusing to overwrite species-care.json');

  if (dryRun) { console.info('[sf-ingest] dry run, nothing written'); return; }
  writeFileSync(CARE, `${JSON.stringify(out, null, 1)}\n`);
  writeFileSync(OVERRIDES, `${JSON.stringify({ overrides, rejections }, null, 1)}\n`);
  console.info('[sf-ingest] wrote', { care: CARE, species: out.species.length, overrides: OVERRIDES });
}

main();

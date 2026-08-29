/**
 * Stage 3 of the care-profile backfill: the boundary between a claim and
 * shipped data.
 *
 *   npm run care:ingest
 *   npm run care:ingest -- --proposals data/care/care-proposals.jsonl
 *
 * Reads the proposals the extraction agents wrote, checks every cited value
 * against the source text cached in stage 1, and writes the survivors to
 * `src/data/seed/species-care.json`. Everything else - every rejected field,
 * every low-confidence row, every proposed taxonomy correction - goes to
 * `data/care/care-review.jsonl` with the reason it landed there.
 *
 * MERGES, NEVER OVERWRITES. A species already accepted keeps its values unless
 * this run has a better-evidenced replacement, so the campaign can be run in
 * waves without the last wave erasing the first.
 *
 * The logging standard applies with force here, because this is the step that
 * mutates what the app ships: every proposal logs its outcome, every rejection
 * logs which check failed, and a run that accepts nothing throws rather than
 * writing an empty file over a good one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { verifyProposal, type AcceptedCare, type CareProposal, type SourceDoc, type SourceKind } from './care/verify';
import { vendorPath, wikiPath } from './care/paths';

const PROPOSALS = 'data/care/care-proposals.jsonl';
const REVIEW = 'data/care/care-review.jsonl';
const OUT = 'src/data/seed/species-care.json';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

/**
 * Cached text files carry a two-line header written by stage 1:
 *   # <resolved title>
 *   # <url>
 * Split it off, because a quote is matched against the prose, not the header.
 */
export function readSourceDoc(path: string, kind: SourceKind): SourceDoc | undefined {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n');
  const header: string[] = [];
  let i = 0;
  while (i < lines.length && (lines[i] ?? '').startsWith('# ')) {
    header.push((lines[i] ?? '').slice(2).trim());
    i++;
  }
  const text = lines.slice(i).join('\n').trim();
  if (!text) return undefined;
  return {
    kind,
    text,
    ...(header[0] ? { title: header[0] } : {}),
    ...(header[1] ? { url: header[1] } : {}),
  };
}

export interface ReviewRow {
  speciesId: string;
  kind: 'rejected-field' | 'low-confidence' | 'taxonomy-correction' | 'unreadable-proposal' | 'no-source-text';
  field?: string;
  reason: string;
  claimed?: unknown;
}

/** Existing accepted records, so waves merge instead of clobbering. */
function loadExisting(): Map<string, AcceptedCare> {
  if (!existsSync(OUT)) return new Map();
  const prev = JSON.parse(readFileSync(OUT, 'utf8')) as { species?: AcceptedCare[] };
  return new Map((prev.species ?? []).map((s) => [s.speciesId, s]));
}

function main() {
  const proposalsPath = arg('proposals') ?? PROPOSALS;
  mkdirSync('data/care', { recursive: true });

  if (!existsSync(proposalsPath)) {
    throw new Error(`no proposals at ${proposalsPath} - run the extraction stage first`);
  }

  const lines = readFileSync(proposalsPath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  console.log('─── care: ingest proposals ───');
  console.log(`  proposals        ${lines.length} rows from ${proposalsPath}`);

  const accepted = loadExisting();
  const carriedOver = accepted.size;
  const review: ReviewRow[] = [];
  const seen = new Set<string>();

  const tally = {
    parsed: 0,
    unreadable: 0,
    duplicate: 0,
    noSourceText: 0,
    acceptedSpecies: 0,
    emptySpecies: 0,
    fields: { adultSizeIn: 0, minVolumeGal: 0, aggression: 0, tempC: 0 },
    rejectedFields: 0,
    reasons: {} as Record<string, number>,
  };

  for (const [n, line] of lines.entries()) {
    let p: CareProposal;
    try {
      p = JSON.parse(line) as CareProposal;
    } catch (err) {
      // An unparseable row is a silent data loss if swallowed. Name it.
      tally.unreadable++;
      review.push({
        speciesId: `(line ${n + 1})`,
        kind: 'unreadable-proposal',
        reason: `not valid JSON: ${(err as Error).message}`,
      });
      continue;
    }
    tally.parsed++;

    if (!p.species_id) {
      tally.unreadable++;
      review.push({ speciesId: `(line ${n + 1})`, kind: 'unreadable-proposal', reason: 'no species_id' });
      continue;
    }
    if (seen.has(p.species_id)) {
      tally.duplicate++;
      review.push({ speciesId: p.species_id, kind: 'unreadable-proposal', reason: 'duplicate proposal, later row ignored' });
      continue;
    }
    seen.add(p.species_id);

    if (p.corrected_scientific_name) {
      // Recorded, deliberately not applied. Renaming a species is a different
      // change with a different blast radius (spec 003, Scope: Out).
      review.push({
        speciesId: p.species_id,
        kind: 'taxonomy-correction',
        reason: `proposed rename to "${p.corrected_scientific_name}"`,
      });
    }

    const docs: Partial<Record<SourceKind, SourceDoc>> = {};
    const wiki = readSourceDoc(wikiPath(p.species_id), 'wikipedia');
    const vendor = readSourceDoc(vendorPath(p.species_id), 'vendor');
    if (wiki) docs.wikipedia = wiki;
    if (vendor) docs.vendor = vendor;

    if (!wiki && !vendor) {
      tally.noSourceText++;
      review.push({
        speciesId: p.species_id,
        kind: 'no-source-text',
        reason: 'no cached text for this species - nothing could be verified',
      });
      continue;
    }

    const result = verifyProposal(p, docs);

    for (const r of result.rejections) {
      tally.rejectedFields++;
      tally.reasons[r.reason] = (tally.reasons[r.reason] ?? 0) + 1;
      review.push({ speciesId: p.species_id, kind: 'rejected-field', field: r.field, reason: r.reason, claimed: r.claimed });
    }

    if (p.confidence === 'low') {
      review.push({
        speciesId: p.species_id,
        kind: 'low-confidence',
        reason: p.notes ? `agent flagged low confidence: ${p.notes}` : 'agent flagged low confidence',
      });
    }

    if (!result.anyAccepted) {
      tally.emptySpecies++;
      continue;
    }

    const prior = accepted.get(p.species_id);
    const merged: AcceptedCare = { ...(prior ?? { speciesId: p.species_id }), ...result.accepted };
    accepted.set(p.species_id, merged);
    tally.acceptedSpecies++;
    if (result.accepted.adultSizeIn) tally.fields.adultSizeIn++;
    if (result.accepted.minVolumeGal) tally.fields.minVolumeGal++;
    if (result.accepted.aggression) tally.fields.aggression++;
    if (result.accepted.tempC) tally.fields.tempC++;
  }

  const species = [...accepted.values()].sort((a, b) => a.speciesId.localeCompare(b.speciesId));
  writeFileSync(OUT, `${JSON.stringify({ schemaVersion: 1, builtAt: new Date().toISOString(), species }, null, 2)}\n`);
  writeFileSync(REVIEW, review.map((r) => JSON.stringify(r)).join('\n') + (review.length ? '\n' : ''));

  console.log(`  parsed           ${tally.parsed}, unreadable ${tally.unreadable}, duplicate ${tally.duplicate}`);
  console.log(`  no source text   ${tally.noSourceText}`);
  console.log(`  accepted         ${tally.acceptedSpecies} species gained at least one value`);
  console.log(`  nothing usable   ${tally.emptySpecies} species (a correct outcome when the text does not say)`);
  console.log('\n  fields accepted this run');
  console.log(`    adult size     ${tally.fields.adultSizeIn}`);
  console.log(`    min volume     ${tally.fields.minVolumeGal}`);
  console.log(`    aggression     ${tally.fields.aggression}`);
  console.log(`    temperature    ${tally.fields.tempC}`);
  console.log(`\n  rejected fields  ${tally.rejectedFields}`);
  for (const [reason, n] of Object.entries(tally.reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)} x ${reason}`);
  }

  console.log(`\n  wrote ${OUT} (${species.length} species, ${carriedOver} carried over from a previous run)`);
  console.log(`  wrote ${REVIEW} (${review.length} rows)`);

  if (species.length === 0) {
    throw new Error('no species has a single verified care value - refusing to report success over an empty file');
  }
}

try {
  main();
} catch (err) {
  console.error('\ncare:ingest FAILED:', (err as Error).message);
  process.exit(1);
}

/**
 * Review the species keepers have added, and decide which ones ship.
 *
 *   npm run species:review -- --export <fish2tank-export.json>
 *   npm run species:review -- --export <file> --accept sp_user_abc,sp_user_def
 *   npm run species:review -- --export <file> --accept-all
 *
 * The app has no backend, so a keeper's records reach this tool the way NFR-08
 * says they should: through the JSON export on the Settings screen. That file
 * already carries the `species` table, so nothing had to be added to it.
 *
 * WHAT THIS IS FOR. A keeper who catches a fish the catalog is missing logs it
 * as-is, and that becomes a `user-submitted` species on their device. This
 * reads those, checks each against the shipped catalog, and writes the ones a
 * person approves into `src/data/seed/community-species.json`, which
 * build-marts folds into catalog.json so every future install has them.
 *
 * IT NEVER ACCEPTS ON ITS OWN. Listing is the default; writing needs --accept
 * with explicit ids, or --accept-all, which still refuses everything the gate
 * rejected. The gate catches blanks, placeholders and probable duplicates; it
 * cannot catch a confident misreading of a store tag, which is exactly why a
 * human is the one typing the ids.
 *
 * MERGES, NEVER OVERWRITES. A species already in the file keeps its entry
 * unless this run has something to add, so the tool can be run per keeper
 * across many exports without the last run erasing the first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  checkSubmission, findCatalogMatches, normalise,
  type CatalogEntry, type Submission, type Verdict,
} from './community/gate';

const OUT = 'src/data/seed/community-species.json';
const CATALOG_MART = 'src/data/seed/marts/catalog.json';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** One accepted species, as the catalog build reads it back. */
export interface CommunitySpecies {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  aliases: string[];
  /** Kept so the shipped entry can say where it came from, and be undone. */
  submittedAt: string;
  /** Verbatim, because it is the evidence. */
  submittedLabel: string;
  acceptedAt: string;
  note?: string;
}

interface ExportFile {
  species?: Array<{
    id: string; commonName: string; scientificName?: string; aliases?: string[];
    createdAt: string; origin?: string;
    submission?: { label: string; specimenId?: string; submittedAt: string; note?: string };
  }>;
  specimens?: Array<{ id: string; speciesId?: string }>;
}

/**
 * Pull the keeper's own species out of an export.
 *
 * `origin === 'user-submitted'` is the marker the app writes. Exports taken
 * before this feature existed have no such rows, and that is a normal empty
 * result rather than an error - which the caller distinguishes from a file it
 * could not read at all.
 */
export function readSubmissions(raw: ExportFile): Submission[] {
  const specimensBySpecies = new Map<string, number>();
  for (const sp of raw.specimens ?? []) {
    if (sp.speciesId) specimensBySpecies.set(sp.speciesId, (specimensBySpecies.get(sp.speciesId) ?? 0) + 1);
  }
  return (raw.species ?? [])
    .filter((s) => s.origin === 'user-submitted')
    .map((s) => ({
      id: s.id,
      commonName: s.commonName,
      scientificName: s.scientificName,
      aliases: s.aliases ?? [],
      createdAt: s.createdAt,
      submission: s.submission,
      specimenCount: specimensBySpecies.get(s.id) ?? 0,
    }))
    .sort((a, b) => b.specimenCount - a.specimenCount || a.commonName.localeCompare(b.commonName));
}

function readCatalog(): CatalogEntry[] {
  if (!existsSync(CATALOG_MART)) {
    throw new Error(`${CATALOG_MART} is missing. Run \`npm run marts\` before reviewing.`);
  }
  const mart = JSON.parse(readFileSync(CATALOG_MART, 'utf8')) as {
    species?: Array<{ speciesId: string; commonName: string; scientificName?: string; aliases?: string[] }>;
  };
  const species = mart.species ?? [];
  if (species.length === 0) throw new Error(`${CATALOG_MART} has no species in it.`);
  return species.map((s) => ({
    speciesId: s.speciesId,
    commonName: s.commonName,
    scientificName: s.scientificName,
    aliases: s.aliases ?? [],
  }));
}

export function readExisting(path = OUT): CommunitySpecies[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { species?: CommunitySpecies[] };
  return parsed.species ?? [];
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

function report(sub: Submission, v: Verdict): void {
  const mark = v.verdict === 'accept' ? '  NEW  ' : v.verdict === 'review' ? ' CHECK ' : ' REJECT';
  const seen = `${sub.specimenCount} specimen${sub.specimenCount === 1 ? '' : 's'}`;
  console.log(`${mark} ${pad(sub.commonName, 34)} ${pad(seen, 13)} ${sub.id}`);
  if (v.verdict !== 'accept') console.log(`         ${v.reason}`);
  if (v.verdict === 'review' && v.matches?.length) {
    for (const m of v.matches.slice(0, 3)) {
      console.log(`         catalog: ${m.commonName}${m.scientificName ? ` (${m.scientificName})` : ''}  ${m.speciesId}`);
    }
  }
  if (sub.submission?.note) console.log(`         note: ${sub.submission.note}`);
}

async function main(): Promise<void> {
  const exportPath = arg('export');
  if (!exportPath) {
    console.error('Usage: npm run species:review -- --export <fish2tank-export.json> [--accept <ids>] [--accept-all]');
    process.exit(2);
  }
  if (!existsSync(exportPath)) {
    console.error(`No such export file: ${exportPath}`);
    process.exit(2);
  }

  const raw = JSON.parse(readFileSync(exportPath, 'utf8')) as ExportFile;
  if (!Array.isArray(raw.species)) {
    console.error(`${exportPath} has no "species" array — is it a Fish2Tank export?`);
    process.exit(2);
  }

  const catalog = readCatalog();
  const submissions = readSubmissions(raw);
  console.log(`\n  ${exportPath}`);
  console.log(`  ${submissions.length} keeper-submitted species, against ${catalog.length} in the catalog\n`);

  if (submissions.length === 0) {
    console.log('  Nothing to review.\n');
    return;
  }

  const verdicts = new Map<string, Verdict>();
  for (const sub of submissions) {
    const v = checkSubmission(sub, catalog);
    verdicts.set(sub.id, v);
    report(sub, v);
  }

  const accepted = submissions.filter((s) => verdicts.get(s.id)?.verdict === 'accept').length;
  const flagged = submissions.filter((s) => verdicts.get(s.id)?.verdict === 'review').length;
  const rejected = submissions.filter((s) => verdicts.get(s.id)?.verdict === 'reject').length;
  console.log(`\n  ${accepted} new, ${flagged} to check, ${rejected} rejected`);

  const acceptAll = flag('accept-all');
  const acceptIds = (arg('accept') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!acceptAll && acceptIds.length === 0) {
    console.log('\n  Nothing written. Re-run with --accept <id,id> or --accept-all to promote.\n');
    return;
  }

  const chosen: Submission[] = [];
  for (const sub of submissions) {
    const v = verdicts.get(sub.id)!;
    const wanted = acceptAll || acceptIds.includes(sub.id);
    if (!wanted) continue;
    if (v.verdict === 'reject') {
      console.log(`\n  refusing ${sub.id}: ${v.reason}`);
      continue;
    }
    // --accept-all means "everything the gate cleared", never "override the
    // gate". A flagged duplicate has to be named explicitly.
    if (v.verdict === 'review' && acceptAll && !acceptIds.includes(sub.id)) {
      console.log(`\n  skipping ${sub.id}: ${v.reason} (name it with --accept to override)`);
      continue;
    }
    chosen.push(sub);
  }

  if (chosen.length === 0) {
    console.log('\n  Nothing accepted. The file is unchanged.\n');
    return;
  }

  const existing = readExisting();
  const byId = new Map(existing.map((e) => [e.speciesId, e]));
  const byName = new Map(existing.map((e) => [normalise(e.commonName), e]));
  const at = new Date().toISOString();
  let added = 0;

  for (const sub of chosen) {
    if (byId.has(sub.id) || byName.has(normalise(sub.commonName))) {
      console.log(`  already promoted: ${sub.commonName}`);
      continue;
    }
    const row: CommunitySpecies = {
      speciesId: sub.id,
      commonName: sub.commonName,
      scientificName: sub.scientificName,
      aliases: sub.aliases ?? [],
      submittedAt: sub.submission?.submittedAt ?? sub.createdAt,
      submittedLabel: sub.submission?.label ?? sub.commonName,
      acceptedAt: at,
      note: sub.submission?.note,
    };
    byId.set(row.speciesId, row);
    byName.set(normalise(row.commonName), row);
    added++;
  }

  if (added === 0) {
    console.log('\n  Everything chosen was already in the file. Unchanged.\n');
    return;
  }

  const out = [...byId.values()].sort((a, b) => a.commonName.localeCompare(b.commonName));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ schemaVersion: 1, updatedAt: at, species: out }, null, 2)}\n`);
  console.log(`\n  wrote ${OUT} — ${added} added, ${out.length} total`);
  console.log('  Run `npm run marts` to fold them into the catalog.\n');
}

// Only when run as a CLI; the exports above are imported by the tests.
if (process.argv[1] && process.argv[1].includes('review-user-species')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { findCatalogMatches };

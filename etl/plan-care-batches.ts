/**
 * Stage 2 setup: split the species that have cached text into agent batches.
 *
 *   npm run care:plan
 *
 * Emits one manifest per batch to `data/care/batches/`, each listing the
 * species an extraction agent is responsible for and the exact files it should
 * read. Species with no cached text are excluded here rather than handed to an
 * agent that would have nothing to read and might be tempted to fill the gap
 * from memory - which is the one failure the gate downstream cannot catch,
 * because a remembered fact has no sentence to quote.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARE_DIR, vendorPath, wikiPath } from './care/paths';

const CATALOG = 'src/data/seed/marts/catalog.json';
const BATCH_DIR = join(CARE_DIR, 'batches');
const BATCH_SIZE = 25;

interface CatalogSpecies {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  family?: string;
  adultSizeIn?: number;
  minVolumeGal?: number;
  aggression?: string;
}

export interface BatchSpecies {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  family?: string;
  wikipediaFile?: string;
  vendorFile?: string;
}

function main() {
  mkdirSync(BATCH_DIR, { recursive: true });
  for (const f of readdirSync(BATCH_DIR)) if (f.endsWith('.json')) writeFileSync(join(BATCH_DIR, f), '');

  const { species } = JSON.parse(readFileSync(CATALOG, 'utf8')) as { species: CatalogSpecies[] };
  const gap = species.filter(
    (s) => s.adultSizeIn === undefined && s.minVolumeGal === undefined && s.aggression === undefined,
  );

  const withText: BatchSpecies[] = [];
  let noText = 0;
  for (const s of gap) {
    const w = wikiPath(s.speciesId);
    const v = vendorPath(s.speciesId);
    const hasW = existsSync(w);
    const hasV = existsSync(v);
    if (!hasW && !hasV) {
      noText++;
      continue;
    }
    withText.push({
      speciesId: s.speciesId,
      commonName: s.commonName,
      ...(s.scientificName ? { scientificName: s.scientificName } : {}),
      ...(s.family ? { family: s.family } : {}),
      ...(hasW ? { wikipediaFile: w } : {}),
      ...(hasV ? { vendorFile: v } : {}),
    });
  }

  const batches = Math.ceil(withText.length / BATCH_SIZE);
  for (let i = 0; i < batches; i++) {
    const n = String(i + 1).padStart(2, '0');
    writeFileSync(
      join(BATCH_DIR, `batch-${n}.json`),
      `${JSON.stringify({ batch: n, species: withText.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE) }, null, 2)}\n`,
    );
  }

  console.log('─── care: plan batches ───');
  console.log(`  unprofiled       ${gap.length}`);
  console.log(`  have source text ${withText.length}`);
  console.log(`  no text, skipped ${noText}`);
  console.log(`  wrote ${batches} manifests of up to ${BATCH_SIZE} to ${BATCH_DIR}`);
}

main();

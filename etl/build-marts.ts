/**
 * Warehouse → serving marts.
 *
 * This is the layer the app actually reads. It exists because the app must not
 * load Parquet: DuckDB-WASM is tens of megabytes and this is an offline-first
 * PWA on a phone. So the warehouse is queried once here, at build time, and
 * the result is a small JSON file the app can ship.
 *
 * It also makes the warehouse load-bearing rather than a side artifact. If
 * dim_species or dim_image is wrong, the catalog is wrong, and someone
 * notices.
 *
 * Convention: everything under src/data/seed/marts/ is GENERATED and should
 * never be hand-edited. Everything else under seed/ is source.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { deriveCommonName } from './normalize/derive-species';
import { findProblems, isUsableName, summarise } from '@/data/seed/catalog-quality';
import { OVERRIDE_BY_ID, SPECIES_SYNONYMS, SYNONYM_IDS } from '@/data/seed/species-overrides';
import { traitsFor, type OrganismKind, type WaterZone } from '@/data/seed/taxonomy';
import type { WaterType } from '@/domain/types';
import { loadCareBackfill, type CareRecord } from './care/backfill';

const WAREHOUSE = 'warehouse';
const OUT_DIR = 'src/data/seed/marts';

/** A species as the catalog screen needs it: profile plus its portrait. */
export interface CatalogEntry {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  aliases: string[];
  adultSizeIn?: number;
  minVolumeGal?: number;
  aggression?: string;
  tempMinC?: number;
  tempMaxC?: number;
  predationTags: string[];
  /**
   * Fresh, brackish or salt, from what the vendors selling it said - never
   * inferred from the fish. Absent means no vendor made a claim, which is not
   * a claim that it is freshwater; the catalog shows those as "not recorded"
   * and excludes them from every specific filter. See normalize/water-type.ts.
   */
  waterType?: WaterType;
  sourceLabel?: string;
  sourceUrl?: string;
  /**
   * Where each backfilled care value came from, keyed by the field it backs.
   *
   * One source per species stopped being true under spec 003: adult size
   * commonly comes from a Wikipedia article while minimum tank volume comes
   * from a store listing, and a card that credits only one of them is
   * miscrediting the other. Absent for the curated profiles, which cite a
   * single source for the whole profile.
   *
   * The sentence that proves each value is deliberately NOT here - it lives in
   * src/data/seed/species-care.json. The mart is inlined into the JS bundle,
   * and four quotes per species would add roughly 250KB to it.
   */
  careSources?: Record<string, { source: string; url?: string }>;
  /**
   * The card's portrait, and where it came from.
   *
   * Absent when no source could be found at all, and the card renders a
   * placeholder rather than pretending. `license` is present for Wikimedia
   * images and absent for vendor and web photos, which have none. See spec
   * 002 for why those are shipped and how they are credited.
   */
  portrait?: {
    url: string;
    provenance: 'wikimedia' | 'vendor' | 'web';
    license?: string;
    artist?: string;
    attributionUrl?: string;
    width?: number;
    height?: number;
  };
  /**
   * Taxonomic family, and what it implies about where the animal lives.
   *
   * Derived from the binomial via src/data/seed/taxonomy.ts, NOT from any
   * per-species source. Absent when the genus or family is unmapped, which the
   * catalog surfaces as "not recorded" rather than defaulting into a bucket.
   */
  family?: string;
  waterZone?: WaterZone;
  organismKind?: OrganismKind;
  /** Why this zone. Shown on the species page so the claim is answerable. */
  habitatNote?: string;
}

export interface CatalogMart {
  schemaVersion: 2;
  builtAt: string;
  species: CatalogEntry[];
}

const nn = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);
const num = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);
const split = (v: unknown): string[] =>
  !v ? [] : String(v).split('|').filter(Boolean);

/**
 * Overlay the verified care backfill onto one warehouse row.
 *
 * FILLS GAPS ONLY. A field the warehouse already has - which means a curated
 * profile wrote it - is never touched, so a scraped sentence can never
 * overrule a person. That single rule is what keeps the hand-written 47
 * authoritative without needing a list of which species they are.
 *
 * Returns the merged values plus the per-field credit for exactly the fields
 * this layer supplied, so the UI credits the backfill for its own work and
 * nothing else.
 */
function applyCareBackfill(
  row: {
    adultSizeIn?: number;
    minVolumeGal?: number;
    aggression?: string;
    tempMinC?: number;
    tempMaxC?: number;
  },
  care: CareRecord | undefined,
) {
  if (!care) return { ...row, careSources: undefined };

  const sources: Record<string, { source: string; url?: string }> = {};
  const credit = (field: string, v: { source: string; sourceUrl?: string }) => {
    sources[field] = { source: v.source, ...(v.sourceUrl ? { url: v.sourceUrl } : {}) };
  };

  const out = { ...row };
  if (out.adultSizeIn === undefined && care.adultSizeIn) {
    out.adultSizeIn = care.adultSizeIn.value;
    credit('adultSizeIn', care.adultSizeIn);
  }
  if (out.minVolumeGal === undefined && care.minVolumeGal) {
    out.minVolumeGal = care.minVolumeGal.value;
    credit('minVolumeGal', care.minVolumeGal);
  }
  if (out.aggression === undefined && care.aggression) {
    out.aggression = care.aggression.value;
    credit('aggression', care.aggression);
  }
  if (out.tempMinC === undefined && out.tempMaxC === undefined && care.tempC) {
    out.tempMinC = care.tempC.value.min;
    out.tempMaxC = care.tempC.value.max;
    credit('tempC', care.tempC);
  }

  return { ...out, careSources: Object.keys(sources).length ? sources : undefined };
}

/**
 * The species display name, in three layers of decreasing machine confidence.
 *
 *   1. A human override, if one exists. Always wins, always cited.
 *   2. The name re-derived from the vendor titles by the hardened parser.
 *   3. The scientific name.
 *
 * WHY RE-DERIVE HERE rather than trust the warehouse. `dim_species.common_name`
 * was written by an older, broken derivation that named 234 species after
 * vendor boilerplate ("- Tank Bred", "BredBy Aquatic Arts"). Rebuilding the
 * warehouse would fix it, but that needs a full re-scrape of every vendor, and
 * the raw snapshots are not committed. The titles themselves ARE committed, in
 * `dim_species.aliases`, so the fixed parser can be re-run over them here.
 *
 * This is idempotent, not a patch: on a full refresh the warehouse writes a
 * good name and running the same function over the same titles reproduces it.
 * The layer earns its keep either way, because it is also where the human
 * overrides are applied.
 */
function resolveName(
  speciesId: string,
  warehouseName: string,
  scientificName: string | undefined,
  aliases: string[],
  tally: { rederived: number; overridden: number; fellBack: number },
): string {
  const override = OVERRIDE_BY_ID.get(speciesId);
  if (override) {
    tally.overridden += 1;
    // A null override means "no trustworthy common name exists" - an explicit
    // human decision to show the binomial rather than invent something.
    if (override.commonName) return override.commonName;
    return scientificName ?? warehouseName;
  }

  if (isUsableName(warehouseName)) return warehouseName;

  const derived = deriveCommonName(aliases);
  if (derived) {
    tally.rederived += 1;
    return derived;
  }

  tally.fellBack += 1;
  return scientificName ?? warehouseName;
}

async function main() {
  const factPath = `${WAREHOUSE}/dim/dim_species.parquet`;
  if (!existsSync(factPath)) {
    throw new Error(`${factPath} not found - run "npm run warehouse" first.`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const instance = await DuckDBInstance.create(':memory:');
  const c = await instance.connect();

  // One portrait per species. Where a species somehow has several, the widest
  // wins - a catalog card is a large image and upscaling looks worse than
  // anything else on the screen.
  const rows = await c.runAndReadAll(`
    WITH best_image AS (
      SELECT species_id, url, provenance, license, artist, attribution_url, width, height,
             row_number() OVER (PARTITION BY species_id ORDER BY width DESC NULLS LAST) AS rn
      FROM read_parquet('${WAREHOUSE}/dim/dim_image.parquet')
      WHERE role = 'portrait' AND attribution_url IS NOT NULL
    )
    SELECT s.species_id, s.common_name, s.scientific_name, s.aliases,
           s.adult_size_in, s.min_volume_gal, s.aggression,
           s.temp_min_c, s.temp_max_c, s.predation_tags, s.water_type,
           s.temp_min_c, s.temp_max_c, s.predation_tags,
           s.source_label, s.source_url,
           i.url AS img_url, i.provenance AS img_provenance, i.license AS img_license,
           i.artist AS img_artist,
           i.attribution_url AS img_attribution, i.width AS img_width, i.height AS img_height
    FROM read_parquet('${WAREHOUSE}/dim/dim_species.parquet') s
    LEFT JOIN best_image i ON i.species_id = s.species_id AND i.rn = 1
    WHERE s.is_current
    ORDER BY s.common_name
  `);

  const naming = { rederived: 0, overridden: 0, fellBack: 0 };
  const careBackfill = loadCareBackfill();
  const careStats = { species: 0, fields: {} as Record<string, number> };

  const species: CatalogEntry[] = rows.getRowObjects()
    // Vendor typos minted the same fish two or three times over. Dropping the
    // non-canonical record here is what stops three "Blue Discus" cards.
    .filter((r) => !SYNONYM_IDS.has(String(r.species_id)))
    .map((r) => {
    const url = nn(r.img_url);
    const attribution = nn(r.img_attribution);
    const speciesId = String(r.species_id);
    const scientificName = nn(r.scientific_name);
    const aliases = split(r.aliases);
    const traits = traitsFor(scientificName);
    const cared = applyCareBackfill(
      {
        adultSizeIn: num(r.adult_size_in),
        minVolumeGal: num(r.min_volume_gal),
        aggression: nn(r.aggression),
        tempMinC: num(r.temp_min_c),
        tempMaxC: num(r.temp_max_c),
      },
      careBackfill.get(speciesId),
    );
    if (cared.careSources) {
      careStats.species++;
      for (const f of Object.keys(cared.careSources)) careStats.fields[f] = (careStats.fields[f] ?? 0) + 1;
    }

    return {
      speciesId,
      commonName: resolveName(speciesId, String(r.common_name), scientificName, aliases, naming),
      scientificName,
      aliases,
      ...(traits
        ? {
            family: traits.family,
            organismKind: traits.kind,
            habitatNote: traits.note,
            ...(traits.zone ? { waterZone: traits.zone } : {}),
          }
        : {}),
      adultSizeIn: cared.adultSizeIn,
      minVolumeGal: cared.minVolumeGal,
      aggression: cared.aggression,
      tempMinC: cared.tempMinC,
      tempMaxC: cared.tempMaxC,
      predationTags: split(r.predation_tags),
      ...(nn(r.water_type) ? { waterType: nn(r.water_type) as WaterType } : {}),
      // A backfilled species is no longer "no care profile yet", and saying so
      // on a card that now shows an adult size would be visibly untrue.
      sourceLabel: cared.careSources
        ? 'Backfilled from cited sources - each value links to the sentence it came from'
        : nn(r.source_label),
      sourceUrl: cared.careSources ? undefined : nn(r.source_url),
      ...(cared.careSources ? { careSources: cared.careSources } : {}),
      // Only ship a picture we can account for. The test used to be a licence
      // string; spec 002 changed it to traceability, because vendor photos
      // have no licence and are shipped deliberately with visible credit.
      ...(url && attribution
        ? {
            portrait: {
              url,
              provenance: (nn(r.img_provenance) ?? 'wikimedia') as 'wikimedia' | 'vendor' | 'web',
              license: nn(r.img_license),
              artist: nn(r.img_artist),
              attributionUrl: attribution,
              width: num(r.img_width),
              height: num(r.img_height),
            },
          }
        : {}),
    };
  });

  const mart: CatalogMart = {
    schemaVersion: 2,
    builtAt: new Date().toISOString(),
    species,
  };
  writeFileSync(`${OUT_DIR}/catalog.json`, JSON.stringify(mart, null, 2));

  const withArt = species.filter((s) => s.portrait).length;
  console.log('─── marts ───');
  console.log(`  species          ${species.length}`);
  console.log(`  with a portrait  ${withArt}  (${Math.round((withArt / species.length) * 100)}%)`);
  console.log(`  without          ${species.length - withArt}`);

  // Reported per field, never as one total. A single "care coverage" number
  // would hide that adult size fills in for most of the catalog while minimum
  // volume and temperament barely move, which is the whole shape of what this
  // backfill can and cannot do.
  const has = (p: (s: CatalogEntry) => boolean) => species.filter(p).length;
  const pct = (n: number) => `${Math.round((n / species.length) * 100)}%`.padStart(4);
  console.log('\n  care coverage             now   of which backfilled');
  const coverage: Array<[string, (s: CatalogEntry) => boolean, string]> = [
    ['adult size', (s) => s.adultSizeIn !== undefined, 'adultSizeIn'],
    ['minimum volume', (s) => s.minVolumeGal !== undefined, 'minVolumeGal'],
    ['temperament', (s) => s.aggression !== undefined, 'aggression'],
    ['temperature', (s) => s.tempMinC !== undefined, 'tempC'],
  ];
  for (const [label, present, field] of coverage) {
    const n = has(present);
    console.log(`    ${label.padEnd(22)} ${String(n).padStart(5)} ${pct(n)}   ${careStats.fields[field] ?? 0}`);
  }
  console.log(`    ${'any care data'.padEnd(22)} ${String(has((s) => s.adultSizeIn !== undefined || s.minVolumeGal !== undefined || s.aggression !== undefined)).padStart(5)}`);
  console.log(`    ${'species backfilled'.padEnd(22)} ${String(careStats.species).padStart(5)}`);

  const zoned = species.filter((s) => s.waterZone).length;
  // Reported split, because the pooled number hides which half is missing.
  // The taxonomy map is a freshwater map; the marine wing arrived with
  // LiveAquaria's 3,256 products and has no family coverage yet.
  const marine = species.filter((s) => s.waterType === 'marine');
  const rest = species.filter((s) => s.waterType !== 'marine');
  const zonedRest = rest.filter((s) => s.waterZone).length;
  console.log('\n  habitat (derived from family)');
  console.log(`    with a water zone         ${zoned}  (${Math.round((zoned / species.length) * 100)}%)`);
  console.log(`      fresh / brackish / none ${zonedRest} of ${rest.length}  (${Math.round((zonedRest / rest.length) * 100)}%)`);
  console.log(`      marine                  ${marine.filter((s) => s.waterZone).length} of ${marine.length}  <- the taxonomy map is freshwater`);
  console.log(`    family unmapped           ${species.filter((s) => !s.family).length}`);
  for (const k of ['fish', 'plant', 'invertebrate', 'amphibian', 'reptile'] as const) {
    const n = species.filter((s) => s.organismKind === k).length;
    if (n) console.log(`    ${k.padEnd(24)}  ${n}`);
  }

  console.log('\n  salinity (vendor tags first, then a single-kind vendor\'s declaration)');
  for (const t of ['freshwater', 'brackish', 'marine'] as const) {
    const n = species.filter((s) => s.waterType === t).length;
    console.log(`    ${t.padEnd(24)}  ${String(n).padStart(4)}  (${Math.round((n / species.length) * 100)}%)`);
  }
  const untyped = species.filter((s) => !s.waterType).length;
  console.log(`    not recorded              ${String(untyped).padStart(4)}  (${Math.round((untyped / species.length) * 100)}%)`);
  console.log(`\n  dropped ${SPECIES_SYNONYMS.length} duplicate species minted by vendor typos`);
  for (const s of SPECIES_SYNONYMS) console.log(`      ${s.speciesId} -> ${s.canonicalId}`);

  console.log('\n  naming');
  console.log(`    from the warehouse as-is  ${species.length - naming.rederived - naming.overridden - naming.fellBack}`);
  console.log(`    re-derived from titles    ${naming.rederived}`);
  console.log(`    human override            ${naming.overridden}`);
  console.log(`    fell back to the binomial ${naming.fellBack}`);

  // Verify the side effect actually happened. A mart that still contains
  // vendor boilerplate is the failure this whole layer exists to prevent, and
  // reporting "wrote catalog.json" over the top of it would be a lie.
  const problems = findProblems(species);
  if (problems.length > 0) {
    console.error(`\n  ✗ ${problems.length} quality problems remain: ${JSON.stringify(summarise(problems))}`);
    for (const p of problems.slice(0, 20)) {
      console.error(`      ${p.speciesId}: ${p.code} — ${p.detail}`);
    }
    if (problems.length > 20) console.error(`      …and ${problems.length - 20} more`);
    console.error('    Fix the parser or add a sourced entry to species-overrides.ts.');
  } else {
    console.log('\n  ✓ catalog quality gate passed');
  }

  console.log(`\n  wrote ${OUT_DIR}/catalog.json`);
  if (problems.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

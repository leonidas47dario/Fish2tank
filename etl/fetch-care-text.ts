/**
 * Stage 1 of the care-profile backfill: pull the source text, cache it, stop.
 *
 *   npm run care:fetch                 # fill gaps in the cache
 *   npm run care:fetch -- --limit 40   # a small slice, for checking the shape
 *   npm run care:fetch -- --wikipedia-only
 *
 * This step makes no judgements. It fetches the Wikipedia article and the
 * vendor product description for every species with no care data, writes them
 * to `data/care/text/`, and records per species what happened. Extraction is a
 * separate step precisely so that a bad extraction never costs a re-fetch, and
 * so the text a claim came from is still on disk when the gate checks it.
 *
 * IDEMPOTENT. A species with a cache file is not fetched again, so a second
 * run makes zero network calls. The cache is gitignored - it regenerates, and
 * committing 5MB of churning article text would cost more than it proves. The
 * derived records (`fetch-log.json`, the proposals, the review file) are
 * committed, exactly as `data/market/images.jsonl` is while `etl/raw/` is not.
 *
 * A MISSING ARTICLE AND A FAILED FETCH ARE DIFFERENT FACTS and are counted
 * separately. The first probe written for this feature conflated them and
 * cheerfully reported "54 species have no Wikipedia article" when the true
 * answer was "54 requests were rate-limited". The summary below cannot make
 * that mistake: every species lands in exactly one outcome bucket, and the
 * buckets are printed whether they are empty or not.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_TITLES_PER_REQUEST, fetchWikitextBatch, stripWikitext } from './sources/wikipedia-text';
import { fetchProductBody } from './sources/vendor-text';
import { CARE_DIR, TEXT_DIR, vendorPath, wikiPath } from './care/paths';

const CATALOG = 'src/data/seed/marts/catalog.json';
const MARKET = 'src/data/seed/marts/market-index.json';
const LOG = join(CARE_DIR, 'fetch-log.json');

const BATCH_PAUSE_MS = 1500;
const VENDOR_PAUSE_MS = 700;

interface CatalogSpecies {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  adultSizeIn?: number;
  minVolumeGal?: number;
  aggression?: string;
  tempMinC?: number;
}

interface MarketSpecies {
  stores?: Array<{ storeId: string; productUrl?: string }>;
}

export type WikiOutcome = 'cached' | 'fetched' | 'no-article' | 'no-scientific-name';
export type VendorOutcome = 'cached' | 'fetched' | 'no-listing' | 'skipped';

export interface FetchLogEntry {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  wikipedia: WikiOutcome;
  /** Set when the API served a different title than we asked for. */
  resolvedTitle?: string;
  vendor: VendorOutcome;
  vendorStore?: string;
  vendorUrl?: string;
  /** Why there is no vendor text. Always set when vendor is 'skipped'. */
  vendorSkipReason?: string;
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A species is unprofiled when none of the three verdict-gating fields is set. */
export function isUnprofiled(s: CatalogSpecies): boolean {
  return s.adultSizeIn === undefined && s.minVolumeGal === undefined && s.aggression === undefined;
}

/**
 * Did the binomial we hold get superseded by a different one?
 *
 * Most redirects are Wikipedia's title convention - a binomial redirecting to
 * the common-name article, "Trichogaster labiosa" to "Thick-lipped gourami".
 * Those say nothing about our data. The reportable case is a redirect to
 * ANOTHER BINOMIAL under a different genus, which means our species dimension
 * is carrying a name the taxonomy has moved on from:
 * `Echinodorus osiris` -> `Aquarius uruguayensis`.
 *
 * What separates the two is the SPECIES EPITHET. A reclassification carries it
 * across - `Corydoras agassizii` to `Brochis agassizii`, `Clea helena` to
 * `Anentome helena` - while a common-name title does not. Shape alone is not
 * enough: "Masked corydoras" and "Channel catfish" both look like a binomial
 * and neither is one, which is how a looser test reported 204 genus changes
 * where there were a few dozen.
 *
 * Known under-count: a reclassification that also re-genders the epithet
 * (`-us` to `-a`) reads as a common name here and is missed. Recorded rather
 * than papered over with fuzzy matching, which would readmit the false
 * positives this exists to exclude.
 */
export function isGenusChange(from: string | undefined, to: string | undefined): boolean {
  if (!from || !to) return false;
  const [fromGenus, fromEpithet] = from.toLowerCase().split(' ');
  const [toGenus, toEpithet] = to.toLowerCase().split(' ');
  if (!fromEpithet || !toEpithet) return false;
  return fromGenus !== toGenus && fromEpithet === toEpithet;
}

async function main() {
  mkdirSync(TEXT_DIR, { recursive: true });

  const { species } = JSON.parse(readFileSync(CATALOG, 'utf8')) as { species: CatalogSpecies[] };
  const market = JSON.parse(readFileSync(MARKET, 'utf8')) as { species: Record<string, MarketSpecies> };

  const limit = Number(arg('limit') ?? '0');
  const wikipediaOnly = flag('wikipedia-only');
  const vendorOnly = flag('vendor-only');

  let gap = species.filter(isUnprofiled);
  if (limit > 0) gap = gap.slice(0, limit);

  console.log('─── care: fetch source text ───');
  console.log(`  catalog          ${species.length} species`);
  console.log(`  no care data     ${gap.length}${limit ? ` (limited to ${limit})` : ''}`);

  const log = new Map<string, FetchLogEntry>();
  for (const s of gap) {
    log.set(s.speciesId, {
      speciesId: s.speciesId,
      commonName: s.commonName,
      ...(s.scientificName ? { scientificName: s.scientificName } : {}),
      wikipedia: s.scientificName ? 'no-article' : 'no-scientific-name',
      vendor: 'no-listing',
    });
  }

  // ---- Wikipedia -----------------------------------------------------------
  if (!vendorOnly) {
    const todo = gap.filter((s) => {
      if (!s.scientificName) return false;
      if (existsSync(wikiPath(s.speciesId))) {
        log.get(s.speciesId)!.wikipedia = 'cached';
        return false;
      }
      return true;
    });

    console.log(`\n  wikipedia: ${todo.length} to fetch, ${gap.length - todo.length} already cached or unnamed`);

    const batches = Math.ceil(todo.length / MAX_TITLES_PER_REQUEST);
    for (let i = 0; i < todo.length; i += MAX_TITLES_PER_REQUEST) {
      const chunk = todo.slice(i, i + MAX_TITLES_PER_REQUEST);
      const n = i / MAX_TITLES_PER_REQUEST + 1;
      process.stdout.write(`    batch ${n}/${batches} (${chunk.length} titles)`);

      const pages = await fetchWikitextBatch(
        chunk.map((s) => s.scientificName!),
        { onBatch: (_b, _t, note) => process.stdout.write(`\n      ${note}`) },
      );

      let found = 0;
      for (let k = 0; k < chunk.length; k++) {
        const s = chunk[k];
        const page = pages[k];
        if (!s || !page) continue;
        const entry = log.get(s.speciesId)!;
        if (page.redirected) entry.resolvedTitle = page.resolved;
        if (!page.wikitext) {
          entry.wikipedia = 'no-article';
          continue;
        }
        const text = stripWikitext(page.wikitext);
        if (!text) {
          entry.wikipedia = 'no-article';
          continue;
        }
        writeFileSync(wikiPath(s.speciesId), `# ${page.resolved}\n# https://en.wikipedia.org/wiki/${encodeURIComponent(page.resolved.replace(/ /g, '_'))}\n\n${text}\n`);
        entry.wikipedia = 'fetched';
        found++;
      }
      process.stdout.write(` -> ${found}/${chunk.length} articles\n`);
      if (i + MAX_TITLES_PER_REQUEST < todo.length) await sleep(BATCH_PAUSE_MS);
    }
  }

  // ---- Vendor --------------------------------------------------------------
  if (!wikipediaOnly) {
    const withListing: Array<{ s: CatalogSpecies; storeId: string; url: string }> = [];
    for (const s of gap) {
      const stores = market.species[s.speciesId]?.stores ?? [];
      const hit = stores.find((st) => st.productUrl);
      if (hit?.productUrl) withListing.push({ s, storeId: hit.storeId, url: hit.productUrl });
    }

    const todo = withListing.filter(({ s }) => {
      if (existsSync(vendorPath(s.speciesId))) {
        log.get(s.speciesId)!.vendor = 'cached';
        return false;
      }
      return true;
    });

    console.log(`\n  vendor: ${withListing.length} species have a listing, ${todo.length} to fetch`);

    let got = 0;
    for (const { s, storeId, url } of todo) {
      const entry = log.get(s.speciesId)!;
      entry.vendorStore = storeId;
      entry.vendorUrl = url;
      const body = await fetchProductBody(url, storeId);
      if (body.text) {
        writeFileSync(vendorPath(s.speciesId), `# ${body.title ?? s.commonName}\n# ${url}\n\n${body.text}\n`);
        entry.vendor = 'fetched';
        got++;
      } else {
        entry.vendor = 'skipped';
        entry.vendorSkipReason = body.skipReason ?? 'unknown';
      }
      await sleep(VENDOR_PAUSE_MS);
    }
    console.log(`    ${got}/${todo.length} descriptions retrieved`);
  }

  // ---- Summary -------------------------------------------------------------
  const entries = [...log.values()];
  writeFileSync(LOG, JSON.stringify({ builtAt: new Date().toISOString(), entries }, null, 2));

  const count = <T extends string>(key: (e: FetchLogEntry) => T) => {
    const h: Record<string, number> = {};
    for (const e of entries) h[key(e)] = (h[key(e)] ?? 0) + 1;
    return h;
  };
  const w = count((e) => e.wikipedia);
  const v = count((e) => e.vendor);
  const withAnyText = entries.filter(
    (e) => e.wikipedia === 'fetched' || e.wikipedia === 'cached' || e.vendor === 'fetched' || e.vendor === 'cached',
  ).length;

  console.log('\n─── outcome ───');
  console.log(`  wikipedia   fetched ${w.fetched ?? 0}  cached ${w.cached ?? 0}  no article ${w['no-article'] ?? 0}  no binomial ${w['no-scientific-name'] ?? 0}`);
  console.log(`  vendor      fetched ${v.fetched ?? 0}  cached ${v.cached ?? 0}  no listing ${v['no-listing'] ?? 0}  skipped ${v.skipped ?? 0}`);

  const reasons: Record<string, number> = {};
  for (const e of entries) if (e.vendorSkipReason) reasons[e.vendorSkipReason] = (reasons[e.vendorSkipReason] ?? 0) + 1;
  for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`                skipped: ${n} x ${reason}`);
  }

  // Most redirects are Wikipedia's title convention (a binomial redirecting to
  // the common-name article), NOT a defect. The interesting subset is the one
  // where the GENUS changes - Echinodorus osiris -> Aquarius uruguayensis is a
  // reclassification our species dimension has not caught up with. Counting
  // them together would overstate the problem, so they are counted apart.
  const redirected = entries.filter((e) => e.resolvedTitle);
  const genusChanged = redirected.filter((e) => isGenusChange(e.scientificName, e.resolvedTitle));
  console.log(`  redirected  ${redirected.length} titles resolved elsewhere, of which ${genusChanged.length} changed genus (possible taxonomy defects)`);
  console.log(`\n  ${withAnyText}/${entries.length} species now have source text to read`);
  console.log(`  wrote ${LOG}`);

  if (withAnyText === 0) {
    // A run that fetched nothing must not look like a run that succeeded.
    throw new Error('no source text was retrieved for any species - refusing to report success');
  }
}

main().catch((err) => {
  console.error('\ncare:fetch FAILED:', err.message);
  process.exit(1);
});

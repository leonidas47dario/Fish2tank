/**
 * Turn subagent portrait proposals into shipped image rows, or into review items.
 *
 *   npm run ingest:portraits
 *
 * Reads  data/market/portrait-proposals.jsonl
 * Writes data/market/images.jsonl          (accepted, merged)
 *        data/market/portrait-review.jsonl (rejected, low-confidence, taxonomy notes)
 *
 * Every proposal is DOWNLOADED FROM THIS MACHINE before it is accepted. A URL
 * a subagent could read but the build host cannot fetch is worthless, and this
 * is where that fails fast and visibly instead of at bundle time.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { checkProposal, type Downloaded, type Proposal } from './proposal-gate';
import { IMAGES_PATH, isBundleableUrl, mergeRows, readRows, toRow, writeRows } from './images-jsonl';
import type { SpeciesImage } from './sources/wikimedia';

const PROPOSALS = 'data/market/portrait-proposals.jsonl';
const REVIEW = 'data/market/portrait-review.jsonl';
const UA = 'Fish2TankResearch/0.1 (personal aquarium field guide; +https://github.com/leonidas47dario/Fish2tank)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch far enough to know it is a real image of a usable size.
 *
 * Chromium decodes it rather than a header parser, for the same reason
 * build-portraits.ts uses it: it handles every format these hosts serve,
 * including the ones a minimal library does not.
 */
async function download(url: string, page: Page): Promise<Downloaded | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.log(`\n      download -> HTTP ${res.status}`);
      return null;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!contentType.startsWith('image/')) {
      return { contentType, width: 0, height: 0, bytes: buf.length };
    }
    const dims = await page.evaluate(async ({ b64, mime }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${b64}`;
      try {
        await img.decode();
      } catch {
        return { w: 0, h: 0 };
      }
      return { w: img.naturalWidth, h: img.naturalHeight };
    }, { b64: buf.toString('base64'), mime: contentType });
    return { contentType, width: dims.w, height: dims.h, bytes: buf.length };
  } catch (e) {
    console.log(`\n      download threw: ${e instanceof Error ? e.message : 'error'}`);
    return null;
  }
}

async function main() {
  if (!existsSync(PROPOSALS)) {
    throw new Error(`${PROPOSALS} not found - the subagent stage has not run.`);
  }

  const proposals = readFileSync(PROPOSALS, 'utf8').trim().split('\n')
    .filter(Boolean).map((l) => JSON.parse(l) as Proposal);
  const existing = readRows();
  const claimed = new Set(existing.map((r) => r.url));

  console.log(`  ${proposals.length} proposals, against ${existing.length} existing image rows\n`);

  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage();

  const accepted: SpeciesImage[] = [];
  const review: object[] = [];
  const tally = { accept: 0, review: 0, reject: 0 };

  for (const p of proposals) {
    process.stdout.write(`  ${p.species_id.padEnd(34)}`);

    // Taxonomy findings are recorded whatever the verdict, and before any
    // early `continue` below. They are a separate problem from the picture
    // and must not be lost with a rejected proposal.
    if (p.corrected_scientific_name) {
      review.push({
        species_id: p.species_id,
        kind: 'taxonomy',
        corrected_scientific_name: p.corrected_scientific_name,
        gate_reason: 'proposed name correction, NOT applied - see spec 002 Scope/Out',
      });
    }

    // Format is checked before the network call: a .tif passes every other
    // rule and then fails silently at downscale time, which is how five rows
    // sat in the committed data for months looking healthy.
    if (p.url && !isBundleableUrl(p.url)) {
      tally.reject += 1;
      review.push({ ...p, verdict: 'reject', gate_reason: `format the bundler cannot decode: ${p.url}` });
      console.log(`reject  format the bundler cannot decode`);
      continue;
    }

    const got = p.url ? await download(p.url, page) : null;
    const v = checkProposal(p, got, claimed);
    tally[v.verdict] += 1;

    if (v.verdict === 'accept') {
      claimed.add(p.url!);
      accepted.push({
        speciesId: p.species_id,
        role: 'portrait',
        source: new URL(p.attribution_url!).hostname,
        provenance: p.provenance,
        url: p.url!,
        license: p.license ?? undefined,
        artist: p.artist ?? undefined,
        attributionUrl: p.attribution_url!,
        width: got!.width,
        height: got!.height,
        retrievedAt: new Date().toISOString(),
      });
      console.log(`accept  ${p.provenance}  ${got!.width}x${got!.height}`);
    } else {
      review.push({ ...p, verdict: v.verdict, gate_reason: v.reason });
      console.log(`${v.verdict}  ${v.reason}`);
    }

    await sleep(200);
  }

  await browser.close();

  writeRows(mergeRows(existing, accepted.map(toRow)));
  writeFileSync(REVIEW, review.map((r) => JSON.stringify(r)).join('\n') + '\n');

  console.log('\n─── ingest ───');
  console.log(`  accepted  ${tally.accept}`);
  console.log(`  review    ${tally.review}`);
  console.log(`  rejected  ${tally.reject}`);
  console.log(`  wrote ${IMAGES_PATH} and ${REVIEW}`);
  if (tally.accept === 0 && proposals.length > 0) {
    // A run that processes proposals and ships nothing must not read as success.
    console.log('\n  WARNING: every proposal was rejected. Check network reachability first.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

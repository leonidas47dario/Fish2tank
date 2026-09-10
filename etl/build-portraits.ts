/**
 * Download and downscale the licensed portraits into bundled assets.
 *
 * WHY THIS EXISTS. Referencing Wikimedia URLs directly looked fine until the
 * catalog was opened without a network: 41 remote images hang, and an
 * offline-first PWA that cannot draw its own library offline has failed at the
 * one thing it promised (NFR-02). Hotlinking someone else's CDN on every load
 * is poor manners besides.
 *
 * So the portraits are fetched once, downscaled to card size, and committed.
 * Attribution travels with them in the mart - a local copy does not make the
 * licence go away.
 *
 *   npm run portraits
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { readRows, isBundleable, type ImageRow } from './images-jsonl';
import { CORE_DIR, TAIL_DIR, coreSpecies, tierFor, type ListingCounts } from './portrait-tiers';

const IMAGES = 'data/market/images.jsonl';
const MARKET = 'src/data/seed/marts/market-index.json';
/**
 * Which species the app should look for under `public/portraits/`.
 *
 * Written from what is ACTUALLY ON DISK at the end of the run, not from the
 * rows that were wanted. A species whose download failed has a row and no file,
 * and `portraitAsset` must not offer a URL for it - that would turn "this
 * species has no portrait" into "this picture failed to load", which `Plate`
 * deliberately draws differently.
 */
const TAIL_MANIFEST = 'src/data/seed/assets/portrait-tail.json';

/**
 * Cards are landscape now, not portrait.
 *
 * The grid used to lay out 150px-wide tiles, so 320 covered 2x displays. The
 * tiles are 3:2 and ~300 CSS px wide since 88% of these photographs are
 * landscape and a 3:4 box was cropping the fish's head off, and at that size
 * 320px source visibly softens on a retina screen.
 *
 * 480 is a measured compromise, not a guess. The three options were built and
 * weighed, because these are precached in full and the install is the cost:
 *
 *   320px   9.6 MB   1x on the new tile - visibly soft on any retina screen
 *   480px  ~13 MB    1.5x - the chosen default
 *   640px  23.5 MB   2x - crisp, but 2.5x the precache for the last half-step
 *
 * A catalog that cannot draw itself offline has failed NFR-02, so every one of
 * these ships to the device. Tripling that download to sharpen a 300px grid
 * thumbnail is not a trade worth making; 1.5x closes most of the visible gap
 * for a third of the cost.
 */
const MAX_WIDTH = 480;
const QUALITY = 0.68;

/**
 * Wikimedia rate-limits bursts, and a first run without this got 429s on 7 of
 * 41 images. Same discipline as the vendor client: pace the requests, honour
 * Retry-After, back off, give up rather than hammer.
 */
const DELAY_MS = 400;
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchImage(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Fish2TankResearch/0.1 (personal aquarium field guide; +https://github.com/leonidas47dario/Fish2tank)',
    },
  });
  if (res.ok) return res;

  const retryable = res.status === 429 || res.status >= 500;
  if (!retryable || attempt >= MAX_ATTEMPTS - 1) throw new Error(`HTTP ${res.status}`);

  const header = res.headers.get('retry-after');
  const retryAfter = header === null ? NaN : Number(header);
  const waitMs = Number.isFinite(retryAfter) && retryAfter >= 0
    ? retryAfter * 1000
    : 1_000 * 2 ** attempt;
  await sleep(waitMs);
  return fetchImage(url, attempt + 1);
}

/** Total listings per species, for ranking the core set. Absent file = no ranking. */
function listingCounts(): ListingCounts {
  if (!existsSync(MARKET)) return new Map();
  const market = JSON.parse(readFileSync(MARKET, 'utf8')) as {
    species: Record<string, { totalListings?: number }>;
  };
  return new Map(Object.entries(market.species ?? {}).map(([id, v]) => [id, v.totalListings ?? 0]));
}

/** Species ids that already have a file in `dir`. */
function present(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)));
}

async function main() {
  if (!existsSync(IMAGES)) throw new Error(`${IMAGES} not found - run "npm run images" first.`);

  const rows: ImageRow[] = readRows();
  const core = coreSpecies(rows, listingCounts());
  mkdirSync(CORE_DIR, { recursive: true });
  mkdirSync(TAIL_DIR, { recursive: true });

  /*
   * RECONCILE RATHER THAN REBUILD - spec 062.
   *
   * This used to `rmSync` the whole directory and re-download every row, which
   * at 2,027 rows is a two-hour run to change nothing, and an interrupted one
   * leaves the app with NO portraits rather than with stale ones. The reason
   * for the demolition was real - a species dropped from the catalog must not
   * leave an orphan in the bundle - so that is kept, by deleting the files that
   * are no longer wanted instead of all of them.
   *
   * A species that has changed TIER is a delete on one side and a download on
   * the other, which falls out of this without a special case.
   */
  const wanted = new Map<string, 'core' | 'tail'>();
  for (const row of rows) {
    if (!row.attribution_url || !isBundleable(row)) continue;
    wanted.set(row.species_id, tierFor(row.species_id, core));
  }

  let removed = 0;
  let moved = 0;
  for (const [dir, tier] of [[CORE_DIR, 'core'], [TAIL_DIR, 'tail']] as const) {
    const other = tier === 'core' ? TAIL_DIR : CORE_DIR;
    for (const id of present(dir)) {
      const want = wanted.get(id);
      if (want === tier) continue;
      // A species that changed TIER already has its bytes - the file is
      // identical either side, only the directory decides whether it is
      // precached. Moving it is why introducing the split costs no downloads
      // at all, where delete-and-refetch would have re-fetched 811 images that
      // were already on disk.
      if (want) { renameSync(join(dir, `${id}.jpg`), join(other, `${id}.jpg`)); moved += 1; continue; }
      unlinkSync(join(dir, `${id}.jpg`));
      removed += 1;
    }
  }
  const have = new Set([...present(CORE_DIR), ...present(TAIL_DIR)]);
  console.log(`  ${have.size} on disk, ${moved} moved between tiers, ${removed} removed, ${wanted.size} wanted`);

  /*
   * Only launch a browser if there is something to decode.
   *
   * Chromium is here to downscale downloaded images, and once the run is
   * incremental the common case is that nothing needs downloading at all - a
   * re-run, or the tier split itself, which moved 811 files and fetched none.
   * Launching anyway made a no-op run FAIL on a machine whose pinned browser
   * build is missing, which is a failure with nothing behind it.
   */
  const toFetch = rows.filter((r) =>
    r.attribution_url && isBundleable(r) && wanted.has(r.species_id) && !have.has(r.species_id));
  /*
   * ONE BROWSER DOES NOT SURVIVE A THOUSAND IMAGES.
   *
   * Measured on 2026-09-09: a run of 1,016 downloads died at image 461 and
   * then reported `Target page, context or browser has been closed` for the
   * remaining 260 - a 36% failure rate that was really ONE failure repeated,
   * because a dead browser is not a per-image problem and the catch block
   * treated it as one. Disk was fine (30 GB free); Chromium had simply grown
   * through hundreds of full-resolution decodes.
   *
   * Two changes, and the second is the one that matters. The page is RECYCLED
   * every RECYCLE_EVERY images so the memory never accumulates that far, and a
   * closed-browser error is caught as FATAL rather than counted alongside a
   * .tif that would not decode - it relaunches once and retries, and gives up
   * loudly if that fails too. A run that reports 255 failures it could have
   * avoided is worse than one that stops and says why.
   */
  const RECYCLE_EVERY = 150;
  const launch = () => chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const isDead = (e: unknown) =>
    /Target page, context or browser has been closed|Target closed|browser has disconnected/i
      .test(e instanceof Error ? e.message : String(e));

  let browser = toFetch.length > 0 ? await launch() : undefined;
  let page = await browser?.newPage();
  let sinceRecycle = 0;

  /** A fresh page, and a fresh browser when the old one is gone. */
  const renew = async () => {
    try { await browser?.close(); } catch { /* already gone */ }
    browser = await launch();
    page = await browser.newPage();
    sinceRecycle = 0;
  };

  let saved = 0;
  let failed = 0;
  let skipped = 0;
  let bytes = 0;

  /**
   * Record which species the app should look for under `public/portraits/`.
   *
   * WRITTEN AS THE RUN GOES, not only at the end. This file is the app's only
   * index of the tail - `portraitAsset` returns undefined for anything absent
   * from it - so a run that downloads 300 portraits and is then interrupted
   * used to leave 300 images on disk, in the build, and invisible. That
   * happened twice here, killed by session pauses, and both times the fix was
   * to regenerate this by hand afterwards. A crash should not need a human to
   * notice it.
   */
  const writeManifest = () => {
    const tail = [...present(TAIL_DIR)].sort();
    writeFileSync(TAIL_MANIFEST, `${JSON.stringify(tail, null, 0)}\n`);
  };

  /**
   * Fetch one row's image, downscale it in Chromium and write it to its tier.
   *
   * Extracted so the retry-after-a-browser-crash path runs exactly the same
   * code as the first attempt - a retry that drifts from what it is retrying
   * is a second bug waiting to happen.
   */
  const downloadInto = async (row: ImageRow) => {
    const res = await fetchImage(row.url);
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    const mime = res.headers.get('content-type') ?? 'image/jpeg';

    // Chromium does the decode/resize/encode. It handles every format
    // Commons serves, including the ones a minimal image library would not.
    const out = await page!.evaluate(
      async ({ b64, mime, maxWidth, quality }) => {
        /*
         * DECODE STRAIGHT TO SIZE, rather than decoding at full resolution and
         * then shrinking.
         *
         * `new Image()` materialises the whole bitmap first. The catalog holds
         * a 7319x10319 herbarium scan (75.5 MP, ~300 MB as RGBA) and an 81.4 MP
         * one, and they killed the renderer outright - twice, at exactly the
         * same species both times, which is what proved it was one poison
         * image rather than memory creeping up over a long run.
         *
         * `createImageBitmap` with `resizeWidth` lets the decoder downsample as
         * it reads, so the full-size bitmap never exists. Measured p50 is 2 MP
         * and p99 is 33 MP, so this matters for about a dozen rows - but a
         * dozen rows were enough to end a 1,016-image run at number 461.
         */
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        const probe = await createImageBitmap(blob);
        const scale = Math.min(1, maxWidth / probe.width);
        const w = Math.round(probe.width * scale);
        const h = Math.round(probe.height * scale);
        probe.close();

        const bitmap = await createImageBitmap(blob, {
          resizeWidth: w, resizeHeight: h, resizeQuality: 'high',
        });
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return { data: canvas.toDataURL('image/jpeg', quality).split(',')[1]!, w, h };
      },
      { b64, mime, maxWidth: MAX_WIDTH, quality: QUALITY },
    );

    const buf = Buffer.from(out.data, 'base64');
    const dir = wanted.get(row.species_id) === 'core' ? CORE_DIR : TAIL_DIR;
    writeFileSync(join(dir, `${row.species_id}.jpg`), buf);
    bytes += buf.length;
    saved += 1;
    console.log(`ok  ${out.w}x${out.h}  ${(buf.length / 1024).toFixed(0)}KB`);
  };

  for (const row of rows) {
    // Never bundle a picture we cannot account for, and never one the
    // downscaler cannot decode. The first test used to be a licence string;
    // spec 002 changed it to traceability, because vendor and web photos have
    // no licence and are shipped deliberately with visible credit. The second
    // test is why 5 of the old 700 rows silently never produced a file: they
    // were .tif, which Chromium cannot decode.
    if (!row.attribution_url) continue;
    if (!isBundleable(row)) continue;
    // Already on disk in the tier it belongs to. This is what makes a re-run
    // free rather than a two-hour no-op.
    if (have.has(row.species_id)) { skipped += 1; continue; }
    if (sinceRecycle >= RECYCLE_EVERY) { await renew(); writeManifest(); }
    sinceRecycle += 1;
    process.stdout.write(`  ${row.species_id.padEnd(28)}`);
    try {
      await downloadInto(row);
    } catch (e) {
      // A dead browser is not this image's fault and will not be the next
      // image's fault either - every remaining iteration would fail the same
      // way. Relaunch once and retry this species; a second failure stops the
      // run rather than logging a thousand identical lines.
      if (isDead(e)) {
        console.log('browser died - relaunching');
        await renew();
        try {
          await downloadInto(row);
          continue;
        } catch (again) {
          // Twice on the SAME image means the image is the problem, not the
          // browser. Skip it and carry on - one poison pill must not block the
          // remaining hundreds, which is the failure this whole block exists
          // to stop.
          await renew();
          failed += 1;
          console.log(`  ${row.species_id.padEnd(28)}skipped (kills the renderer: `
            + `${again instanceof Error ? again.message.slice(0, 40) : 'error'})`);
          continue;
        }
      }
      failed += 1;
      // A missing portrait degrades to the card's silhouette, which is a
      // deliberate state - not a crash.
      console.log(`failed (${e instanceof Error ? e.message : 'error'})`);
    }
    await sleep(DELAY_MS);
  }

  await browser?.close();

  console.log('\n─── portraits ───');
  console.log(`  downloaded  ${saved}`);
  console.log(`  already had ${skipped}`);
  console.log(`  moved tier  ${moved}`);
  console.log(`  removed     ${removed}`);
  console.log(`  failed      ${failed}`);
  console.log(`  new bytes   ${(bytes / 1e6).toFixed(2)} MB  (avg ${(bytes / Math.max(1, saved) / 1024).toFixed(0)}KB)`);
  writeManifest();
  console.log(`  core        ${present(CORE_DIR).size} in ${CORE_DIR}/  (bundled and precached)`);
  console.log(`  tail        ${present(TAIL_DIR).size} in ${TAIL_DIR}/  (fetched on first view)`);
  console.log(`  wrote       ${TAIL_MANIFEST}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

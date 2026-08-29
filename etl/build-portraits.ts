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
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readRows, isBundleable, type ImageRow } from './images-jsonl';

const IMAGES = 'data/market/images.jsonl';
const OUT_DIR = 'src/data/seed/assets/portraits';

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

async function main() {
  if (!existsSync(IMAGES)) throw new Error(`${IMAGES} not found - run "npm run images" first.`);

  const rows: ImageRow[] = readRows();

  // Rebuild from scratch so a species dropped from the catalog does not leave
  // an orphaned image behind in the bundle.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage();

  let saved = 0;
  let failed = 0;
  let bytes = 0;

  for (const row of rows) {
    // Never bundle a picture we cannot account for, and never one the
    // downscaler cannot decode. The first test used to be a licence string;
    // spec 002 changed it to traceability, because vendor and web photos have
    // no licence and are shipped deliberately with visible credit. The second
    // test is why 5 of the old 700 rows silently never produced a file: they
    // were .tif, which Chromium cannot decode.
    if (!row.attribution_url) continue;
    if (!isBundleable(row)) continue;
    process.stdout.write(`  ${row.species_id.padEnd(28)}`);
    try {
      const res = await fetchImage(row.url);
      const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
      const mime = res.headers.get('content-type') ?? 'image/jpeg';

      // Chromium does the decode/resize/encode. It handles every format
      // Commons serves, including the ones a minimal image library would not.
      const out = await page.evaluate(
        async ({ b64, mime, maxWidth, quality }) => {
          const img = new Image();
          img.src = `data:${mime};base64,${b64}`;
          await img.decode();
          const scale = Math.min(1, maxWidth / img.naturalWidth);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          return {
            data: canvas.toDataURL('image/jpeg', quality).split(',')[1]!,
            w: canvas.width,
            h: canvas.height,
          };
        },
        { b64, mime, maxWidth: MAX_WIDTH, quality: QUALITY },
      );

      const buf = Buffer.from(out.data, 'base64');
      writeFileSync(join(OUT_DIR, `${row.species_id}.jpg`), buf);
      bytes += buf.length;
      saved += 1;
      console.log(`ok  ${out.w}x${out.h}  ${(buf.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      failed += 1;
      // A missing portrait degrades to the card's silhouette, which is a
      // deliberate state - not a crash.
      console.log(`failed (${e instanceof Error ? e.message : 'error'})`);
    }
    await sleep(DELAY_MS);
  }

  await browser.close();

  console.log('\n─── portraits ───');
  console.log(`  bundled  ${saved}`);
  console.log(`  failed   ${failed}`);
  console.log(`  total    ${(bytes / 1e6).toFixed(2)} MB  (avg ${(bytes / Math.max(1, saved) / 1024).toFixed(0)}KB)`);
  console.log(`\n  wrote ${OUT_DIR}/`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

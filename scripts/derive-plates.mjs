/**
 * Derive one plate colour per bundled portrait, and write them as tokens.
 *
 *   node scripts/derive-plates.mjs
 *   -> src/theme/plates.css
 *
 * Why this exists
 * ---------------
 * A portrait never sits directly on the canvas; it sits on a plate. Across a
 * 120-image sample of the bundled portraits, 10% are cut-outs on white, 20%
 * sit on near-black and 70% are full-bleed, so no single letterbox colour can
 * serve all three. A fixed dark mat haloes the white cut-outs; a fixed light
 * one frames every dark photograph in a bright rectangle.
 *
 * So the plate is DERIVED from each photograph, and this is the derivation:
 *
 *   1. sample the border ring, which is the part of the frame that is
 *      background by definition
 *   2. take the MODE in a quantised RGB cube rather than the mean or median.
 *      An early pass used the median and produced a saturated chartreuse for
 *      a planted-tank shot: the average of green plants and brown gravel is a
 *      colour that appears nowhere in the image.
 *   3. convert to OKLCH and clamp chroma to 0.04, so a plate is always a
 *      near-neutral tint of the photograph and never becomes a colour field
 *
 * What this file does NOT decide is how light the plate may be. It emits the
 * image's own lightness as --plate-l, and the theme clamps it between
 * --plate-l-min and --plate-l-max (see tokens.css). That split is what keeps
 * PRD 7.3 true: baking an absolute lightness here would mean re-running this
 * derivation for every theme, which is exactly the migration 7.3 forbids.
 *
 * Pixel decoding runs in headless Chromium because it is the only image
 * decoder this repo already depends on. The colour maths runs in the page too,
 * so only ~1,000 small numbers cross the boundary.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORTRAITS = resolve(ROOT, 'src/data/seed/assets/portraits');
const OUT = resolve(ROOT, 'src/theme/plates.css');

/** How far into the frame counts as "the edge". */
const RING_PX = 2;
/** Longest edge the image is decoded at. The ring survives the downscale. */
const DECODE_MAX = 200;
/** A plate may never be more saturated than this. */
const CHROMA_CAP = 0.04;

const files = readdirSync(PORTRAITS).filter((f) => f.endsWith('.jpg')).sort();
if (files.length === 0) {
  console.error(`No portraits found in ${PORTRAITS}. Run \`npm run portraits\` first.`);
  process.exit(1);
}
console.log(`deriving plates for ${files.length} portraits`);

/* The page reads pixels back out of a canvas, which the browser permits only
   for same-origin images. Chromium gives every file:// document its own opaque
   origin, so a file:// page taints the canvas on the first drawImage and
   getImageData throws for all 1,011. Hence a throwaway HTTP server on an
   ephemeral port: one origin, no taint, and no fixed port to collide with a
   parallel session's dev server. */
const server = createServer((req, res) => {
  const name = basename(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!name.endsWith('.jpg')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>plate derivation</title>');
    return;
  }
  res.writeHead(200, { 'content-type': 'image/jpeg' });
  createReadStream(resolve(PORTRAITS, name)).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${origin}/`);

const derived = await page.evaluate(
  async ({ files, RING_PX, DECODE_MAX, CHROMA_CAP }) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    /** sRGB 0-255 -> OKLCH. Björn Ottosson's matrices, unmodified. */
    function oklch(r, g, b) {
      const lin = (c) => {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const R = lin(r), G = lin(g), B = lin(b);
      const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
      const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
      const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
      const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
      const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      const C = Math.hypot(A, Bb);
      let H = (Math.atan2(Bb, A) * 180) / Math.PI;
      if (H < 0) H += 360;
      return { L, C, H };
    }

    const out = [];
    const failed = [];

    for (const file of files) {
      const img = new Image();
      img.src = file;
      try {
        await img.decode();
      } catch {
        failed.push(file);
        continue;
      }

      const scale = Math.min(1, DECODE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(8, Math.round(img.naturalWidth * scale));
      const h = Math.max(8, Math.round(img.naturalHeight * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      let px;
      try {
        px = ctx.getImageData(0, 0, w, h).data;
      } catch (e) {
        failed.push(`${file} (canvas tainted: ${e.message})`);
        continue;
      }

      /* Mode over a 16-per-channel cube. Coarse on purpose: a real background
         is thousands of near-identical pixels, and a bucket fine enough to
         separate them is a bucket that lets gradient noise win. */
      const counts = new Map();
      const sums = new Map();
      const bump = (x, y) => {
        const i = (y * w + x) * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const s = sums.get(key) ?? [0, 0, 0];
        s[0] += r; s[1] += g; s[2] += b;
        sums.set(key, s);
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const onRing = x < RING_PX || y < RING_PX || x >= w - RING_PX || y >= h - RING_PX;
          if (onRing) bump(x, y);
        }
      }

      let best = -1, bestKey = null;
      for (const [key, n] of counts) if (n > best) { best = n; bestKey = key; }
      const [sr, sg, sb] = sums.get(bestKey);
      /* The bucket's own mean, not its centre: the centre is a colour nothing
         in the ring actually is. */
      const { L, C, H } = oklch(sr / best, sg / best, sb / best);

      out.push({
        id: file.replace(/\.jpg$/, ''),
        l: Math.round(L * 1000) / 1000,
        c: Math.round(Math.min(C, CHROMA_CAP) * 1000) / 1000,
        h: Math.round(H),
        ringShare: Math.round((best / ((w * h) - Math.max(0, (w - 2 * RING_PX)) * Math.max(0, (h - 2 * RING_PX)))) * 100),
      });
    }
    return { out, failed };
  },
  { files, RING_PX, DECODE_MAX, CHROMA_CAP },
);

await browser.close();
server.close();

if (derived.failed.length > 0) {
  console.warn(`could not decode ${derived.failed.length}:`, derived.failed.slice(0, 5).join(', '));
}
/* Never write a plates.css that silently covers a fraction of the library: a
   missing rule is a species falling back to the theme default, which looks
   like a design decision rather than a broken build. */
if (derived.out.length < files.length * 0.98) {
  console.error(`only ${derived.out.length} of ${files.length} portraits derived. Refusing to write a partial ${OUT}.`);
  process.exit(1);
}

const rules = derived.out
  .map((p) => `[data-species='${p.id}']{--plate-l:${p.l};--plate-c:${p.c};--plate-h:${p.h}}`)
  .join('\n');

const lightest = derived.out.reduce((a, b) => (b.l > a.l ? b : a));
const darkest = derived.out.reduce((a, b) => (b.l < a.l ? b : a));

writeFileSync(
  OUT,
  `/*
 * GENERATED by scripts/derive-plates.mjs. Do not edit by hand.
 *
 * One plate per bundled portrait: the mode of that photograph's border ring,
 * in OKLCH, with chroma capped at ${CHROMA_CAP}.
 *
 * These are the IMAGE's facts. How light a plate may actually be is the
 * THEME's fact, and lives in tokens.css as --plate-l-min / --plate-l-max,
 * which clamp the value below. That is why one generated file serves all
 * three visual territories and a theme change stays a token swap (PRD 7.3).
 *
 * ${derived.out.length} portraits. Lightness runs ${darkest.l} (${darkest.id})
 * to ${lightest.l} (${lightest.id}).
 */
${rules}
`,
  'utf8',
);

console.log(`wrote ${OUT}`);
console.log(`  ${derived.out.length} plates, L ${darkest.l}-${lightest.l}`);
const dark = derived.out.filter((p) => p.l < 0.3).length;
const light = derived.out.filter((p) => p.l > 0.75).length;
console.log(`  ${dark} dark-edged, ${light} light-edged, ${derived.out.length - dark - light} in between`);

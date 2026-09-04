/**
 * Derive every app icon from one source illustration.
 *
 *   node scripts/make-icons.mjs
 *
 * WHY A SCRIPT AND NOT A ONE-OFF. There are five outputs at four sizes and two
 * different corner treatments, and the next time the mark changes somebody has
 * to reproduce all of it exactly. `design/logo-source.png` plus this file is
 * the whole recipe.
 *
 * THE CORNER PROBLEM, which is the only interesting part. The source is
 * supplied pre-rounded: a squircle of artwork on OPAQUE BLACK, no alpha. Shipped
 * as-is that is wrong twice over - iOS applies its own mask and the black
 * corners show through as dark wedges, and an Android `maskable` icon gets
 * rounded a second time, biting further into artwork that has already been cut.
 *
 * A maskable icon is supposed to be full-bleed and let the platform choose the
 * shape. So the corners are BLED rather than filled: each row's outermost
 * non-black pixel is extended outward to the edge. Filling with one flat colour
 * would band visibly, because the background is a vertical gradient from a mid
 * blue at the top to near-black at the bottom.
 *
 * Chromium does the decode, resize and encode, the same way build-portraits.ts
 * does - it handles what a browser handles, which is what these have to render
 * in anyway.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'design/logo-source.png';
const ICON_DIR = 'public/icons';
const PUBLIC_DIR = 'public';

/**
 * A pixel is "the baked-in corner" only if it is essentially pure black. The
 * artwork's own darkest tones are the bottom-left rock, which is a very dark
 * blue rather than black, so a tight threshold separates the two without
 * eating any of the illustration.
 */
const BLACK = 12;

const OUTPUTS = [
  { file: join(ICON_DIR, 'icon-192.png'), size: 192 },
  { file: join(ICON_DIR, 'icon-512.png'), size: 512 },
  // iOS does not read the web manifest for the home-screen icon; it wants a
  // <link rel="apple-touch-icon">, and 180 is the size it asks for. The app had
  // none at all before this, so an installed PWA got a screenshot of the page.
  { file: join(PUBLIC_DIR, 'apple-touch-icon.png'), size: 180 },
  // The browser tab. A 1254px illustration at 32px is mush, so 48 is the floor
  // that still reads as a fish rather than a smudge.
  { file: join(PUBLIC_DIR, 'favicon.png'), size: 48 },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
const b64 = readFileSync(SOURCE).toString('base64');

mkdirSync(ICON_DIR, { recursive: true });
for (const { file, size } of OUTPUTS) {
  const data = await page.evaluate(async ({ b, size, black }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b}`;
    await img.decode();

    // Bleed at full resolution, then downscale, so the resize samples real
    // edge colour rather than a black fringe.
    const full = document.createElement('canvas');
    full.width = img.naturalWidth; full.height = img.naturalHeight;
    const fx = full.getContext('2d');
    fx.drawImage(img, 0, 0);

    const px = fx.getImageData(0, 0, full.width, full.height);
    const d = px.data;
    const isBlack = (i) => d[i] <= black && d[i + 1] <= black && d[i + 2] <= black;
    for (let y = 0; y < full.height; y += 1) {
      const row = y * full.width * 4;
      let first = 0;
      while (first < full.width && isBlack(row + first * 4)) first += 1;
      if (first >= full.width) continue;            // an entirely black row: leave it
      let last = full.width - 1;
      while (last > first && isBlack(row + last * 4)) last -= 1;
      for (let x = 0; x < first; x += 1) {
        for (let c = 0; c < 4; c += 1) d[row + x * 4 + c] = d[row + first * 4 + c];
      }
      for (let x = last + 1; x < full.width; x += 1) {
        for (let c = 0; c < 4; c += 1) d[row + x * 4 + c] = d[row + last * 4 + c];
      }
    }
    fx.putImageData(px, 0, 0);

    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    const ox = out.getContext('2d');
    ox.imageSmoothingQuality = 'high';
    ox.drawImage(full, 0, 0, size, size);
    return out.toDataURL('image/png').split(',')[1];
  }, { b: b64, size, black: BLACK });

  const buf = Buffer.from(data, 'base64');
  writeFileSync(file, buf);
  console.log(`  ${String(size).padStart(4)}px  ${(buf.length / 1024).toFixed(1).padStart(6)} KB  ${file}`);
}

await browser.close();
console.log(`\n  from ${SOURCE}`);

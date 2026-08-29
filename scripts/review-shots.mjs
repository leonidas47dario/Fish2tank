/**
 * Viewport screenshots for design review, plus the numbers behind them.
 *
 * Separate from smoke.mjs on purpose: that one proves the PRD scenario still
 * works end to end, this one answers "what does it look like, and how long
 * does the catalog take to become interactive". A full-page shot of a 2,178
 * species grid is a 233,000px PNG nobody can look at.
 *
 *   node scripts/review-shots.mjs
 *
 * Env: BASE_URL, SHOTS.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const SHOTS = process.env.SHOTS ?? 'review-shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

async function shot(route, name, { scrollTo = 0, wait = 700 } = {}) {
  await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
  if (scrollTo) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

// --- Catalog: how long until the grid is on screen -------------------------
const t0 = Date.now();
await page.goto(`${BASE}/#/catalog`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tile', { timeout: 30000 });
const firstTile = Date.now() - t0;
await page.waitForTimeout(900);

/*
 * What the windowing is worth, measured rather than asserted.
 *
 * Counting "how many tiles are skipped" does not work: reading any geometry
 * inside a content-visibility:auto subtree forces that subtree to render, so
 * the measurement destroys the thing it is measuring, and
 * checkVisibility({contentVisibilityAuto}) reported every tile as rendered
 * either way. What IS observable is the cost. Force a full style and layout
 * pass over the document and time it, with the property on and then disabled;
 * the difference is what content-visibility is actually buying.
 */
const forcedReflow = () => page.evaluate(() => {
  const t = performance.now();
  document.body.style.zoom = '1.0001';
  void document.documentElement.offsetHeight;
  document.body.style.zoom = '';
  void document.documentElement.offsetHeight;
  return Math.round(performance.now() - t);
});

const metrics = await page.evaluate(() => ({
  tiles: document.querySelectorAll('.tile').length,
  docHeight: document.documentElement.scrollHeight,
}));
const withCv = await forcedReflow();
await page.addStyleTag({ content: '.tile{content-visibility:visible !important}' });
await page.waitForTimeout(400);
const withoutCv = await forcedReflow();

console.log(`catalog: ${metrics.tiles} tiles, doc ${metrics.docHeight.toLocaleString()}px, `
  + `first tile at ${firstTile}ms`);
console.log(`catalog: full reflow ${withCv}ms windowed vs ${withoutCv}ms unwindowed `
  + `(${(withoutCv / Math.max(withCv, 1)).toFixed(1)}x)`);

// Reload to drop the injected override before shooting anything.
await page.goto(`${BASE}/#/catalog`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tile');
await page.waitForTimeout(700);
await page.screenshot({ path: `${SHOTS}/catalog-top.png` });
await page.evaluate(() => window.scrollTo(0, 1400));
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/catalog-scrolled.png` });

// The secondary filter sheet.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.getByRole('button', { name: /^Filters/ }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/catalog-filters.png` });

// --- The rest --------------------------------------------------------------
await shot('', 'home');
await shot('tanks', 'tanks');
await shot('journal', 'journal');
await shot('catch', 'catch');

// A species with a full care profile, and one discovered from a listing.
await shot('species/sp_jaguar_cichlid', 'species-profiled');
await shot('species/sp_jaguar_cichlid', 'species-profiled-market', { scrollTo: 950 });
await shot('species/sp_gymnarchus_niloticus', 'species-bare');

// The specimen the smoke run leaves behind.
const specimenId = await page.evaluate(async () => {
  const req = indexedDB.open('fish2tank');
  const dbh = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
  const tx = dbh.transaction('specimens', 'readonly');
  const all = await new Promise((ok) => {
    const r = tx.objectStore('specimens').getAll();
    r.onsuccess = () => ok(r.result);
  });
  return all[0]?.id;
});
if (specimenId) {
  await shot(`specimen/${specimenId}`, 'specimen-top');
  await shot(`specimen/${specimenId}`, 'specimen-verdict', { scrollTo: 620 });
}

console.log('CONSOLE ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();

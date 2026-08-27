/**
 * End-to-end smoke test: drives the PRD section 10 Panther scenario through
 * the real built app in a real browser, and screenshots each step.
 *
 * This is the check the unit tests cannot make. It is what caught the bug
 * where a screening run's per-tank timestamps differed by a millisecond and
 * the 75G silently vanished from the results list.
 *
 *   npm run build && npm run preview &
 *   node scripts/smoke.mjs
 *
 * Env: BASE_URL (default http://localhost:4173), SHOTS (screenshot dir),
 * CHROMIUM_PATH (defaults to playwright's own download).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const SHOTS = process.env.SHOTS ?? 'smoke-shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });
console.log('HOME h1:', await page.locator('h1').first().innerText());

// --- Catch -----------------------------------------------------------------
await page.getByRole('link', { name: /Catch something/i }).click();
await page.waitForTimeout(400);

// A tiny valid PNG stands in for the store photo.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHUlEQVR42mNk+M9Qz0AEYBxVSF+FjIyMDEQoBABtqgb9pC1lQwAAAABJRU5ErkJggg==',
  'base64');
await page.setInputFiles('#capture', { name: 'panther.png', mimeType: 'image/png', buffer: png });
await page.waitForURL(/#\/specimen\//, { timeout: 10000 });
await page.waitForTimeout(500);
console.log('DRAFT URL:', page.url());
await page.screenshot({ path: `${SHOTS}/02-draft.png`, fullPage: true });

// --- Identify --------------------------------------------------------------
await page.fill('#species-search', 'managuense');
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Jaguar Cichlid/i }).click();
await page.waitForTimeout(400);
await page.fill('#nickname', 'the Panther');
await page.locator('#nickname').blur();
await page.waitForTimeout(300);

// --- Price and size --------------------------------------------------------
await page.fill('#asking', '100');
await page.fill('#member', '75');
await page.fill('#size', '6');
await page.getByRole('button', { name: /^Record$/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/03-identified.png`, fullPage: true });

// --- Evaluate --------------------------------------------------------------
await page.getByRole('button', { name: /Check my tanks/i }).click();
await page.waitForTimeout(900);
const verdicts = await page.locator('.badge').allInnerTexts();
console.log('VERDICT BADGES:', JSON.stringify(verdicts.slice(0, 12)));
await page.screenshot({ path: `${SHOTS}/04-evaluate.png`, fullPage: true });

// Expand a factor to prove the working is inspectable.
const details = page.locator('details').first();
if (await details.count()) { await details.click(); await page.waitForTimeout(300); }
await page.screenshot({ path: `${SHOTS}/05-factors.png`, fullPage: true });

// --- Reveal ----------------------------------------------------------------
await page.getByRole('button', { name: /^Reveal$/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/06-reveal.png`, fullPage: true });
const tierText = await page.locator('.tier').first().innerText();
console.log('TIER:', tierText);

// --- Theme comparison (PRD 7.6) -------------------------------------------
for (const theme of ['playful-collector', 'expedition-fieldbook']) {
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.locator(`input[name="theme"][value="${theme}"]`).check();
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/07-${theme}.png`, fullPage: true });
}

// --- Other screens ---------------------------------------------------------
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
await page.locator('input[name="theme"][value="midnight-aquarium"]').check();
await page.waitForTimeout(300);
for (const [route, name] of [['collection','08-collection'],['tanks','09-tanks'],['journal','10-journal'],['settings','11-settings']]) {
  await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

console.log('CONSOLE ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();

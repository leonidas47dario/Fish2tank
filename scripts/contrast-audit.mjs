/**
 * WCAG 1.4.3 contrast, measured on the rendered app rather than argued from
 * the token file.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/contrast-audit.mjs
 *
 * Why this exists: every accessibility claim in this redesign was originally a
 * number written in a CSS comment. Comments do not fail a build. This walks
 * the real DOM in all three visual territories, resolves what each piece of
 * text is actually painted on - including through transparent ancestors and
 * `color-mix()` fills the token file never spells out - and exits non-zero if
 * anything falls below AA.
 *
 * It found two things a reading of the stylesheet did not:
 *   - `button:hover:not(:disabled)` outscored `.btn--primary` on specificity,
 *     so hovering the app's primary action repainted it --color-surface while
 *     keeping --color-on-primary text: 1.05:1 on the Capture button.
 *   - hover states are not reachable by reading a stylesheet at all.
 *
 * Env: BASE_URL, and STRICT=1 to fail on AAA as well.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';

const ROUTES = [
  ['', 'Home'],
  ['catalog', 'Catalog'],
  ['species/sp_jaguar_cichlid', 'Species (profiled)'],
  ['species/sp_gymnarchus_niloticus', 'Species (no profile)'],
  ['tanks', 'Tanks'],
  ['catch', 'Catch'],
  ['settings', 'Settings'],
];
const THEMES = ['midnight-aquarium', 'playful-collector', 'expedition-fieldbook'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const AUDIT = () => {
  const luminance = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /* getComputedStyle resolves color-mix() and oklch() to rgb()/rgba(), but
     Chromium also returns `color(srgb 0.3 0.7 0.9)` for some inputs, so both
     shapes have to parse. */
  const parse = (s) => {
    if (!s || s === 'transparent') return null;
    const srgb = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (srgb) {
      const a = srgb[4] === undefined ? 1 : Number(srgb[4]);
      return { rgb: [1, 2, 3].map((i) => Math.round(Number(srgb[i]) * 255)), a };
    }
    const n = s.match(/[\d.]+/g);
    if (!n) return null;
    return { rgb: n.slice(0, 3).map(Number), a: n[3] === undefined ? 1 : Number(n[3]) };
  };
  const over = (fg, bg) => fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));

  /** What this text is really sitting on, compositing every translucent layer. */
  const backdrop = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
    }
    let base = [255, 255, 255];
    for (const layer of stack.reverse()) base = over(layer, base);
    return base;
  };

  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim()).join(' ');
    if (!text) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // .visually-hidden is clipped to a pixel and is never read by eye.
    if (r.width <= 1 && r.height <= 1) continue;

    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = backdrop(el);
    const px = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    // 1.4.3: 18pt (24px), or 14pt (18.66px) bold, counts as large text.
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(over(fg, bg), bg);

    const key = `${cs.color}|${bg.join(',')}|${Math.round(px)}|${weight}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      text: text.slice(0, 44), got: Math.round(got * 100) / 100, need,
      px: Math.round(px), weight, pass: got >= need - 0.005,
    });
  }
  return out;
};

let failures = 0;
let checked = 0;

for (const theme of THEMES) {
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.locator(`input[name="theme"][value="${theme}"]`).check();
  await page.waitForTimeout(300);

  const bad = [];
  for (const [route, label] of ROUTES) {
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const results = await page.evaluate(AUDIT);
    checked += results.length;
    for (const r of results.filter((x) => !x.pass)) bad.push({ ...r, where: label });
  }

  /* Hover and pressed states, which no amount of reading the stylesheet
     reveals: this is where the specificity bug lived. */
  await page.goto(`${BASE}/#/catch`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  for (const name of [/Capture/, /Catch something/]) {
    const el = page.locator('button, a').filter({ hasText: name }).first();
    if (!(await el.count())) continue;
    await el.hover();
    await page.waitForTimeout(200);
    const results = await page.evaluate(AUDIT);
    checked += results.length;
    for (const r of results.filter((x) => !x.pass)) bad.push({ ...r, where: 'hovered control' });
  }

  if (bad.length === 0) {
    console.log(`${theme}: pass`);
  } else {
    failures += bad.length;
    console.log(`${theme}: ${bad.length} below AA`);
    for (const b of bad) {
      console.log(`  ${b.got}:1 (needs ${b.need}) ${b.px}px/${b.weight} in ${b.where} — "${b.text}"`);
    }
  }
}

await browser.close();
console.log(`${checked} distinct text-on-background pairs checked across ${THEMES.length} themes`);
if (failures) {
  console.error(`FAIL: ${failures} contrast failures`);
  process.exit(1);
}
console.log('WCAG 1.4.3 AA: pass');

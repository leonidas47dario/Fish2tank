/**
 * Does a fresh deploy show up on the FIRST load?
 *
 *   npm run build && npm run verify:sw
 *
 * A service worker bug is invisible to unit tests: everything imports fine,
 * every screen renders, and the site simply serves yesterday's build. This
 * catches it the only way it can be caught - by serving a real build to a real
 * browser, deploying a second one underneath it, and reloading once.
 *
 * Guard against a test that cannot fail: reverting src/pwa.ts's controllerchange
 * reload must make this report FAIL. It did when the fix was written.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const BASE = '/Fish2tank/uat/';
const PORT = 8099;
const DIST = 'dist';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
};

/** Rewrite index.html and its precache revision - exactly what a deploy does. */
function deploy(title, revision) {
  const html = join(DIST, 'index.html');
  writeFileSync(html, readFileSync(html, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`));
  const sw = join(DIST, 'sw.js');
  writeFileSync(sw, readFileSync(sw, 'utf8')
    .replace(/url:"index\.html",revision:"[^"]*"/, `url:"index.html",revision:"${revision}"`));
}

const server = createServer((req, res) => {
  // Strip the base so dist/ can be served as if it were deployed under it.
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(BASE.length);
  const file = join(DIST, normalize(path === '' || path.endsWith('/') ? `${path}index.html` : path));
  readFile(file, (err, body) => {
    if (err) return res.writeHead(404).end();
    // No caching: the browser HTTP cache would mask the very behaviour under test.
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body);
  });
});

const original = { html: readFileSync(join(DIST, 'index.html'), 'utf8'), sw: readFileSync(join(DIST, 'sw.js'), 'utf8') };
let pass = false;

try {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await (await browser.newContext()).newPage();

  await page.goto(`http://127.0.0.1:${PORT}${BASE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  console.log(`  build A     "${await page.title()}", now under service worker control`);

  deploy('Fish2Tank BUILD-B', 'b'.repeat(32));
  console.log('  deployed    build B');

  await page.reload({ waitUntil: 'load' });
  pass = await page
    .waitForFunction(() => document.title.includes('BUILD-B'), null, { timeout: 20_000 })
    .then(() => true, () => false);
  console.log(`  after one reload the page shows "${await page.title()}"`);

  await browser.close();
} finally {
  server.close();
  writeFileSync(join(DIST, 'index.html'), original.html);
  writeFileSync(join(DIST, 'sw.js'), original.sw);
}

console.log(pass ? '\n  PASS - a new deploy is visible on the first load' : '\n  FAIL - the first load still served the old build');
if (!pass) process.exitCode = 1;

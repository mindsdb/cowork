// Reusable visual-fixture screenshotter.
//
// Boots the renderer dev server with the fixture Vite config (which
// aliases keycloak-js to a no-op stub so the onLoad:'login-required'
// auth redirect never fires), opens a fixture HTML page in Chromium via
// Playwright, and captures full-page screenshots in light + dark themes.
//
// Usage:
//   node scripts/shoot-fixture.mjs --fixture datavault --out /tmp/shots \
//     --wait "Connect Postgres" [--label after] [--port 5199]
//
// The fixture must expose ?theme=dark|light on its URL (see the
// visual-fixtures README). To diff before/after, run once on your branch
// (--label after), git-checkout the base version of the surface files,
// run again (--label before), then compare with ImageMagick:
//   magick compare -metric AE before-light.png after-light.png diff.png
//
// Requires: playwright + vite (both already dev-dependencies).

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const fixture = arg('fixture'); // e.g. "datavault" → datavault-fixture.html
const outDir = arg('out', path.join(REPO, 'fixture-shots'));
const waitText = arg('wait'); // visible text that proves the gallery mounted
const label = arg('label', 'shot'); // filename prefix (e.g. before/after)
const port = Number(arg('port', '5199'));

if (!fixture || !waitText) {
  console.error('usage: node scripts/shoot-fixture.mjs --fixture <name> --wait "<visible text>" [--out <dir>] [--label <prefix>] [--port <n>]');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// 1. Boot the dev server with the fixture config (keycloak stubbed).
//    NB: no BUILD_TARGET=web — the web SPA-fallback middleware would
//    rewrite the fixture URL to index-web.html; host.ts still resolves
//    web mode at runtime when no Electron bridge is present.
// Spawn the local vite binary directly (not via npx) in its own process
// group so we can reliably tear the whole tree down afterwards.
const viteBin = path.join(REPO, 'node_modules', '.bin', 'vite');
const vite = spawn(
  viteBin,
  ['dev', 'src/renderer', '-c', 'src/renderer/vite.fixture.config.ts', '--port', String(port), '--strictPort'],
  { cwd: REPO, stdio: 'ignore', detached: true },
);
const kill = () => { try { process.kill(-vite.pid, 'SIGKILL'); } catch { /* noop */ } };
process.on('exit', kill);
process.on('SIGINT', () => { kill(); process.exit(1); });

const base = `http://localhost:${port}/${fixture}-fixture.html`;

// 2. Wait for the server to answer.
let up = false;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(base);
    if (res.ok) { up = true; break; }
  } catch { /* not ready */ }
  await sleep(500);
}
if (!up) { console.error(`dev server never came up at ${base}`); kill(); process.exit(1); }

// 3. Screenshot each theme.
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 2 });
// Belt-and-suspenders: stub the loopback API so nothing redirects.
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('auth.staging.mindshub.ai') || u.includes('/auth/realms/')) return route.abort();
  if (u.includes('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  return route.continue();
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));

for (const theme of ['light', 'dark']) {
  await page.goto(`${base}?theme=${theme}`, { waitUntil: 'load' });
  await page.waitForSelector(`text=${waitText}`, { timeout: 15000 });
  await page.waitForTimeout(500); // fonts/animation settle
  const file = path.join(outDir, `${label}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('wrote', file);
}

await browser.close();
kill();

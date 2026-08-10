// Tier-1 packaging file-smoke Verifies the electron-builder
// --dir output contains what the app needs to boot — the class of break that
// tsc and unit tests structurally cannot catch (packaging can silently drop
// or misplace files). No Electron launch; launch smoke is Tier-2/Playwright.
//
// Usage: node scripts/verify-pack.mjs   (after `npm run pack`)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar'); // dep of electron-builder

const failures = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { failures.push(msg); console.error(`  ✗ ${msg}`); };

// ── Locate the packaged app ─────────────────────────────────────────────────
const releaseDir = 'release';
let resourcesDir = null;

if (process.platform === 'darwin') {
  const macDirs = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).filter((d) => d.startsWith('mac'))
    : [];
  for (const dir of macDirs) {
    const apps = fs.readdirSync(path.join(releaseDir, dir)).filter((f) => f.endsWith('.app'));
    if (apps.length) {
      resourcesDir = path.join(releaseDir, dir, apps[0], 'Contents', 'Resources');
      break;
    }
  }
} else {
  const winDir = path.join(releaseDir, 'win-unpacked');
  if (fs.existsSync(winDir)) resourcesDir = path.join(winDir, 'resources');
}

if (!resourcesDir || !fs.existsSync(resourcesDir)) {
  console.error(`✗ no packaged app found under ${releaseDir}/ — run \`npm run pack\` first`);
  process.exit(1);
}
console.log(`Checking ${resourcesDir}`);

// ── app.asar: main entry + renderer bundle ──────────────────────────────────
const asarPath = path.join(resourcesDir, 'app.asar');
if (!fs.existsSync(asarPath)) {
  fail('app.asar missing');
} else {
  ok('app.asar exists');
  const entries = new Set(asar.listPackage(asarPath).map((p) => p.replace(/\\/g, '/')));

  // package.json "main" — without it the app is a brick.
  const mainEntry = '/dist/main/main/index.js';
  entries.has(mainEntry) ? ok(`main entry ${mainEntry}`) : fail(`main entry ${mainEntry} missing`);

  // Renderer index + at least one built JS asset (vite output).
  const rendererIndex = '/dist/renderer/index.html';
  entries.has(rendererIndex) ? ok(`renderer ${rendererIndex}`) : fail(`renderer ${rendererIndex} missing`);

  const hasRendererJs = [...entries].some(
    (e) => e.startsWith('/dist/renderer/assets/') && e.endsWith('.js'),
  );
  hasRendererJs ? ok('renderer assets/*.js present') : fail('no built JS under /dist/renderer/assets/');

  // Renderer static dirs referenced at runtime (fonts, logos).
  for (const dir of ['/dist/renderer/fonts', '/dist/renderer/logos']) {
    [...entries].some((e) => e.startsWith(`${dir}/`)) ? ok(`${dir}/ present`) : fail(`${dir}/ missing`);
  }
}

// ── extraResources ──────────────────────────────────────────────────────────
fs.existsSync(path.join(resourcesDir, 'assets'))
  ? ok('extraResources assets/ present')
  : fail('extraResources assets/ missing');

// ENG-1241: server-credentials.json must never be embedded in the signed
// macOS bundle — Contents/Resources there is root-owned, so the app could
// never delete it after provisioning into Keychain (it's staged outside the
// bundle by a pkgbuild postinstall script instead). Windows keeps a
// win-only extraResources override and reads/deletes the file in place,
// since its per-user install location doesn't have that problem.
const credPath = path.join(resourcesDir, 'server-credentials.json');
if (process.platform === 'darwin') {
  !fs.existsSync(credPath)
    ? ok('server-credentials.json correctly absent from the mac bundle (ENG-1241)')
    : fail('server-credentials.json must not be embedded in the mac bundle (ENG-1241 regression)');
} else {
  fs.existsSync(credPath)
    ? ok('server-credentials.json present (Windows-only extraResources)')
    : fail('server-credentials.json missing from the Windows package');
}

// ── Verdict ─────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ pack smoke FAILED (${failures.length} problem${failures.length > 1 ? 's' : ''})`);
  process.exit(1);
}
console.log('\n✓ pack smoke passed');

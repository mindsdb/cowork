// Check npm run pack output for boot-required files without launching Electron.
// Packaging omissions are not caught by typecheck or unit tests.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const failures = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { failures.push(msg); console.error(`  ✗ ${msg}`); };

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

const asarPath = path.join(resourcesDir, 'app.asar');
if (!fs.existsSync(asarPath)) {
  fail('app.asar missing');
} else {
  ok('app.asar exists');
  const entries = new Set(asar.listPackage(asarPath).map((p) => p.replace(/\\/g, '/')));

  const mainEntry = '/dist/main/main/index.js';
  entries.has(mainEntry) ? ok(`main entry ${mainEntry}`) : fail(`main entry ${mainEntry} missing`);

  const rendererIndex = '/dist/renderer/index.html';
  entries.has(rendererIndex) ? ok(`renderer ${rendererIndex}`) : fail(`renderer ${rendererIndex} missing`);

  const hasRendererJs = [...entries].some(
    (e) => e.startsWith('/dist/renderer/assets/') && e.endsWith('.js'),
  );
  hasRendererJs ? ok('renderer assets/*.js present') : fail('no built JS under /dist/renderer/assets/');

  for (const dir of ['/dist/renderer/fonts', '/dist/renderer/logos']) {
    [...entries].some((e) => e.startsWith(`${dir}/`)) ? ok(`${dir}/ present`) : fail(`${dir}/ missing`);
  }
}

fs.existsSync(path.join(resourcesDir, 'assets'))
  ? ok('extraResources assets/ present')
  : fail('extraResources assets/ missing');

// Never embed server-credentials.json in a signed macOS bundle: root-owned resources cannot be
// deleted
// after keychain provisioning. pkg postinstall stages it outside; Windows uses its writable
// per-user install.
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

if (failures.length) {
  console.error(`\n✗ pack smoke FAILED (${failures.length} problem${failures.length > 1 ? 's' : ''})`);
  process.exit(1);
}
console.log('\n✓ pack smoke passed');

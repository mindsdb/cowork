#!/usr/bin/env node
// Bakes build-time values into a generated TypeScript file that gets compiled
// into the Electron main bundle. Called as a `prebuild:main` npm hook so
// packaged apps carry the values that were set at build time.
//
// Values baked:
//   BUILD_COWORK_SERVER_REF / BUILD_ANTON_REF — git branch/tag for server install
//   BUILD_MINDS_API_URL — backend API base URL (the renderer gets it via Vite;
//     the main process is plain tsc and can't see VITE_ vars at runtime)
//   BUILD_APP_VERSION — app display version, used by app.setVersion() so
//     Electron's app.getVersion() matches the renderer's __APP_VERSION__.
//     Prod builds pass the CalVer release tag via VITE_APP_VERSION; staging/dev
//     builds leave it empty and both sides fall back to git describe.
//
// Priority at runtime: process.env > baked value > default
// In dev mode the env var from the Makefile wins and this file is never
// needed — but it's safe to generate it anyway.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'src', 'main');
const outFile = join(outDir, 'build-channel.gen.ts');

const coworkRef = (process.env.COWORK_SERVER_REF || '').trim();
const antonRef = (process.env.ANTON_REF || '').trim();
// The renderer gets VITE_MINDS_API_URL baked by Vite; the main process is
// plain tsc and can't see it at runtime, so bake it here too.
const mindsApiUrl = (process.env.VITE_MINDS_API_URL || '').trim();

// App version: explicit CI value > git describe > unchanged (keep package.json
// as-is). Same resolution order as vite.config.ts so Electron's
// app.getVersion() and the renderer's __APP_VERSION__ always agree.
let appVersion = (process.env.VITE_APP_VERSION || '').trim().replace(/^v/, '');
if (!appVersion) {
  try {
    appVersion = execSync('git describe --tags --match "v[0-9]*"', { cwd: __dirname, encoding: 'utf-8' }).trim().replace(/^v/, '');
  } catch { /* no tags — leave package.json version as-is */ }
}

// Stamp package.json so Electron's app.getVersion() returns the correct
// version. This runs at build time (prebuild:main) in a disposable CI
// checkout — the change is never committed. Locally it's harmless: the
// file is already gitignored-by-convention during builds, and `git checkout`
// restores it.
if (appVersion) {
  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  if (pkg.version !== appVersion) {
    pkg.version = appVersion;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`[gen-build-channel] stamped package.json version → ${appVersion}`);
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outFile,
  [
    '// Auto-generated at build time by scripts/gen-build-channel.mjs — do not edit',
    `export const BUILD_COWORK_SERVER_REF = '${coworkRef}';`,
    `export const BUILD_ANTON_REF = '${antonRef}';`,
    `export const BUILD_MINDS_API_URL = '${mindsApiUrl}';`,
    '',
  ].join('\n'),
);

console.log(
  `[gen-build-channel] COWORK_SERVER_REF=${coworkRef || '(unset)'} ANTON_REF=${antonRef || '(unset)'} MINDS_API_URL=${mindsApiUrl || '(unset)'} APP_VERSION=${appVersion || '(package.json default)'}`,
);

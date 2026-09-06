#!/usr/bin/env node
// prebuild:main bakes installer settings into TypeScript because main cannot read Vite variables at
// runtime.
// Runtime precedence: process.env, baked value, default. Keep package.json SemVer separate from
// display CalVer.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EXPECTED_API_ORIGIN } from './channel-origins.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'src', 'main');
const outFile = join(outDir, 'build-channel.gen.ts');

// Remove stale feed metadata so direct/local packages cannot inherit a prior prod or stable feed.
rmSync(join(__dirname, '..', 'build', 'app-update.yml'), { force: true });

const coworkRef = (process.env.COWORK_SERVER_REF || '').trim();
const antonRef = (process.env.ANTON_REF || '').trim();
// pypi uses versioned release artifacts; git follows the selected branch/tag.
const serverChannel = (process.env.COWORK_SERVER_CHANNEL || '').trim().toLowerCase();
// Bake a minimum released server version; auto-updates can advance beyond that floor.
const serverMinVersion = (process.env.COWORK_SERVER_MIN_VERSION || '').trim();
const mindsApiUrl = (process.env.VITE_MINDS_API_URL || '').trim();

// Validate complete API origins against the drift-tested channel-origins mirror.
// Slug-only checks would accept unknown hosts as prod; COWORK_CHANNEL_CHECK=warn relaxes CI
// failure.
const normOrigin = (u) => {
  const s = (u || '').trim();
  if (s === '') return '';
  try {
    return new URL(s).origin.toLowerCase();
  } catch {
    return s.replace(/\/+$/, '').toLowerCase();
  }
};
const buildKindInput = (process.env.COWORK_BUILD_KIND || '').trim().toLowerCase();
if (buildKindInput) {
  const warnOnly = (process.env.COWORK_CHANNEL_CHECK || '').toLowerCase() === 'warn';
  const fail = (msg) => {
    if (warnOnly) {
      console.warn(msg);
    } else {
      console.error(msg);
      process.exit(1);
    }
  };
  const kind = buildKindInput;
  const expectedOrigin = EXPECTED_API_ORIGIN[kind];
  if (expectedOrigin === undefined) {
    // Reject explicit unknown build kinds so their API/data-home pairing cannot bypass validation.
    fail(
      `[gen-build-channel] invalid COWORK_BUILD_KIND="${buildKindInput}". ` +
        `Expected one of: dev, preview, stable, prod.`,
    );
  } else {
    const actualOrigin = normOrigin(mindsApiUrl);
    // An empty API URL is the prod default; other channels require an exact origin match.
    const ok = actualOrigin === '' ? kind === 'prod' : actualOrigin === normOrigin(expectedOrigin);
    if (!ok) {
      fail(
        `[gen-build-channel] CHANNEL MISMATCH: build kind "${kind}" expects ` +
          `${expectedOrigin} but VITE_MINDS_API_URL="${mindsApiUrl || '(unset)'}" ` +
          `resolves to "${actualOrigin || '(prod default)'}". ` +
          `Fix the CI minds_api_url / build_kind inputs.`,
      );
    }
  }
}

// Match Vite display-version resolution: explicit env, git describe, then app.getVersion() at
// runtime.
let appVersion = (process.env.VITE_APP_VERSION || '').trim().replace(/^v/, '');
if (!appVersion) {
  try {
    appVersion = execSync('git describe --tags --match "v[0-9]*"', { cwd: __dirname, encoding: 'utf-8' }).trim().replace(/^v/, '');
  } catch {  }
}

// Emit one effective display version for installer filenames so CI matches the version shown by the
// app.
const pkgVersion = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version;
const displayVersion = appVersion || pkgVersion;

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outFile,
  [
    '// Auto-generated at build time by scripts/gen-build-channel.mjs — do not edit',
    `export const BUILD_COWORK_SERVER_REF = '${coworkRef}';`,
    `export const BUILD_ANTON_REF = '${antonRef}';`,
    `export const BUILD_COWORK_SERVER_CHANNEL = '${serverChannel}';`,
    `export const BUILD_COWORK_SERVER_MIN_VERSION = '${serverMinVersion}';`,
    `export const BUILD_MINDS_API_URL = '${mindsApiUrl}';`,
    `export const BUILD_APP_VERSION = '${appVersion}';`,
    '',
  ].join('\n'),
);

writeFileSync(join(outDir, 'app-version.gen.txt'), displayVersion + '\n');

console.log(
  `[gen-build-channel] COWORK_SERVER_REF=${coworkRef || '(unset)'} ANTON_REF=${antonRef || '(unset)'} COWORK_SERVER_CHANNEL=${serverChannel || '(unset → git, or pypi on prod-kind builds)'} COWORK_SERVER_MIN_VERSION=${serverMinVersion || '(unset → static floor)'} MINDS_API_URL=${mindsApiUrl || '(unset)'} APP_VERSION=${appVersion || '(package.json default)'} DISPLAY_VERSION=${displayVersion}`,
);

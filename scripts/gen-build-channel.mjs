#!/usr/bin/env node
// Bakes build-time values into a generated TypeScript file that gets compiled
// into the Electron main bundle. Called as a `prebuild:main` npm hook so
// packaged apps carry the values that were set at build time.
//
// Values baked:
//   BUILD_COWORK_SERVER_REF / BUILD_ANTON_REF — git branch/tag for server install
//   BUILD_MINDS_API_URL — backend API base URL (the renderer gets it via Vite;
//     the main process is plain tsc and can't see VITE_ vars at runtime)
//   BUILD_APP_VERSION — CalVer display version for the About panel, IPC, and
//     cache-purge markers. The renderer has its own copy via Vite's
//     __APP_VERSION__; this constant lets the main process match it without
//     mutating package.json (which must stay valid SemVer for Electron/npm).
//
//     Resolution: VITE_APP_VERSION env > git describe > '' (falls back to
//     package.json via app.getVersion() at runtime).
//
// Priority at runtime: process.env > baked value > default
// In dev mode the env var from the Makefile wins and this file is never
// needed — but it's safe to generate it anyway.

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EXPECTED_API_ORIGIN } from './channel-origins.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'src', 'main');
const outFile = join(outDir, 'build-channel.gen.ts');

const coworkRef = (process.env.COWORK_SERVER_REF || '').trim();
const antonRef = (process.env.ANTON_REF || '').trim();
// Install channel for cowork-server: 'pypi' (release builds — immutable,
// versioned, yankable artifacts) or 'git' / empty (float on a branch HEAD).
const serverChannel = (process.env.COWORK_SERVER_CHANNEL || '').trim().toLowerCase();
// Minimum cowork-server version for pypi-channel installs. Release builds
// bake the latest published version at build time so every install starts
// from a known-good floor; the auto-updater still moves users to newer
// releases as they publish.
const serverMinVersion = (process.env.COWORK_SERVER_MIN_VERSION || '').trim();
// The renderer gets VITE_MINDS_API_URL baked by Vite; the main process is
// plain tsc and can't see it at runtime, so bake it here too.
const mindsApiUrl = (process.env.VITE_MINDS_API_URL || '').trim();

// Build-time guard mirroring channels.ts (checkChannelConsistency +
// normalizeBuildKind): the build kind CI is producing must be baked to talk to
// the matching MindsHub API. Only runs when CI exported COWORK_BUILD_KIND, so a
// local `npm run build` (kind=dev) never trips it. Fails hard in CI so a mis-wired
// installer can't ship — set COWORK_CHANNEL_CHECK=warn to downgrade.
//
// Expected origins come from scripts/channel-origins.mjs, the .mjs mirror of
// CHANNELS (this script can't import the TS; channels.test.ts drift-guards it).
// Comparing full origins, not the env slug, is deliberate: a slug-only check
// treats every unrecognized host as prod (slug ''), passing a mistyped host.
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
    // Fail closed on an explicitly-set but unrecognized build kind — the
    // build-time mirror of normalizeBuildKind. A typo here would otherwise bake
    // an installer whose data-home / API pairing was never validated.
    fail(
      `[gen-build-channel] invalid COWORK_BUILD_KIND="${buildKindInput}". ` +
        `Expected one of: dev, preview, stable, prod.`,
    );
  } else {
    const actualOrigin = normOrigin(mindsApiUrl);
    // Empty VITE_MINDS_API_URL = the intentional prod default; consistent only
    // for prod. Otherwise require an exact origin match.
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

// App display version: explicit CI value > git describe > empty string.
// Same resolution order as vite.config.ts so the main process and renderer
// always agree on the display version. An empty string means "use
// app.getVersion() (package.json)" at runtime.
let appVersion = (process.env.VITE_APP_VERSION || '').trim().replace(/^v/, '');
if (!appVersion) {
  try {
    appVersion = execSync('git describe --tags --match "v[0-9]*"', { cwd: __dirname, encoding: 'utf-8' }).trim().replace(/^v/, '');
  } catch { /* no tags — leave empty, runtime falls back to package.json */ }
}

// Effective display version for build artifacts (installer filenames, etc.):
// the baked app version if we have one, else the package.json SemVer that
// app.getVersion() would return at runtime. Emitted as a plain-text file so
// CI names installers with the exact version the app reports — resolved once,
// here, with no second copy of this logic to drift out of sync.
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

// Single source of truth for the display version, consumed by CI to name
// installer artifacts (see .github/workflows/build-*.yml "Compute artifact name").
writeFileSync(join(outDir, 'app-version.gen.txt'), displayVersion + '\n');

console.log(
  `[gen-build-channel] COWORK_SERVER_REF=${coworkRef || '(unset)'} ANTON_REF=${antonRef || '(unset)'} COWORK_SERVER_CHANNEL=${serverChannel || '(unset → git, or pypi on prod-kind builds)'} COWORK_SERVER_MIN_VERSION=${serverMinVersion || '(unset → static floor)'} MINDS_API_URL=${mindsApiUrl || '(unset)'} APP_VERSION=${appVersion || '(package.json default)'} DISPLAY_VERSION=${displayVersion}`,
);

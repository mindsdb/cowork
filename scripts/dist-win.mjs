// Windows installer build with per-channel bundle identity + shell auto-update
// feed wiring. Wraps electron-builder's programmatic API (not the CLI) so the
// spaced productName ("MindsHub Cowork (Staging)") can't be mangled by Windows
// shell quoting. prod/dev/unset apply no identity overrides → same bundle as the
// previous `electron-builder --win`.
//
//   node scripts/dist-win.mjs         # --x64 (what CI uses)
//   node scripts/dist-win.mjs --all   # all Windows arches
//
// `config` is deep-merged over electron-builder.yml, so the win target/
// artifactName survive; we only override identity + inject the updater version
// and (for prod/stable) the generic update feed. This mirrors, on the
// programmatic path, what scripts/run-electron-builder.mjs does for the mac CLI
// build so the eligible-channel Windows post-build steps (write-update-metadata,
// latest.yml) see a resolved src/main/updater-version.gen.txt.

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';
import { channelIdentity } from './channel-identity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// npm run build compiles shared helpers before this script runs.
const { calVerToUpdaterSemVer } = await import(
  pathToFileURL(join(root, 'dist', 'main', 'shared', 'version.js')).href
);
const { resolveShellUpdateFeed, shellUpdaterCacheDirName, resolveWindowsPublisherNames } = await import(
  pathToFileURL(join(root, 'dist', 'main', 'shared', 'shell-update-feed.js')).href
);

const arches = process.argv.includes('--all') ? [Arch.x64, Arch.arm64] : [Arch.x64];

// --- Updater version + feed (mirrors scripts/run-electron-builder.mjs) ---
const displayVersion = readFileSync(
  join(root, 'src', 'main', 'app-version.gen.txt'),
  'utf8',
).trim();
const buildKind = (process.env.COWORK_BUILD_KIND || '').trim().toLowerCase();
const feed = resolveShellUpdateFeed(buildKind, 'win32');
const packageVersion = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
).version;
const updaterVersion = calVerToUpdaterSemVer(displayVersion)
  ?? (feed ? null : packageVersion);
if (!updaterVersion) {
  console.error(
    `[dist-win] eligible ${buildKind}/win32 build has unsupported shell CalVer "${displayVersion}"`,
  );
  process.exit(1);
}

writeFileSync(
  join(root, 'src', 'main', 'updater-version.gen.txt'),
  `${updaterVersion}\n`,
);

// Pin the Windows updater's expected Authenticode signer. Without this,
// electron-updater's NsisUpdater skips signature verification and would install
// any executable the feed serves (see resolveWindowsPublisherNames).
const publisherNames = feed
  ? resolveWindowsPublisherNames(process.env.COWORK_WIN_PUBLISHER_CN)
  : [];

const appUpdatePath = join(root, 'build', 'app-update.yml');
if (feed) {
  writeFileSync(
    appUpdatePath,
    [
      'provider: generic',
      `url: ${feed.url}`,
      `updaterCacheDirName: ${shellUpdaterCacheDirName(feed.channel)}`,
      'publisherName:',
      ...publisherNames.map(name => `  - ${JSON.stringify(name)}`),
      '',
    ].join('\n'),
  );
} else {
  try { unlinkSync(appUpdatePath); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

// --- Channel bundle identity (mirrors the mac build script) ---
const id = channelIdentity(process.env.COWORK_BUILD_KIND);
const config = { extraMetadata: { version: updaterVersion } };
if (id) {
  config.appId = id.appId;
  config.productName = id.productName;
  config.win = { icon: id.winIcon };
  console.log(`[dist-win] channel identity: ${id.appId} / ${id.productName} / ${id.winIcon}`);
} else {
  console.log('[dist-win] no channel identity override (prod/dev) — using electron-builder.yml');
}
if (feed) {
  // publisherName goes on the PUBLISH config, not `win`: electron-builder 26's
  // schema rejects win.publisherName (it lives under win.signtoolOptions or on
  // the publish provider), and its afterPack hook regenerates the authoritative
  // resources/app-update.yml from this publish config — so the pin ships there.
  config.publish = { provider: 'generic', url: feed.url, publisherName: publisherNames };
}

console.log(
  `[dist-win] display=${displayVersion} updater=${updaterVersion} feed=${feed?.url || '(disabled)'} publisher=${JSON.stringify(publisherNames)}`,
);

try {
  await build({
    targets: Platform.WINDOWS.createTarget(undefined, ...arches),
    publish: 'never',
    config,
  });
} catch (err) {
  console.error('[dist-win] build failed:', err);
  process.exit(1);
}

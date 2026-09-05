// Use electron-builder's API so Windows shell quoting cannot split channel product names.
// Default x64; --all builds every Windows architecture. Merge identity/feed overrides over
// electron-builder.yml.

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';
import { channelIdentity } from './channel-identity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Build must compile the shared helpers before this script runs.
const { calVerToUpdaterSemVer } = await import(
  pathToFileURL(join(root, 'dist', 'main', 'shared', 'version.js')).href
);
const { resolveShellUpdateFeed, shellUpdaterCacheDirName, resolveWindowsPublisherNames } = await import(
  pathToFileURL(join(root, 'dist', 'main', 'shared', 'shell-update-feed.js')).href
);

const arches = process.argv.includes('--all') ? [Arch.x64, Arch.arm64] : [Arch.x64];

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

// Pin the Authenticode publisher: electron-updater skips signature verification when the pin is
// absent.
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
  // Put publisherName on publish: electron-builder 26 rejects win.publisherName
  // and regenerates the packaged app-update.yml from the publish configuration.
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

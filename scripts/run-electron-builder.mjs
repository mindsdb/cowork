#!/usr/bin/env node

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linuxBuilderArgs } from './channel-identity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const displayVersion = readFileSync(
  join(root, 'src', 'main', 'app-version.gen.txt'),
  'utf8',
).trim();

// Build must compile shared helpers before this wrapper runs.
const { calVerToUpdaterSemVer } = await import(
  pathToFileURL(join(root, 'dist', 'main', 'shared', 'version.js')).href
);
const { resolveShellUpdateFeed, shellUpdaterCacheDirName, resolveWindowsPublisherNames, SHELL_UPDATE_CHANNEL } = await import(
  pathToFileURL(join(root, 'dist', 'main', 'shared', 'shell-update-feed.js')).href
);

const rawArgs = process.argv.slice(2);
const skipFeedConfig = rawArgs.includes('--skip-feed-config');
const userArgs = rawArgs.filter(arg => arg !== '--skip-feed-config');
const targetPlatform = userArgs.includes('--mac')
  ? 'darwin'
  : userArgs.includes('--win')
    ? 'win32'
    : null;
// Linux needs channel identity but no shell-update feed; deb updates use apt.
const targetsLinux = userArgs.includes('--linux');
const buildKind = (process.env.COWORK_BUILD_KIND || '').trim().toLowerCase();
const feed = targetPlatform
  ? resolveShellUpdateFeed(buildKind, targetPlatform)
  : null;
const packageVersion = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
).version;
const updaterVersion = calVerToUpdaterSemVer(displayVersion)
  ?? (feed ? null : packageVersion);
if (!updaterVersion) {
  console.error(
    `[electron-builder] eligible ${buildKind}/${targetPlatform} build has unsupported shell CalVer "${displayVersion}"`,
  );
  process.exit(1);
}

writeFileSync(
  join(root, 'src', 'main', 'updater-version.gen.txt'),
  `${updaterVersion}\n`,
);

// Windows needs an explicit Authenticode pin. Squirrel.Mac checks the installed app's signing
// identity.
const publisherNames = feed && targetPlatform === 'win32'
  ? resolveWindowsPublisherNames(process.env.COWORK_WIN_PUBLISHER_CN)
  : [];

const appUpdatePath = join(root, 'build', 'app-update.yml');
if (feed && !skipFeedConfig) {
  const lines = [
    'provider: generic',
    `url: ${feed.url}`,
    // Match the published channel; afterPack reasserts it on the generated manifest.
    `channel: ${SHELL_UPDATE_CHANNEL}`,
    `updaterCacheDirName: ${shellUpdaterCacheDirName(feed.channel)}`,
  ];
  if (publisherNames.length) {
    lines.push('publisherName:', ...publisherNames.map(name => `  - ${JSON.stringify(name)}`));
  }
  lines.push('');
  writeFileSync(appUpdatePath, lines.join('\n'));
} else if (!skipFeedConfig) {
  try { unlinkSync(appUpdatePath); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const builderArgs = [
  ...userArgs,
  `-c.extraMetadata.version=${updaterVersion}`,
  ...(targetsLinux ? linuxBuilderArgs(buildKind) : []),
];
if (feed && !skipFeedConfig) {
  builderArgs.push(
    '-c.publish.provider=generic',
    `-c.publish.url=${feed.url}`,
    `-c.publish.channel=${SHELL_UPDATE_CHANNEL}`,
  );
  // Set publisherName on publish: electron-builder 26 rejects win.publisherName.
  publisherNames.forEach((name, i) => {
    builderArgs.push(`-c.publish.publisherName.${i}=${name}`);
  });
}

console.log(
  `[electron-builder] display=${displayVersion} updater=${updaterVersion} feed=${feed?.url || '(disabled)'}`,
);
if (targetsLinux) {
  const identity = linuxBuilderArgs(buildKind);
  console.log(`[electron-builder] linux identity: ${identity.length ? identity.join(' ') : '(prod defaults)'}`);
}

const binary = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'electron-builder.cmd')
  : join(root, 'node_modules', '.bin', 'electron-builder');
const result = spawnSync(binary, builderArgs, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

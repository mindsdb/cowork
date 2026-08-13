// electron-builder `afterPack` hook.
//
// electron-builder's AsyncEventEmitter fires USER handlers (this one, via
// `config.afterPack`) AFTER all SYSTEM handlers. PublishManager's system handler
// regenerates `resources/app-update.yml` from the publish config, clobbering any
// extraResources copy: it hard-codes `updaterCacheDirName` to the unscoped
// `${name}-updater` and derives `channel` from the package version. Running last,
// this hook is the only place to durably override both on the packaged manifest:
//   - updaterCacheDirName is scoped per channel so stable and prod don't share
//     the OS cache ROOT, where one channel's cleanup could strand the other's
//     pending update.
//   - channel is pinned to SHELL_UPDATE_CHANNEL so it matches the published
//     manifest name instead of varying per build.
//
// It then delegates to strip-xattrs (macOS iCloud codesign workaround), which
// rewrites files to fresh inodes — running it AFTER our edit keeps our content
// while clearing any xattrs the write introduced. Both steps run before signing.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const stripXattrs = require('./strip-xattrs').default;

const root = path.join(__dirname, '..');

async function normalizeAppUpdateManifest(context) {
  const { resolveShellUpdateFeed, shellUpdaterCacheDirName, SHELL_UPDATE_CHANNEL, withAppUpdateChannel } = await import(
    pathToFileURL(path.join(root, 'dist', 'main', 'shared', 'shell-update-feed.js')).href
  );
  const buildKind = (process.env.COWORK_BUILD_KIND || '').trim().toLowerCase();
  const feed = resolveShellUpdateFeed(buildKind, context.electronPlatformName);
  // No eligible feed → PublishManager wrote no app-update.yml → nothing to fix.
  if (!feed) return;

  const appUpdatePath = path.join(
    context.packager.getResourcesDir(context.appOutDir),
    'app-update.yml',
  );
  if (!fs.existsSync(appUpdatePath)) {
    console.warn(`[after-pack] eligible ${feed.channel} build but ${appUpdatePath} is missing — cannot normalize manifest`);
    return;
  }

  const scoped = shellUpdaterCacheDirName(feed.channel);
  const before = fs.readFileSync(appUpdatePath, 'utf8');
  // 1. Scope the OS-cache pending-download dir per channel.
  const scopedManifest = /^updaterCacheDirName:.*$/m.test(before)
    ? before.replace(/^updaterCacheDirName:.*$/m, `updaterCacheDirName: ${scoped}`)
    : `${before.replace(/\n?$/, '\n')}updaterCacheDirName: ${scoped}\n`;
  // 2. Pin the updater channel to the ring-stable published pointer.
  const after = withAppUpdateChannel(scopedManifest, SHELL_UPDATE_CHANNEL);
  fs.writeFileSync(appUpdatePath, after, 'utf8');

  // Assert the FINAL packaged manifest, not just our intent: fail the build if
  // either fix didn't take, or (on Windows) if the signer pin went missing.
  const packaged = fs.readFileSync(appUpdatePath, 'utf8');
  const unquote = (line) => line && line.trim().replace(/^["']|["']$/g, '');
  const cacheValue = unquote((packaged.match(/^updaterCacheDirName:\s*(.+)$/m) || [])[1]);
  if (cacheValue !== scoped) {
    throw new Error(`[after-pack] updaterCacheDirName not scoped in ${appUpdatePath}: got ${cacheValue ?? 'none'}, expected ${scoped}`);
  }
  const channelValue = unquote((packaged.match(/^channel:\s*(.+)$/m) || [])[1]);
  if (channelValue !== SHELL_UPDATE_CHANNEL) {
    throw new Error(`[after-pack] channel not pinned in ${appUpdatePath}: got ${channelValue ?? 'none'}, expected ${SHELL_UPDATE_CHANNEL}`);
  }
  if (context.electronPlatformName === 'win32' && !/^publisherName:/m.test(packaged)) {
    throw new Error(`[after-pack] Windows app-update.yml is missing the publisherName signer pin: ${appUpdatePath}`);
  }
  console.log(`[after-pack] ${feed.channel} app-update.yml: channel=${SHELL_UPDATE_CHANNEL}, updaterCacheDirName=${scoped}${context.electronPlatformName === 'win32' ? ', publisherName pinned' : ''}`);
}

exports.default = async function afterPack(context) {
  await normalizeAppUpdateManifest(context);
  await stripXattrs(context);
};

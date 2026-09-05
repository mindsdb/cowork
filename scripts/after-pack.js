// User afterPack handlers run after PublishManager regenerates app-update.yml, so override it here.
// Scope updater caches by build kind and pin the published channel to prevent cross-channel
// interference.
// Run strip-xattrs after editing but before signing to remove attributes introduced by the write.
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
  // No eligible feed means there is no generated manifest to patch.
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
  const scopedManifest = /^updaterCacheDirName:.*$/m.test(before)
    ? before.replace(/^updaterCacheDirName:.*$/m, `updaterCacheDirName: ${scoped}`)
    : `${before.replace(/\n?$/, '\n')}updaterCacheDirName: ${scoped}\n`;
  const after = withAppUpdateChannel(scopedManifest, SHELL_UPDATE_CHANNEL);
  fs.writeFileSync(appUpdatePath, after, 'utf8');

  // Verify the final manifest, including the Windows signer pin, before packaging can succeed.
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

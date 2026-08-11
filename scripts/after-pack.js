// electron-builder `afterPack` hook.
//
// electron-builder's AsyncEventEmitter fires USER handlers (this one, via
// `config.afterPack`) AFTER all SYSTEM handlers. One system handler is
// PublishManager's: it regenerates `resources/app-update.yml` from the publish
// config and hard-codes `updaterCacheDirName` to appInfo's `${name}-updater`
// (i.e. the unscoped `anton-updater`), clobbering anything extraResources
// copied in. So this is the only place we can durably scope that cache dir per
// channel — stable and prod otherwise share the OS cache ROOT and one channel's
// checksum-mismatch cleanup can strand the other's ready update.
//
// It then delegates to strip-xattrs (macOS iCloud codesign workaround), which
// rewrites files to fresh inodes — running it AFTER our edit keeps our content
// while clearing any xattrs the write introduced. Both steps run before signing.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const stripXattrs = require('./strip-xattrs').default;

const root = path.join(__dirname, '..');

async function scopeUpdaterCacheDir(context) {
  const { resolveShellUpdateFeed, shellUpdaterCacheDirName } = await import(
    pathToFileURL(path.join(root, 'dist', 'main', 'shared', 'shell-update-feed.js')).href
  );
  const buildKind = (process.env.COWORK_BUILD_KIND || '').trim().toLowerCase();
  const feed = resolveShellUpdateFeed(buildKind, context.electronPlatformName);
  // No eligible feed → PublishManager wrote no app-update.yml → nothing to scope.
  if (!feed) return;

  const appUpdatePath = path.join(
    context.packager.getResourcesDir(context.appOutDir),
    'app-update.yml',
  );
  if (!fs.existsSync(appUpdatePath)) {
    console.warn(`[after-pack] eligible ${feed.channel} build but ${appUpdatePath} is missing — cannot scope updater cache dir`);
    return;
  }

  const scoped = shellUpdaterCacheDirName(feed.channel);
  const before = fs.readFileSync(appUpdatePath, 'utf8');
  const after = /^updaterCacheDirName:.*$/m.test(before)
    ? before.replace(/^updaterCacheDirName:.*$/m, `updaterCacheDirName: ${scoped}`)
    : `${before.replace(/\n?$/, '\n')}updaterCacheDirName: ${scoped}\n`;
  fs.writeFileSync(appUpdatePath, after, 'utf8');

  // Assert the FINAL packaged manifest, not just our intent: fail the build if
  // the scope didn't take, or (on Windows) if the signer pin went missing.
  const packaged = fs.readFileSync(appUpdatePath, 'utf8');
  const got = packaged.match(/^updaterCacheDirName:\s*(.+)$/m);
  const value = got && got[1].trim().replace(/^["']|["']$/g, '');
  if (value !== scoped) {
    throw new Error(`[after-pack] updaterCacheDirName not scoped in ${appUpdatePath}: got ${value ?? 'none'}, expected ${scoped}`);
  }
  if (context.electronPlatformName === 'win32' && !/^publisherName:/m.test(packaged)) {
    throw new Error(`[after-pack] Windows app-update.yml is missing the publisherName signer pin: ${appUpdatePath}`);
  }
  console.log(`[after-pack] ${feed.channel} app-update.yml: updaterCacheDirName=${scoped}${context.electronPlatformName === 'win32' ? ', publisherName pinned' : ''}`);
}

exports.default = async function afterPack(context) {
  await scopeUpdaterCacheDir(context);
  await stripXattrs(context);
};

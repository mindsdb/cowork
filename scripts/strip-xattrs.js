// electron-builder `afterPack` hook (runs after the .app is assembled but
// BEFORE code signing).
//
// Works around codesign failing with
//   "resource fork, Finder information, or similar detritus not allowed"
// on macOS when the project lives in an iCloud-synced folder (e.g. ~/Documents).
// The file provider + kernel tag the bundle with extended attributes that
// codesign rejects:
//   • directories get `com.apple.FinderInfo` (from iCloud/Finder)
//   • executables get `com.apple.provenance` (macOS Sequoia)
//
// These can't all be cleared the same way:
//   • directory FinderInfo IS removed by `xattr -c`.
//   • file `com.apple.provenance` sticks to the inode — `xattr -c`/`ditto`
//     don't drop it; only copying to a fresh inode without xattrs (`cp -X`)
//     does.
// So we clear xattrs on every directory and rewrite every regular file via
// `cp -pX`. After this the ad-hoc (and real, at release) codesign succeeds.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

exports.default = async function stripXattrs(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const apps = fs
    .readdirSync(context.appOutDir)
    .filter((name) => name.endsWith('.app'));

  // 1) clear xattrs on every directory (drops com.apple.FinderInfo)
  // 2) rewrite every regular file to a fresh, xattr-free inode (drops the
  //    sticky com.apple.provenance). `-type f` skips symlinks, so the bundle's
  //    framework symlinks and structure are preserved.
  const script =
    'find "$1" -type d -exec /usr/bin/xattr -c {} + 2>/dev/null; ' +
    'find "$1" -type f -print0 | ' +
    'while IFS= read -r -d "" f; do ' +
    '/bin/cp -pX "$f" "$f.__nx__" && /bin/mv -f "$f.__nx__" "$f"; ' +
    'done';

  for (const appName of apps) {
    const appPath = path.join(context.appOutDir, appName);
    execFileSync('/bin/bash', ['-c', script, 'bash', appPath], { stdio: 'inherit' });
    console.log(`[strip-xattrs] cleared FinderInfo (dirs) + provenance (files) in ${appName} before signing`);
  }
};

// Before codesigning, remove iCloud/Finder attributes from the assembled app.
// Directory FinderInfo clears with xattr; sticky file provenance requires a fresh inode via cp -pX.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

exports.default = async function stripXattrs(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const apps = fs
    .readdirSync(context.appOutDir)
    .filter((name) => name.endsWith('.app'));

  // Rewrite regular files only so framework symlinks remain intact; clear directory attributes
  // separately.
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

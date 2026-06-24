const { execFileSync } = require('child_process');

exports.default = async function afterPack({ appOutDir, packager }) {
  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  try {
    execFileSync('xattr', ['-cr', appPath]);
    console.log(`[after-pack] stripped xattrs from ${appName}.app`);
  } catch (e) {
    console.warn('[after-pack] xattr -cr failed (non-fatal):', e.message);
  }
};

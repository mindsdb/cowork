// Build-time channel BUNDLE identity for electron-builder: appId, productName,
// icon and (on Linux) the package/executable names, baked into the packaged app. A .mjs build script, so
// it can't import the TS — kind names mirror src/main/channels.ts. The RUNTIME
// userData name (appName) lives there and is applied via app.setName; this file
// is only the packaged identity. prod/dev return null → no overrides, so the
// prod build path uses electron-builder.yml unchanged.
//
// Icon values are BARE basenames, matching the yml's own `icon: icon.png`:
// electron-builder resolves them under directories.buildResources (= assets/). A
// prefixed `assets/…` only resolved via the secondary projectDir fallback.

const IDENTITY = {
  preview: {
    appId: 'com.mindshub.cowork.preview',
    productName: 'MindsHub Cowork (Preview)',
    macIcon: 'icon-preview.png',
    winIcon: 'icon-preview.png',
    linuxIcon: 'icon-preview.png',
    linuxName: 'mindshub-cowork-preview',
  },
  // The `stable` kind targets the staging env (see channels.ts — envSlug/
  // serverRef are 'staging'), so its USER-VISIBLE identity (productName, icon)
  // is labelled "Staging" to match what a tester is actually hitting. The appId
  // (an invisible bundle identifier) stays keyed to the kind for consistency
  // with the rest of the table.
  stable: {
    appId: 'com.mindshub.cowork.stable',
    productName: 'MindsHub Cowork (Staging)',
    macIcon: 'icon-staging.png',
    winIcon: 'icon-staging.png',
    linuxIcon: 'icon-staging.png',
    // Debian package AND executable name. Both must differ from prod's or dpkg
    // refuses to unpack the two over the same paths; lowercase per Debian
    // policy, and "staging" to match the alias the channel already publishes
    // under (mindshub-cowork-staging.deb).
    linuxName: 'mindshub-cowork-staging',
  },
};

/** Bundle identity for a build kind, or null for prod/dev/unset (→ yml defaults). */
export function channelIdentity(kindRaw) {
  const kind = (kindRaw || '').trim().toLowerCase();
  return IDENTITY[kind] || null;
}

/**
 * electron-builder `-c` overrides that let a channel's deb install beside prod.
 * Empty for prod/dev/unset, which keep the electron-builder.yml identity.
 *
 * All three names matter: /opt/<dir> comes from productName, while the
 * /usr/bin symlink, .desktop file, icon and AppArmor profile all come from
 * executableName. Sharing any of them is a dpkg file conflict, not a merge.
 */
export function linuxBuilderArgs(kindRaw) {
  const id = channelIdentity(kindRaw);
  if (!id) return [];
  return [
    `-c.appId=${id.appId}`,
    `-c.productName=${id.productName}`,
    `-c.linux.icon=${id.linuxIcon}`,
    `-c.linux.executableName=${id.linuxName}`,
    `-c.deb.packageName=${id.linuxName}`,
  ];
}

// CLI helpers for the bash mac build script (which can't import ESM easily):
//   node scripts/channel-identity.mjs value <appId|productName|macIcon|winIcon>
//     → prints the value for $COWORK_BUILD_KIND, or empty for prod/dev/unset.
if (process.argv[1] && process.argv[1].endsWith('channel-identity.mjs')) {
  const [, , cmd, key] = process.argv;
  const id = channelIdentity(process.env.COWORK_BUILD_KIND);
  if (cmd === 'value') {
    process.stdout.write(id && id[key] ? String(id[key]) : '');
  }
}

// Build-time bundle identity; runtime userData naming lives in src/main/channels.ts.
// prod/dev/unset keep electron-builder.yml defaults. Icon paths are basenames relative to assets/.

const IDENTITY = {
  preview: {
    appId: 'com.mindshub.cowork.preview',
    productName: 'MindsHub Cowork (Preview)',
    macIcon: 'icon-preview.png',
    winIcon: 'icon-preview.png',
    linuxIcon: 'icon-preview.png',
    linuxName: 'mindshub-cowork-preview',
  },
  // stable targets staging; keep the visible name/icon Staging while appId remains keyed to stable.
  stable: {
    appId: 'com.mindshub.cowork.stable',
    productName: 'MindsHub Cowork (Staging)',
    macIcon: 'icon-staging.png',
    winIcon: 'icon-staging.png',
    linuxIcon: 'icon-staging.png',
    // Debian package and executable names must differ by channel to avoid dpkg path conflicts.
    linuxName: 'mindshub-cowork-staging',
  },
};

export function channelIdentity(kindRaw) {
  const kind = (kindRaw || '').trim().toLowerCase();
  return IDENTITY[kind] || null;
}

/**
 * All channel names must differ: productName owns /opt; executableName owns /usr/bin,
 * .desktop, icon, and AppArmor paths. Any shared path causes a dpkg conflict.
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

// CLI: node scripts/channel-identity.mjs value <appId|productName|macIcon|winIcon>.
// Uses COWORK_BUILD_KIND; prod/dev/unset print empty.
if (process.argv[1] && process.argv[1].endsWith('channel-identity.mjs')) {
  const [, , cmd, key] = process.argv;
  const id = channelIdentity(process.env.COWORK_BUILD_KIND);
  if (cmd === 'value') {
    process.stdout.write(id && id[key] ? String(id[key]) : '');
  }
}

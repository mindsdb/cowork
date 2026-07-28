// Build-time channel BUNDLE identity for electron-builder: appId, productName,
// and icon per build kind. electron-builder bakes these into the packaged app
// (CFBundleIdentifier / CFBundleName / icon), and this is a .mjs build script so
// it can't import the TS source — the kind names here mirror src/main/channels.ts.
// The RUNTIME userData name (appName) lives in channels.ts and is applied via
// app.setName (app-identity.ts); this file is only the packaged identity.
//
// prod (and dev, which is never packaged) return null → NO overrides are
// emitted, so the prod build path uses electron-builder.yml unchanged.

const IDENTITY = {
  preview: {
    appId: 'com.mindshub.cowork.preview',
    productName: 'MindsHub Cowork (Preview)',
    macIcon: 'assets/icon-preview.png',
    winIcon: 'assets/icon-preview.png',
  },
  // The `stable` kind targets the staging env (see channels.ts — envSlug/
  // serverRef are 'staging'), so its USER-VISIBLE identity (productName, icon)
  // is labelled "Staging" to match what a tester is actually hitting. The appId
  // (an invisible bundle identifier) stays keyed to the kind for consistency
  // with the rest of the table.
  stable: {
    appId: 'com.mindshub.cowork.stable',
    productName: 'MindsHub Cowork (Staging)',
    macIcon: 'assets/icon-staging.png',
    winIcon: 'assets/icon-staging.png',
  },
};

/** Bundle identity for a build kind, or null for prod/dev/unset (→ yml defaults). */
export function channelIdentity(kindRaw) {
  const kind = (kindRaw || '').trim().toLowerCase();
  return IDENTITY[kind] || null;
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

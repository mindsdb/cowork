// Per-channel Electron app identity. IMPORTED FOR ITS SIDE EFFECT, and it MUST
// be the FIRST local import in the main entry (src/main/index.ts): it calls
// app.setName() to pick the userData directory, and modules like token-store.ts
// read app.getPath('userData') at module-load time — so the name has to be set
// before any of them are imported.
//
// Non-prod build kinds each get a distinct app name → a separate userData dir
// (~/Library/Application Support/<name>), so localStorage, terms consent, and
// the token-store file are isolated per channel and the builds install as
// distinct apps. prod is NEVER re-set: its userData has always been "anton"
// (real users' data lives there — see the fix/pkg-installer-relocation revert),
// so leaving app.name untouched keeps prod byte-for-byte as shipped.
//
// This only covers the RUNTIME name (userData). The packaged bundle identity
// (appId / productName / icon) is set at build time — see
// scripts/channel-identity.mjs and release-mac-pkg-notarized.sh.

import { app } from 'electron';
import { buildKind } from './cowork-home';
import { CHANNELS } from './channels';

const kind = buildKind();
if (kind !== 'prod') {
  app.setName(CHANNELS[kind].appName);
  console.log(`[app-identity] build kind "${kind}" → app name "${app.getName()}" (userData isolated)`);
}

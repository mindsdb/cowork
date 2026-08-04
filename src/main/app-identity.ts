// Per-channel Electron app identity, IMPORTED FOR ITS SIDE EFFECT. Must be the
// FIRST local import in src/main/index.ts: it calls app.setName() to pick the
// userData dir, and modules like token-store.ts read app.getPath('userData') at
// load time, so the name has to be set before any of them import.
//
// Each non-prod kind gets a distinct app name → its own userData dir, isolating
// localStorage, terms consent, and the token store per channel. prod is NEVER
// re-set (its userData has always been "anton", where real users' data lives),
// so leaving app.name untouched keeps prod byte-for-byte as shipped.
//
// Covers only the RUNTIME name; the packaged bundle identity (appId/productName/
// icon) is set at build time — see scripts/channel-identity.mjs.

import { app } from 'electron';
import { buildKind } from './cowork-home';
import { CHANNELS } from './channels';

const kind = buildKind();
if (kind !== 'prod') {
  app.setName(CHANNELS[kind].appName);
  console.log(`[app-identity] build kind "${kind}" → app name "${app.getName()}" (userData isolated)`);
}

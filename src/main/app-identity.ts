// Import FIRST in index.ts: token-store and other modules read userData at import time.
// Non-prod names isolate state; leave prod named "anton" to retain existing user data.
// Packaged identity is configured separately in scripts/channel-identity.mjs.

import { app } from 'electron';
import { buildKind } from './cowork-home';
import { CHANNELS } from './channels';

const kind = buildKind();
if (kind !== 'prod') {
  app.setName(CHANNELS[kind].appName);
  console.log(`[app-identity] build kind "${kind}" → app name "${app.getName()}" (userData isolated)`);
}

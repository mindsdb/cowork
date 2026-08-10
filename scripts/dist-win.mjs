// Windows installer build with per-channel bundle identity. Wraps
// electron-builder's programmatic API (not the CLI) so the spaced productName
// ("MindsHub Cowork (Staging)") can't be mangled by Windows shell quoting.
// prod/dev/unset apply no overrides → same as the previous `electron-builder --win`.
//
//   node scripts/dist-win.mjs         # --x64 (what CI uses)
//   node scripts/dist-win.mjs --all   # all Windows arches
//
// `config` is deep-merged over electron-builder.yml, so the win target/
// artifactName survive; we only override identity.

import { build, Platform, Arch } from 'electron-builder';
import { channelIdentity } from './channel-identity.mjs';

const arches = process.argv.includes('--all') ? [Arch.x64, Arch.arm64] : [Arch.x64];

const id = channelIdentity(process.env.COWORK_BUILD_KIND);
const config = {};
if (id) {
  config.appId = id.appId;
  config.productName = id.productName;
  config.win = { icon: id.winIcon };
  console.log(`[dist-win] channel identity: ${id.appId} / ${id.productName} / ${id.winIcon}`);
} else {
  console.log('[dist-win] no channel identity override (prod/dev) — using electron-builder.yml');
}

try {
  await build({
    targets: Platform.WINDOWS.createTarget(undefined, ...arches),
    publish: 'never',
    config,
  });
} catch (err) {
  console.error('[dist-win] build failed:', err);
  process.exit(1);
}

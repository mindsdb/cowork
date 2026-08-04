// Runtime window / dock / taskbar icon selection per build channel.
//
// The packaged BUNDLE icon is set at build time (scripts/channel-identity.mjs),
// but Electron also lets the RUNNING app choose its window/dock icon in code
// (BrowserWindow `icon` + app.dock.setIcon), and that choice wins for what the
// user sees while the app is open. If runtime always picked the base icon.png, a
// staging/preview build would revert to the prod icon after launch — so it picks
// the same badged asset per channel instead.
//
// Pure (path math only; the fs probe is injected) so it's testable without
// electron; index.ts wires in the real assets dir and fs.existsSync.

import * as path from 'path';
import { CHANNELS, type BuildKind } from './channels';

/** Resolve the on-disk window/dock icon path for a build kind under `assetsDir`:
 *  the channel's badged icon (CHANNELS[kind].iconName), or base icon.png if it's
 *  missing. The fallback is deliberate — nativeImage.createFromPath silently
 *  returns an EMPTY image for a missing path, so the base icon is a safer
 *  degradation than a blank dock icon from a packaging slip. */
export function resolveChannelIconPath(
  kind: BuildKind,
  assetsDir: string,
  exists: (p: string) => boolean,
): string {
  const preferred = path.join(assetsDir, CHANNELS[kind].iconName);
  const base = path.join(assetsDir, 'icon.png');
  return exists(preferred) ? preferred : base;
}

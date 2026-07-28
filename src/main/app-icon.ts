// Runtime window / dock / taskbar icon selection per build channel.
//
// The packaged BUNDLE icon (CFBundleIconFile on macOS, the .exe icon on Windows)
// is set at build time — see scripts/channel-identity.mjs. But Electron also lets
// the RUNNING app choose its window/dock/taskbar icon in code (BrowserWindow's
// `icon` option and app.dock.setIcon), and that runtime choice wins for the icon
// the user actually sees while the app is open. If runtime always picked the base
// icon.png, a staging/preview build would revert to the prod icon after launch —
// defeating the visual isolation the per-channel identity is meant to give. So
// the runtime picks the same badged asset per channel.
//
// Kept pure (path math only; the fs probe is injected) so the selection is
// unit-testable without electron. index.ts wires in the real assets dir
// (app.isPackaged / process.resourcesPath) and fs.existsSync.

import * as path from 'path';
import { CHANNELS, type BuildKind } from './channels';

/** Resolve the on-disk window/dock icon path for a build kind under `assetsDir`.
 *  Uses the channel's badged icon (CHANNELS[kind].iconName); falls back to the
 *  base icon.png if that asset is missing. The fallback is deliberate:
 *  nativeImage.createFromPath silently returns an EMPTY image for a missing path,
 *  so without it a packaging slip would ship a blank dock/taskbar icon rather
 *  than fail loudly — the base icon is the safer degradation. */
export function resolveChannelIconPath(
  kind: BuildKind,
  assetsDir: string,
  exists: (p: string) => boolean,
): string {
  const preferred = path.join(assetsDir, CHANNELS[kind].iconName);
  const base = path.join(assetsDir, 'icon.png');
  return exists(preferred) ? preferred : base;
}

// Runtime icons must match the channel-badged bundle icons; see scripts/channel-identity.mjs.

import * as path from 'path';
import { CHANNELS, type BuildKind } from './channels';

/**
 * Fall back to icon.png when the channel asset is missing; Electron otherwise returns an empty
 * image.
 */
export function resolveChannelIconPath(
  kind: BuildKind,
  assetsDir: string,
  exists: (p: string) => boolean,
): string {
  const preferred = path.join(assetsDir, CHANNELS[kind].iconName);
  const base = path.join(assetsDir, 'icon.png');
  return exists(preferred) ? preferred : base;
}

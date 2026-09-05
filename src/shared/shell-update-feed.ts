export type ShellUpdateBuildKind = 'prod' | 'stable' | 'preview';
export type ShellUpdatePlatform = 'darwin' | 'win32';

export interface ShellUpdateFeed {
  channel: 'prod' | 'stable';
  platform: ShellUpdatePlatform;
  url: string;
}

const CDN_ROOT = 'https://downloads.mindshub.ai/mindshub-cowork/updates';

/** Preview/dev/unknown builds fail closed until they have an isolated update feed. */
export function resolveShellUpdateFeed(
  buildKind: string | null | undefined,
  platform: string,
): ShellUpdateFeed | null {
  if (buildKind !== 'prod' && buildKind !== 'stable') return null;
  if (platform !== 'darwin' && platform !== 'win32') return null;
  const platformPath = platform === 'darwin' ? 'mac' : 'windows';
  return {
    channel: buildKind,
    platform,
    url: `${CDN_ROOT}/${buildKind}/${platformPath}`,
  };
}

/**
 * electron-updater uses the shared OS cache root. Scope by channel so one ring's checksum cleanup
 * cannot delete another ring's pending update; macOS and Windows packaging must agree.
 */
export function shellUpdaterCacheDirName(channel: ShellUpdateFeed['channel']): string {
  return `anton-updater-${channel}`;
}

/**
 * Published manifests are always latest.yml/latest-mac.yml; feed paths separate rings. Deriving
 * this channel from the package version would request an unpublished filename.
 */
export const SHELL_UPDATE_CHANNEL = 'latest';

/** Replace or append channel in app-update.yml, preserving other lines. */
export function withAppUpdateChannel(
  manifest: string,
  channel: string = SHELL_UPDATE_CHANNEL,
): string {
  return /^channel:.*$/m.test(manifest)
    ? manifest.replace(/^channel:.*$/m, `channel: ${channel}`)
    : `${manifest.replace(/\n?$/, '\n')}channel: ${channel}\n`;
}

/** Public Authenticode certificate CN, overridable at build time with COWORK_WIN_PUBLISHER_CN. */
export const WINDOWS_PUBLISHER_CN = 'Mindsdb, Inc.';

/**
 * An absent publisherName makes electron-updater skip signature verification. Pin the full
 * certificate CN, including the comma: Get-AuthenticodeSignature quotes comma-bearing RDNs and
 * parseDn preserves them. A truncated "Mindsdb" would also admit an unrelated certificate with that
 * CN. verify-win-publisher.mjs checks the real Windows signature path in CI.
 */
export function resolveWindowsPublisherNames(cn?: string | null): string[] {
  return [(cn && cn.trim()) || WINDOWS_PUBLISHER_CN];
}

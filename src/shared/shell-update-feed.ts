export type ShellUpdateBuildKind = 'prod' | 'stable' | 'preview';
export type ShellUpdatePlatform = 'darwin' | 'win32';

export interface ShellUpdateFeed {
  channel: 'prod' | 'stable';
  platform: ShellUpdatePlatform;
  url: string;
}

const CDN_ROOT = 'https://downloads.mindshub.ai/mindshub-cowork/updates';

/**
 * One feed matrix shared by packaging and runtime. Preview/dev/unknown builds
 * fail closed until they have a durable, isolated update channel.
 */
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
 * electron-updater stores pending downloads under `updaterCacheDirName` in the
 * OS cache ROOT — not per-appId userData — so stable and prod share it unless we
 * scope it. When prod is QA-enabled alongside stable, an unscoped name lets one
 * channel's checksum-mismatch cleanup empty the other's pending directory and
 * strand its ready update. Scope by channel. Baked into app-update.yml by the
 * packaging scripts (mac + win must stay in sync).
 */
export function shellUpdaterCacheDirName(channel: ShellUpdateFeed['channel']): string {
  return `anton-updater-${channel}`;
}

/** Authenticode publisher CN of our Windows installers (SSL.com EV cert). This
 *  is PUBLIC data — embedded in every signed binary — so it lives in source,
 *  not a secret. Override at build time with COWORK_WIN_PUBLISHER_CN. */
export const WINDOWS_PUBLISHER_CN = 'Mindsdb, Inc.';

/**
 * `publisherName` values for the Windows app-update.yml. electron-updater's
 * NsisUpdater SKIPS signature verification entirely when this field is absent
 * (electron-updater 6.8.9 `verifySignature` returns null on a null
 * publisherName), so a compromised feed could ship any executable — it must be
 * pinned. builder-util-runtime's `parseDn` splits the signer subject on commas,
 * so a CN containing ", Inc." is observed as the full `Mindsdb, Inc.` (Windows
 * quotes the RDN) on some hosts and a truncated `Mindsdb` (RFC2253 comma-split)
 * on others. Emit BOTH forms so the pin matches whichever the client sees —
 * both denote the same CN, so this narrows to our cert without weakening it.
 */
export function resolveWindowsPublisherNames(cn?: string | null): string[] {
  const primary = (cn && cn.trim()) || WINDOWS_PUBLISHER_CN;
  const truncated = primary.split(',')[0].trim();
  return primary === truncated ? [primary] : [primary, truncated];
}

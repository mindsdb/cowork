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

/**
 * The electron-updater channel baked into app-update.yml. It names the manifest
 * the client fetches: `<channel>.yml` on Windows, `<channel>-mac.yml` on macOS.
 *
 * A fixed, ring-stable pointer, deliberately independent of the package version.
 * Rings are separated by the feed URL path (`/stable/`, `/prod/`), and the
 * publish pipeline always writes the manifest as `latest.yml` / `latest-mac.yml`,
 * so the embedded channel must match that name. Deriving it from the version
 * would vary it per build and point at a manifest that was never published.
 */
export const SHELL_UPDATE_CHANNEL = 'latest';

/**
 * Set the `channel:` field of an app-update.yml manifest, replacing the line if
 * present or appending it. The packaging scripts use this to keep the embedded
 * channel equal to SHELL_UPDATE_CHANNEL. Returns the updated YAML; other lines
 * are left untouched.
 */
export function withAppUpdateChannel(
  manifest: string,
  channel: string = SHELL_UPDATE_CHANNEL,
): string {
  return /^channel:.*$/m.test(manifest)
    ? manifest.replace(/^channel:.*$/m, `channel: ${channel}`)
    : `${manifest.replace(/\n?$/, '\n')}channel: ${channel}\n`;
}

/** Authenticode publisher CN of our Windows installers (SSL.com EV cert). This
 *  is PUBLIC data — embedded in every signed binary — so it lives in source,
 *  not a secret. Override at build time with COWORK_WIN_PUBLISHER_CN. */
export const WINDOWS_PUBLISHER_CN = 'Mindsdb, Inc.';

/**
 * `publisherName` for the Windows app-update.yml. electron-updater's NsisUpdater
 * SKIPS signature verification entirely when this field is absent (6.8.9
 * `verifySignature` returns null on a null publisherName), so a compromised feed
 * could ship any executable — it must be pinned to our exact certificate.
 *
 * The verification path is deterministic: both the client and the CI build gate
 * read `(Get-AuthenticodeSignature).SignerCertificate.Subject`, which .NET emits
 * with comma-bearing RDNs double-quoted (`CN="Mindsdb, Inc.", ...`), so
 * builder-util-runtime's `parseDn` keeps the CN whole → `Mindsdb, Inc.`. The
 * exact full CN therefore matches on the real path and, being the complete
 * common name, uniquely identifies our EV certificate. We deliberately do NOT
 * emit a bare comma-truncated form (`Mindsdb`): a bare publisher string is
 * matched CN-only, which would also admit an unrelated cert whose CN happens to
 * be `Mindsdb` (e.g. `CN=Mindsdb, O=Unrelated Company`). The truncated form only
 * arises from non-Windows tooling (e.g. openssl on the build host) and never on
 * the Get-AuthenticodeSignature path; verify-win-publisher.mjs fails the build,
 * printing the observed subject, if the real signature ever fails to match.
 */
export function resolveWindowsPublisherNames(cn?: string | null): string[] {
  return [(cn && cn.trim()) || WINDOWS_PUBLISHER_CN];
}

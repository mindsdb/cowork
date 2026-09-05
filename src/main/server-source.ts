// Shared install-source resolution for setup and updates. See README’s install-source
// configuration.
// Explicit package overrides take precedence; PyPI otherwise uses the wheel’s anton dependency.

// Use an ESM import so vi.mock can intercept cowork-home without loading Electron.
import { buildKind } from './cowork-home';
import { CHANNELS } from './channels';

export const COWORK_SERVER_REPO = 'https://github.com/mindsdb/cowork-server.git';
export const ANTON_REPO = 'https://github.com/mindsdb/anton.git';
export const ANTON_PACKAGE = 'anton-agent';

// Static version floor for builds without a baked release version; the updater may install newer
// releases.
export const COWORK_SERVER_MIN_VERSION = '0.1.10';

export type Channel = 'git' | 'pypi';

// Packaged channels use PyPI; dev and explicit backend refs use git unless the channel is
// overridden.
// On identity resolution failure, return empty so the caller falls back to git.
function _channelForBuildKind(): string {
  try {
    const kind = buildKind();
    return kind === 'prod' || kind === 'preview' || kind === 'stable' ? 'pypi' : '';
  } catch {
    return '';
  }
}

export function getChannel(): Channel {
  const configuredChannel = process.env.COWORK_SERVER_CHANNEL || _buildVal('BUILD_COWORK_SERVER_CHANNEL');
  // An explicit backend ref implies git unless the caller explicitly selects another channel.
  const configuredRef = process.env.COWORK_SERVER_REF || _buildVal('BUILD_COWORK_SERVER_REF');
  const raw = (configuredChannel || (configuredRef.trim() ? 'git' : '') || _channelForBuildKind() || 'git').toLowerCase();
  return raw === 'pypi' ? 'pypi' : 'git';
}

/** Minimum cowork-server version for pypi-channel installs:
 *  env override > build-time baked floor > static fallback. */
export function getMinServerVersion(): string {
  return (
    (process.env.COWORK_SERVER_MIN_VERSION || _buildVal('BUILD_COWORK_SERVER_MIN_VERSION')).trim() ||
    COWORK_SERVER_MIN_VERSION
  );
}

// Generated build refs are absent before a build; runtime environment overrides take precedence.
function _buildVal(key: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./build-channel.gen') as Record<string, string>;
    return typeof mod[key] === 'string' ? mod[key] : '';
  } catch {
    return '';
  }
}

/** Prefer the baked CalVer for display, falling back to app.getVersion when unavailable. */
export function getAppDisplayVersion(): string {
  const { app } = require('electron') as typeof import('electron');
  return _buildVal('BUILD_APP_VERSION') || app.getVersion();
}

// Use the channel’s non-main server ref when no explicit or baked ref exists; failure falls back to
// main.
// Do not apply this to Anton: its default must defer to the server’s own dependency pin.
function _refForBuildKind(): string {
  try {
    const ref = CHANNELS[buildKind()].serverRef;
    return ref === 'main' ? '' : ref;
  } catch {
    return '';
  }
}

export function getCoworkRef(): string {
  return (
    (process.env.COWORK_SERVER_REF || _buildVal('BUILD_COWORK_SERVER_REF') || _refForBuildKind() || 'main').trim() ||
    'main'
  );
}

// Keep Anton’s default unchanged so getInstallSpec can defer to the server’s dependency pin.
export function getAntonRef(): string {
  return (process.env.ANTON_REF || _buildVal('BUILD_ANTON_REF') || 'main').trim() || 'main';
}

export interface InstallSpec {
  /** Positional argument to `uv tool install`. */
  package: string;
  /**
   * UV_OVERRIDE requirements replace the server’s source pins without conflicting URLs.
   * writeUvOverrides materializes the file; older uv versions do not support --no-sources-package.
   */
  overrides: string[];
  channel: Channel;
}

/** Build the `uv tool install` spec for the current channel/refs.
 *  Pass explicit refs (e.g. a previous commit) for rollback installs. */
export function getInstallSpec(opts?: { coworkRef?: string; antonRef?: string }): InstallSpec {
  // Explicit escape hatch wins over everything (local path, custom URL, …).
  const explicit = process.env.COWORK_SERVER_PACKAGE;
  if (explicit) {
    const antonPackage = process.env.ANTON_PACKAGE;
    const overrides = antonPackage ? [`${ANTON_PACKAGE} @ ${antonPackage}`] : [];
    return { package: explicit, overrides, channel: getChannel() };
  }

  // Updater-supplied refs describe an existing git install, even in a PyPI-default build.
  // Honor them for both updates and rollback instead of silently migrating the installed source.
  const explicitRefs = Boolean(opts?.coworkRef || opts?.antonRef);

  if (!explicitRefs && getChannel() === 'pypi') {
    return { package: `cowork-server>=${getMinServerVersion()}`, overrides: [], channel: 'pypi' };
  }

  // git channel (default), or updater-supplied explicit refs
  const coworkRef = opts?.coworkRef || getCoworkRef();
  const antonRef = opts?.antonRef || getAntonRef();

  // Default Anton to the server’s own source pin. For explicit refs use UV_OVERRIDE, not a
  // competing --with URL.
  // Overrides also work on older uv versions that lack --no-sources-package.
  const overrides =
    antonRef === 'main'
      ? []
      : [`${ANTON_PACKAGE} @ git+${ANTON_REPO}@${antonRef}`];

  return {
    package: `git+${COWORK_SERVER_REPO}@${coworkRef}`,
    overrides,
    channel: 'git',
  };
}

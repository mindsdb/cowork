// Single source of truth for WHERE the cowork-server backend (and the
// anton agent it depends on) are installed from. Both the installer and
// the auto-updater import this so they can never disagree about the
// source — the bug that previously let the PyPI updater clobber a
// git-branch install.
//
// Default: install from git, branch `main`, for BOTH cowork-server and
// anton. A developer (or the parent `minds` repo) can point either at a
// feature branch / tag / commit via env vars while iterating; a release
// flips the channel to the published PyPI wheel.
//
//   COWORK_SERVER_CHANNEL   git | pypi            (default: git)
//   COWORK_SERVER_REF       branch|tag|sha        (default: main)  — git channel
//   ANTON_REF               branch|tag|sha        (default: main)  — git channel
//   COWORK_SERVER_PACKAGE   literal uv spec       (escape hatch; wins over all)
//   ANTON_PACKAGE           literal uv spec       (local path / spec for anton;
//                           only honoured when COWORK_SERVER_PACKAGE is also set.
//                           Requires backend/core_api/pyproject.toml [tool.uv.sources]
//                           to be updated to { path = "../../core_agent" } first —
//                           otherwise uv aborts with "conflicting URLs".)
//
// On the `pypi` channel anton comes from the published wheel's pinned
// dependency, so ANTON_REF is ignored there.

export const COWORK_SERVER_REPO = 'https://github.com/mindsdb/cowork-server.git';
// export const COWORK_SERVER_BRANCH = 'main';
export const ANTON_REPO = 'https://github.com/mindsdb/anton.git';
export const ANTON_PACKAGE = 'anton-agent';

// Minimum version for the PyPI channel (a floor; newer compatible
// releases are picked up automatically). Keep in sync with installer.ts.
export const COWORK_SERVER_MIN_VERSION = '0.1.10';

export type Channel = 'git' | 'pypi';

export function getChannel(): Channel {
  return (process.env.COWORK_SERVER_CHANNEL || 'git').toLowerCase() === 'pypi' ? 'pypi' : 'git';
}

// Build-time baked refs (written by scripts/gen-build-channel.mjs via
// prebuild:main). The file is gitignored and only exists after a build — in
// dev mode the Makefile-exported env vars take priority anyway.
function _buildVal(key: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./build-channel.gen') as Record<string, string>;
    return typeof mod[key] === 'string' ? mod[key] : '';
  } catch {
    return '';
  }
}

/** CalVer display version baked at build time. Falls back to app.getVersion()
 *  (package.json SemVer) when no build-time value is available. Use this
 *  instead of app.getVersion() everywhere the user-facing version is shown
 *  (About panel, IPC, settings). */
export function getAppDisplayVersion(): string {
  const { app } = require('electron') as typeof import('electron');
  return _buildVal('BUILD_APP_VERSION') || app.getVersion();
}

export function getCoworkRef(): string {
  return (process.env.COWORK_SERVER_REF || _buildVal('BUILD_COWORK_SERVER_REF') || 'main').trim() || 'main';
}

export function getAntonRef(): string {
  return (process.env.ANTON_REF || _buildVal('BUILD_ANTON_REF') || 'main').trim() || 'main';
}

export interface InstallSpec {
  /** Positional argument to `uv tool install`. */
  package: string;
  /** Requirement lines to force via a uv overrides file (`UV_OVERRIDE`).
   *  Used to repoint cowork-server's `[tool.uv.sources]` anton-agent pin at a
   *  different ref/path. An override REPLACES the requirement, so it wins over
   *  the sources pin cleanly — no "conflicting URLs" abort like a bare `--with`,
   *  and, unlike `--no-sources-package`, it is understood by every uv version we
   *  ship against (older uv builds reject that flag). Empty on the default path.
   *  Materialized into a temp file by `writeUvOverrides` in uv-paths.ts. */
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

  if (getChannel() === 'pypi') {
    return { package: `cowork-server>=${COWORK_SERVER_MIN_VERSION}`, overrides: [], channel: 'pypi' };
  }

  // git channel (default)
  const coworkRef = opts?.coworkRef || getCoworkRef();
  const antonRef = opts?.antonRef || getAntonRef();

  // By default (ANTON_REF=main), let cowork-server's own `[tool.uv.sources]`
  // pin decide which anton-agent to pull — that is the version cowork-server
  // requires, and it keeps cowork-server's pyproject identical across the
  // main/staging branches (so merging staging → main never drags an anton ref
  // along).
  //
  // For a non-default ANTON_REF (e.g. a staging build pinning anton@staging),
  // we repoint the ref from HERE rather than in cowork-server. A bare
  // `--with anton-agent @ git+...` is NOT an override: uv treats it as a
  // *second* URL requirement alongside the sources pin and aborts with
  // "Requirements contain conflicting URLs for package `anton-agent`". Feeding
  // the same requirement through a uv OVERRIDE instead replaces the sources
  // pin outright and resolves cleanly — and, crucially, overrides are honoured
  // by every uv version (the per-package `--no-sources-package` flag is not:
  // older uv builds reject it with "unexpected argument", which broke installs
  // on machines carrying a stale uv).
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

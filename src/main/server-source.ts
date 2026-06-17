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
//   COWORK_SERVER_CHANNEL   git | pypi         (default: git)
//   COWORK_SERVER_REF       branch|tag|sha     (default: main)  — git channel
//   ANTON_REF               branch|tag|sha     (default: main)  — git channel
//   COWORK_SERVER_PACKAGE   literal uv spec    (escape hatch; wins over all)
//
// On the `pypi` channel anton comes from the published wheel's pinned
// dependency, so ANTON_REF is ignored there.

export const COWORK_SERVER_REPO = 'https://github.com/mindsdb/cowork-server.git';
export const ANTON_REPO = 'https://github.com/mindsdb/anton.git';
export const ANTON_PACKAGE = 'anton-agent';

// Minimum version for the PyPI channel (a floor; newer compatible
// releases are picked up automatically). Keep in sync with installer.ts.
export const COWORK_SERVER_MIN_VERSION = '0.1.5';

export type Channel = 'git' | 'pypi';

export function getChannel(): Channel {
  return (process.env.COWORK_SERVER_CHANNEL || 'git').toLowerCase() === 'pypi' ? 'pypi' : 'git';
}

export function getCoworkRef(): string {
  return (process.env.COWORK_SERVER_REF || 'main').trim() || 'main';
}

export function getAntonRef(): string {
  return (process.env.ANTON_REF || 'main').trim() || 'main';
}

export interface InstallSpec {
  /** Positional argument to `uv tool install`. */
  package: string;
  /** Extra args (e.g. `--with <spec>` pairs) appended to the install command. */
  withArgs: string[];
  channel: Channel;
}

/** Build the `uv tool install` spec for the current channel/refs.
 *  Pass explicit refs (e.g. a previous commit) for rollback installs. */
export function getInstallSpec(opts?: { coworkRef?: string; antonRef?: string }): InstallSpec {
  // Explicit escape hatch wins over everything (local path, custom URL, …).
  const explicit = process.env.COWORK_SERVER_PACKAGE;
  if (explicit) {
    return { package: explicit, withArgs: [], channel: getChannel() };
  }

  if (getChannel() === 'pypi') {
    return { package: `cowork-server>=${COWORK_SERVER_MIN_VERSION}`, withArgs: [], channel: 'pypi' };
  }

  // git channel (default)
  const coworkRef = opts?.coworkRef || getCoworkRef();
  const antonRef = opts?.antonRef || getAntonRef();
  return {
    package: `git+${COWORK_SERVER_REPO}@${coworkRef}`,
    // Force anton to the requested ref, overriding cowork-server's own
    // tool.uv.sources pin. Verified `--with` takes precedence over the
    // source declared in the installed project's pyproject.
    withArgs: ['--with', `${ANTON_PACKAGE} @ git+${ANTON_REPO}@${antonRef}`],
    channel: 'git',
  };
}

// Single source of truth for WHERE the cowork-server backend (and the
// anton agent it depends on) are installed from. Both the installer and
// the auto-updater import this so they can never disagree about the
// source — the bug that previously let the PyPI updater clobber a
// git-branch install.
//
// Default: install from git, using the branch cowork was built from (baked
// at build time by scripts/stamp-branch.js). Building on `main` installs
// from main; building on `staging` installs from staging — automatically.
// Env vars still override for one-off testing; a release flips the channel
// to the published PyPI wheel.
//
//   COWORK_SERVER_CHANNEL   git | pypi         (default: git)
//   COWORK_SERVER_REF       branch|tag|sha     (default: build branch)  — git channel
//   ANTON_REF               branch|tag|sha     (default: build branch)  — git channel
//   COWORK_SERVER_PACKAGE   literal uv spec    (escape hatch; wins over all)
//
// On the `pypi` channel anton comes from the published wheel's pinned
// dependency, so ANTON_REF is ignored there.

// The default git ref is baked at build time by scripts/stamp-branch.js so
// that a packaged staging build automatically pulls cowork-server and anton
// from the matching branch — no manual edits or env vars needed.
let BUILD_BRANCH = 'main';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  BUILD_BRANCH = require('./build-branch.json').branch;
} catch { /* file absent pre-build → default to main */ }

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
  return (process.env.COWORK_SERVER_REF || BUILD_BRANCH).trim() || 'main';
}

export function getAntonRef(): string {
  return (process.env.ANTON_REF || BUILD_BRANCH).trim() || 'main';
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

  // Let cowork-server's own `[tool.uv.sources]` pin decide which anton-agent
  // to pull when both repos are on the same branch — that pin already points
  // at the right branch.
  //
  // Only inject `--with` when ANTON_REF explicitly diverges from the
  // cowork-server ref (e.g. testing a one-off anton feature branch against
  // a stable cowork-server). Passing `--with` when the URLs match causes
  // uv to error with "conflicting URLs for package `anton-agent`".
  const withArgs =
    antonRef === coworkRef
      ? []
      : ['--with', `${ANTON_PACKAGE} @ git+${ANTON_REPO}@${antonRef}`];

  return {
    package: `git+${COWORK_SERVER_REPO}@${coworkRef}`,
    withArgs,
    channel: 'git',
  };
}

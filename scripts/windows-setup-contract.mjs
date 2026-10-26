import { win32 } from 'node:path';

// Windows ships part of its root list and downloads the rest the first time a
// program verifies a chain through Windows, into LocalMachine\AuthRoot. The hosted
// runner image instead holds over 500 roots and turns those downloads off. Python's
// own TLS never asks Windows to download a root, so a runner that still holds these
// would pass an installer a fresh machine fails.
export const ON_DEMAND_ROOTS = Object.freeze({
  D69B561148F01C77C54578C10926DF5B856976AD: 'GlobalSign Root CA - R3', // pypi.org, files.pythonhosted.org
  CABD2A79A1076A31F21D253635CB039D4329A5E8: 'ISRG Root X1', // raw.githubusercontent.com, GitHub release assets
});

// The LocalMachine\Root view includes AuthRoot, and CurrentUser\Root is the merged
// view Python reads. CurrentUser\Root is checked, never edited, because deleting
// from it opens a confirmation dialog no CI run can answer.
export const ROOT_STORES = Object.freeze(['LocalMachine\\AuthRoot', 'LocalMachine\\Root', 'CurrentUser\\Root']);

// The runner reports the job's end over Windows TLS, so a workflow step restores
// these from RUNNER_TEMP before the job ends: the removed certificates, one folder
// per store, and the root-download settings the trim cleared.
export const ROOT_BACKUP = 'cowork-removed-roots';
export const ROOT_AUTO_UPDATE_BACKUP = 'cowork-root-auto-update.json';

/** @typedef {{store: string, thumbprint: string, subject: string}} StoreEntry */

function named(entry) {
  return Object.hasOwn(ON_DEMAND_ROOTS, entry.thumbprint.toUpperCase());
}

/** Every downloaded root, plus the named roots wherever the runner image installed them. */
export function rootsToRemove(entries) {
  return entries.filter((entry) => entry.store === 'LocalMachine\\AuthRoot' || (entry.store === 'LocalMachine\\Root' && named(entry)));
}

/**
 * The removal input for the harness's fixed PowerShell: exactly the planned
 * certificates, AuthRoot first, since removing one there also removes it from the
 * Root view. Anything else is refused.
 */
export function removalPlan(entries) {
  const plan = entries.map(({ store, thumbprint }) => {
    if (!['LocalMachine\\AuthRoot', 'LocalMachine\\Root'].includes(store) || !/^[0-9A-F]{40}$/.test(thumbprint)) {
      throw new Error(`Refusing to remove ${store} ${thumbprint}.`);
    }
    return { store: store.slice('LocalMachine\\'.length), thumbprint };
  });
  return [...plan.filter((entry) => entry.store === 'AuthRoot'), ...plan.filter((entry) => entry.store === 'Root')];
}

/** Checked while the image still blocks root downloads, so no root can come back yet. */
export function assertRemoved({ entries }) {
  const downloaded = entries.filter((entry) => entry.store === 'LocalMachine\\AuthRoot');
  if (downloaded.length) throw new Error(`${downloaded.length} downloaded roots remain in LocalMachine\\AuthRoot.`);
}

/**
 * The trimmed runner must trust, and download, what a fresh install does before setup starts.
 * Once downloads are back on, any program on the runner may bring back other roots, as on a
 * fresh machine; only the named roots would hide the failure this smoke exists to catch.
 */
export function assertTrimmed({ entries, rootAutoUpdateOff }) {
  if (rootAutoUpdateOff.policy || rootAutoUpdateOff.setting) throw new Error('Windows root downloads are still turned off.');
  const visible = entries.filter(named);
  if (visible.length) {
    throw new Error(`Still trusted after trimming: ${visible.map((entry) => `${ON_DEMAND_ROOTS[entry.thumbprint.toUpperCase()]} in ${entry.store}`).join(', ')}.`);
  }
}

/**
 * An allowlist keeps CI tokens, provider configuration, source overrides and the
 * runner's tool directories (which carry uv, Python and git) out of the app.
 * Node, uv and the uv installer locate the home and app-data folders through
 * these variables, so they all land in the fresh profile.
 */
export function appEnvironment(profile, port, system) {
  const root = system.SystemRoot;
  return {
    SystemRoot: root, windir: root, SystemDrive: system.SystemDrive,
    ComSpec: win32.join(root, 'System32', 'cmd.exe'), PATHEXT: system.PATHEXT,
    PATH: [win32.join(root, 'System32'), root, win32.join(root, 'System32', 'Wbem'), win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    ProgramData: system.ProgramData, ProgramFiles: system.ProgramFiles, 'ProgramFiles(x86)': system['ProgramFiles(x86)'],
    NUMBER_OF_PROCESSORS: system.NUMBER_OF_PROCESSORS, PROCESSOR_ARCHITECTURE: system.PROCESSOR_ARCHITECTURE, OS: system.OS,
    USERNAME: system.USERNAME, USERDOMAIN: system.USERDOMAIN, COMPUTERNAME: system.COMPUTERNAME,
    USERPROFILE: profile, HOME: profile,
    APPDATA: win32.join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: win32.join(profile, 'AppData', 'Local'),
    TEMP: win32.join(profile, 'tmp'), TMP: win32.join(profile, 'tmp'), LANG: 'en_US.UTF-8',
    COWORK_SERVER_PORT: String(port),
    UV_CACHE_DIR: win32.join(profile, 'uv-cache'), UV_PYTHON_INSTALL_DIR: win32.join(profile, 'uv-python'),
  };
}

/**
 * The per-user NSIS install's executable, from its uninstall registration. The
 * registration carries no InstallLocation, and the folder is named after the
 * package rather than the product, so the icon path is what names the executable.
 */
export function installedExecutable(registrations, productName, programs) {
  const escaped = productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = registrations.filter((entry) => new RegExp(`^${escaped}(?: [0-9].*)?$`).test(entry.displayName ?? ''));
  if (matches.length !== 1) throw new Error(`Expected one ${productName} installation, found ${matches.length}.`);
  const [{ displayIcon }] = matches;
  const executable = (displayIcon ?? '').replace(/^"|"?(?:,\s*-?\d+)?$/g, '');
  const installLocation = win32.dirname(executable);
  const folder = win32.relative(programs, installLocation);
  if (win32.basename(executable).toLowerCase() !== `${productName}.exe`.toLowerCase() || !folder || folder.startsWith('..') || win32.isAbsolute(folder) || folder.includes('\\')) {
    throw new Error(`Installed executable is not this product in the per-user Programs folder: ${displayIcon}`);
  }
  return { installLocation, executable };
}

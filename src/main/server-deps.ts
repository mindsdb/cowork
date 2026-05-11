import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

// Runtime dependencies needed by the Anton-packaged Cowork FastAPI server.
// Keep this as the single source of truth for install, verification, and
// server startup gating.
export const SERVER_PYTHON_DEPS: Array<{ spec: string; importName: string }> = [
  { spec: 'fastapi>=0.115.0', importName: 'fastapi' },
  { spec: 'uvicorn[standard]>=0.32.0', importName: 'uvicorn' },
  // python-multipart is the package name, the import is `multipart`.
  { spec: 'python-multipart>=0.0.12', importName: 'multipart' },
  { spec: 'pydantic>=2.0.0', importName: 'pydantic' },
];

export const ANTON_COWORK_SERVER_EXTRA = 'cowork-server';
export const ANTON_COWORK_SERVER_PROTOCOL_VERSION = 1;

// Anton version constraints for this Cowork release.
//
// ANTON_MIN_VERSION: the oldest Anton release this Cowork app has been
//   tested against. The server startup flow rejects running servers
//   below this version. Bump when new Cowork code depends on a feature
//   or fix introduced in a specific Anton release.
//
// ANTON_MAX_VERSION: the newest Anton release this Cowork app has been
//   tested against. The self-updater skips releases beyond this version
//   so a new Anton release can't break a Cowork app that hasn't been
//   updated to expect it. Set to null to allow any version (chase latest).
//   Bump when Cowork has been validated against a newer Anton release.
//
// ANTON_INSTALL_REF: the git ref used for fresh installs. Typically
//   matches ANTON_MAX_VERSION so new users get the tested version.
//   Set to null to install from HEAD of main (latest).
export const ANTON_MIN_VERSION: string | null = null;
export const ANTON_MAX_VERSION: string | null = null;
export const ANTON_INSTALL_REF: string | null = null;

export function getAntonGitSpec(ref?: string): string {
  const effectiveRef = ref ?? ANTON_INSTALL_REF;
  const suffix = effectiveRef ? `@${effectiveRef}` : '';
  return `anton[${ANTON_COWORK_SERVER_EXTRA}] @ git+https://github.com/mindsdb/anton.git${suffix}`;
}

function getServerPythonImports(includeCoworkServer: boolean): string[] {
  return [
    ...SERVER_PYTHON_DEPS.map((d) => d.importName),
    ...(includeCoworkServer ? ['anton.cowork.server.main'] : []),
  ];
}

export function getUvDataHome(): string {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  return path.join(os.homedir(), '.local', 'share');
}

export function getAntonToolPython(): string {
  return path.join(
    getUvDataHome(),
    'uv',
    'tools',
    'anton',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
}

export function getPythonUtf8Env(): NodeJS.ProcessEnv {
  return {
    PYTHONUTF8: process.env.PYTHONUTF8 || '1',
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
  };
}

export function getServerDepsImportScript(includeCoworkServer: boolean = true): string {
  return [
    'import importlib',
    ...getServerPythonImports(includeCoworkServer).map((name) => `importlib.import_module(${JSON.stringify(name)})`),
  ].join('; ');
}

export function getServerDepsVerifyScript(includeCoworkServer: boolean = true): string {
  return [
    'import importlib',
    ...getServerPythonImports(includeCoworkServer).map((name) => (
      `_m = importlib.import_module(${JSON.stringify(name)}); ` +
      `print('ok ${name}', getattr(_m, '__version__', '?'))`
    )),
  ].join(';\n');
}

// Simple semver-ish comparison. Handles dotted numeric versions like
// "2.26.5.7.4". Returns -1, 0, or 1 (a < b, a == b, a > b).
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

// Check whether a server's reported anton_version falls within the
// version range this Cowork app supports. Returns null if compatible,
// or an error message string if not.
export function checkAntonVersionCompat(antonVersion: string | undefined): string | null {
  if (!antonVersion || antonVersion === 'unknown') return null; // can't enforce
  if (ANTON_MIN_VERSION && compareVersions(antonVersion, ANTON_MIN_VERSION) < 0) {
    return `Anton ${antonVersion} is too old for this Cowork app (requires >= ${ANTON_MIN_VERSION}). Update Anton or reinstall.`;
  }
  if (ANTON_MAX_VERSION && compareVersions(antonVersion, ANTON_MAX_VERSION) > 0) {
    return `Anton ${antonVersion} is newer than this Cowork app supports (tested up to ${ANTON_MAX_VERSION}). Update the Cowork app.`;
  }
  return null;
}

// Python snippet that the self-updater evaluates to decide whether to
// skip a release. Emits the max version constraint (or "none") so the
// updater can compare before installing.
export function getAntonMaxVersionForUpdater(): string | null {
  return ANTON_MAX_VERSION;
}

export function checkPythonImports(
  pythonPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number = 8000,
  includeCoworkServer: boolean = true,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn(
      pythonPath,
      ['-c', getServerDepsImportScript(includeCoworkServer)],
      { env: { ...env, ...getPythonUtf8Env() }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      try { proc.kill('SIGTERM'); } catch {}
      finish(false);
    }, timeoutMs);
    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(ok);
    };
    proc.on('close', (code) => finish(code === 0));
    proc.on('error', () => finish(false));
  });
}

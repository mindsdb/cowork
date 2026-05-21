import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

// Runtime dependencies needed by the bundled FastAPI sidecar in server/.
// Keep this as the single source of truth for install, verification, and
// server startup gating.
export const SERVER_PYTHON_DEPS: Array<{ spec: string; importName: string }> = [
  { spec: 'fastapi>=0.115.0', importName: 'fastapi' },
  { spec: 'uvicorn[standard]>=0.32.0', importName: 'uvicorn' },
  // python-multipart is the package name, the import is `multipart`.
  { spec: 'python-multipart>=0.0.12', importName: 'multipart' },
  { spec: 'pydantic>=2.0.0', importName: 'pydantic' },
  { spec: 'httpx[http2]>=0.27.0', importName: 'h2' },
  // slack-sdk powers Slack Socket Mode (dispatch_slack._run_socket_mode).
  // It is not an Anton dependency, so without this the bare editable
  // install drops it and Socket Mode silently falls back to disabled.
  { spec: 'slack-sdk>=3.27.0', importName: 'slack_sdk' },
];

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

export function getServerDepsImportScript(): string {
  return SERVER_PYTHON_DEPS
    .map((d) => `import ${d.importName}`)
    .join('; ');
}

export function getServerDepsVerifyScript(): string {
  return SERVER_PYTHON_DEPS.map((d) => (
    `import ${d.importName} as _${d.importName}; ` +
    `print('ok ${d.importName}', getattr(_${d.importName}, '__version__', '?'))`
  )).join(';\n');
}

export function checkPythonImports(
  pythonPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number = 4000,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn(
      pythonPath,
      ['-c', getServerDepsImportScript()],
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

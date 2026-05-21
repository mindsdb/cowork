import { spawn, execFile } from 'child_process';
import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IPC } from '../shared/ipc-channels';
import { sendEvent } from './analytics';
import {
  SERVER_PYTHON_DEPS,
  checkPythonImports,
  getAntonToolPython,
  getPythonUtf8Env,
  getServerDepsVerifyScript,
} from './server-deps';

interface InstallStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'warning';
}

interface InstallerOptions {
  shouldAbort?: () => boolean;
}

function getSteps(): InstallStep[] {
  const steps: InstallStep[] = [];
  if (process.platform === 'darwin') {
    steps.push({ id: 'xcode', label: 'Xcode Command Line Tools', status: 'pending' });
  }
  steps.push(
    { id: 'git', label: 'Check for git (required)', status: 'pending' },
    { id: 'uv', label: 'Install uv (Python package manager)', status: 'pending' },
    { id: 'anton', label: 'Install Anton (with server extras)', status: 'pending' },
    { id: 'verify', label: 'Verify installation', status: 'pending' },
    { id: 'server', label: 'Start Anton server', status: 'pending' },
  );
  return steps;
}

function getLocalBin(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), '.local', 'bin');
  }
  return path.join(os.homedir(), '.local', 'bin');
}

function getAntonBinary(): string {
  const localBin = getLocalBin();
  if (process.platform === 'win32') {
    return path.join(localBin, 'anton.exe');
  }
  return path.join(localBin, 'anton');
}

function getUvBinary(): string {
  const localBin = getLocalBin();
  if (process.platform === 'win32') {
    return path.join(localBin, 'uv.exe');
  }
  return path.join(localBin, 'uv');
}

function getEnvPath(): string {
  const localBin = getLocalBin();
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  const parts = [localBin, cargoBin, currentPath];
  return parts.join(path.delimiter);
}

function canSend(win: BrowserWindow): boolean {
  return !win.isDestroyed() && !win.webContents.isDestroyed();
}

function sendLog(win: BrowserWindow, message: string) {
  if (!canSend(win)) return;
  try {
    win.webContents.send(IPC.INSTALL_LOG, message);
  } catch {}
}

function sendProgress(win: BrowserWindow, steps: InstallStep[]) {
  if (!canSend(win)) return;
  try {
    win.webContents.send(IPC.INSTALL_PROGRESS, JSON.parse(JSON.stringify(steps)));
  } catch {}
}

function runCommand(
  command: string,
  args: string[],
  win: BrowserWindow,
  opts?: { shell?: boolean; shouldAbort?: () => boolean }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      PATH: getEnvPath(),
      // Windows GUI launches can inherit a legacy code page. Keep Python
      // subprocess output deterministic so installer verification never
      // fails after successful imports because stdout cannot encode text.
      ...getPythonUtf8Env(),
    };
    const proc = spawn(command, args, {
      env,
      shell: opts?.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const finish = (code: number, out: string, err: string) => {
      if (resolved) return;
      resolved = true;
      clearInterval(abortWatcher);
      resolve({ code, stdout: out, stderr: err });
    };

    const abortWatcher = setInterval(() => {
      if (!opts?.shouldAbort?.()) return;
      stderr += 'Installation cancelled by user.\n';
      proc.kill('SIGTERM');
    }, 300);

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      sendLog(win, text);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      sendLog(win, text);
    });

    proc.on('close', (code) => {
      finish(code ?? 1, stdout, stderr);
    });

    proc.on('error', (err) => {
      sendLog(win, `Error: ${err.message}\n`);
      finish(1, stdout, err.message);
    });
  });
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: getEnvPath() };
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(whichCmd, [cmd], { env }, (err) => {
      resolve(!err);
    });
  });
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function xcodeCliInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    // xcode-select -p returns 0 if CLT are installed
    execFile('xcode-select', ['-p'], (err) => {
      resolve(!err);
    });
  });
}

function triggerXcodeInstall(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    // Try xcode-select --install first — needs stdio piped so the system dialog can launch
    const proc = spawn('xcode-select', ['--install'], { stdio: 'pipe' });
    let stderr = '';
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        // Dialog was launched successfully
        resolve(true);
        return;
      }
      // xcode-select --install failed (e.g. inside sandbox), try open(1) as fallback
      sendLog(win, 'Trying alternate install method...\n');
      const fallback = spawn('open', ['/System/Library/CoreServices/Install Command Line Developer Tools.app']);
      fallback.on('close', (fbCode) => {
        resolve(fbCode === 0);
      });
      fallback.on('error', () => resolve(false));
    });
    proc.on('error', () => {
      // xcode-select binary not found — shouldn't happen on macOS but handle it
      resolve(false);
    });
  });
}

function waitForXcodeInstall(
  win: BrowserWindow,
  timeoutMs: number = 600000,
  shouldAbort?: () => boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    let elapsed = 0;
    const interval = 3000;
    const check = () => {
      if (shouldAbort?.()) {
        resolve(false);
        return;
      }
      xcodeCliInstalled().then((installed) => {
        if (installed) {
          resolve(true);
          return;
        }
        elapsed += interval;
        if (elapsed >= timeoutMs) {
          resolve(false);
          return;
        }
        if (!win.isDestroyed()) {
          sendLog(win, '.');
        }
        setTimeout(check, interval);
      });
    };
    check();
  });
}

function sendInstallError(win: BrowserWindow, message: string) {
  if (!canSend(win)) return;
  try {
    win.webContents.send(IPC.INSTALL_ERROR, message);
  } catch {}
}

function sendInstallCancelled(win: BrowserWindow) {
  if (!canSend(win)) return;
  try {
    win.webContents.send(IPC.INSTALL_CANCELLED);
  } catch {}
}

export async function checkAntonInstalled(): Promise<boolean> {
  if (fileExists(getAntonBinary())) return true;
  return commandExists('anton');
}

// True iff every server-runtime Python dependency imports cleanly
// from the tool venv. Catches the common case where a user already
// has `anton` (CLI) installed via `uv tool install anton` or
// `pip install anton` — but WITHOUT the server extras (fastapi,
// uvicorn, etc.) that the bundled FastAPI server in server/main.py
// needs to spawn. Without this check, antontron would skip its setup
// screen and the server would silently fail to start with a Python
// ImportError surfaced as a generic "backend offline."
export async function checkServerDepsReady(): Promise<boolean> {
  const py = getAntonToolPython();
  if (!fileExists(py)) return false;
  return checkPythonImports(py, { ...process.env, PATH: getEnvPath() });
}

// Convenience wrapper used by the boot flow IPC. Returns the full
// readiness picture so the renderer can branch cleanly: setup is
// needed when EITHER the CLI binary OR the server deps are missing.
export async function checkInstallStatus(): Promise<{
  antonInstalled: boolean;
  serverDepsReady: boolean;
}> {
  const antonInstalled = await checkAntonInstalled();
  // Only probe the deps if the tool itself is present — without it
  // there's no python interpreter to import from.
  const serverDepsReady = antonInstalled ? await checkServerDepsReady() : false;
  return { antonInstalled, serverDepsReady };
}

export async function runInstaller(win: BrowserWindow, opts?: InstallerOptions): Promise<boolean> {
  const steps = getSteps();
  const shouldAbort = opts?.shouldAbort ?? (() => false);

  const setStep = (id: string, status: InstallStep['status']) => {
    const step = steps.find((s) => s.id === id);
    if (step) step.status = status;
    sendProgress(win, steps);
  };

  const abortIfRequested = () => {
    if (!shouldAbort()) return false;
    const runningStep = steps.find((step) => step.status === 'running');
    if (runningStep) {
      runningStep.status = 'skipped';
    }
    for (const step of steps) {
      if (step.status === 'pending') {
        step.status = 'skipped';
      }
    }
    sendProgress(win, steps);
    sendLog(win, '\nInstallation cancelled by user.\n');
    sendInstallCancelled(win);
    return true;
  };

  try {
    if (abortIfRequested()) return false;

    // Step 0 (macOS only): Xcode Command Line Tools
    if (process.platform === 'darwin') {
      setStep('xcode', 'running');
      sendLog(win, '--- Checking for Xcode Command Line Tools ---\n');
      const hasXcode = await xcodeCliInstalled();
      if (!hasXcode) {
        if (abortIfRequested()) return false;
        sendLog(win, 'Xcode Command Line Tools not found.\n');
        sendLog(win, 'Attempting to launch installer — please click "Install" in the system dialog.\n');
        const triggered = await triggerXcodeInstall(win);
        if (triggered) {
          sendLog(win, 'Installer launched. Continuing with dependency checks while CLT installs.\n');
          sendLog(win, 'You can also install manually from Terminal: xcode-select --install\n');
          const installedQuickly = await waitForXcodeInstall(win, 15000, shouldAbort);
          if (installedQuickly) {
            sendLog(win, 'Xcode Command Line Tools installed.\n');
            setStep('xcode', 'done');
          } else {
            sendLog(win, 'Xcode Command Line Tools still installing in background (non-blocking).\n');
            setStep('xcode', 'warning');
          }
        } else {
          sendLog(win, 'Could not launch Xcode installer automatically.\n');
          sendLog(win, 'Please run manually in Terminal: xcode-select --install\n');
          sendLog(win, 'Alternative fallback: install Homebrew first, then run brew install git\n');
          setStep('xcode', 'warning');
        }
      } else {
        sendLog(win, 'Xcode Command Line Tools found.\n');
        setStep('xcode', 'done');
      }
    }

    if (abortIfRequested()) return false;

    // Step 1: Check git
    setStep('git', 'running');
    sendLog(win, '--- Checking for git ---\n');
    const hasGit = await commandExists('git');
    if (!hasGit) {
      setStep('git', 'error');
      sendLog(win, '\nERROR: git is not installed.\n');
      if (process.platform === 'darwin') {
        sendLog(win, 'Install it with: xcode-select --install\n');
        sendLog(win, 'Alternative: install Homebrew then run: brew install git\n');
      } else {
        sendLog(win, 'Install it from: https://git-scm.com/downloads/win\n');
      }
      sendInstallError(win, 'git is required but not found. Install CLT (xcode-select --install) or Homebrew git.');
      return false;
    }
    sendLog(win, 'git found.\n');
    setStep('git', 'done');

    // Step 2: Check/install uv
    if (abortIfRequested()) return false;
    setStep('uv', 'running');
    sendLog(win, '\n--- Checking for uv ---\n');
    let hasUv = await commandExists('uv') || fileExists(getUvBinary());

    if (!hasUv) {
      sendLog(win, 'uv not found. Installing...\n');
      if (process.platform === 'win32') {
        const result = await runCommand(
          'powershell',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
           "& ([scriptblock]::Create((Invoke-RestMethod https://astral.sh/uv/install.ps1)))"],
          win,
          { shouldAbort }
        );
        if (abortIfRequested()) return false;
        if (result.code !== 0) {
          setStep('uv', 'error');
          sendInstallError(win, 'Failed to install uv');
          return false;
        }
      } else {
        const result = await runCommand(
          'sh',
          ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'],
          win,
          { shell: false, shouldAbort }
        );
        if (abortIfRequested()) return false;
        if (result.code !== 0) {
          setStep('uv', 'error');
          sendInstallError(win, 'Failed to install uv');
          return false;
        }
      }
      // Verify uv installed
      hasUv = await commandExists('uv') || fileExists(getUvBinary());
      if (!hasUv) {
        setStep('uv', 'error');
        sendLog(win, 'ERROR: uv installation completed but binary not found.\n');
        sendInstallError(win, 'uv installation failed');
        return false;
      }
      sendLog(win, 'uv installed successfully.\n');
    } else {
      sendLog(win, 'uv found.\n');
    }
    setStep('uv', 'done');

    // Step 3: Install Anton (with fastapi + uvicorn + multipart + pydantic
    // so the bundled FastAPI server in server/main.py can actually start).
    if (abortIfRequested()) return false;
    setStep('anton', 'running');
    sendLog(win, '\n--- Installing Anton (with server extras) ---\n');
    sendLog(win, 'Server extras:\n');
    for (const dep of SERVER_PYTHON_DEPS) {
      sendLog(win, `  - ${dep.spec}\n`);
    }

    // Build the args list dynamically so the dep set lives in ONE place
    // (SERVER_PYTHON_DEPS). Each spec is appended as a separate `--with`
    // arg — `uv tool install` requires a flag per package.
    // ANTON_DEV_PATH lets a local checkout take priority over the published
    // release. Set it in ~/.anton/.env (e.g. ANTON_DEV_PATH=/path/to/anton)
    // to pin cowork to a local branch. When absent, the normal git+PyPI
    // install path is used unchanged.
    const antonDevPath = (process.env.ANTON_DEV_PATH || '').trim();
    const antonSource = antonDevPath
      ? antonDevPath
      : 'git+[DS_GITHUB_GITHUB_1__BASE_URL]/mindsdb/anton.git';

    const installArgs = [
      'tool', 'install',
    ];
    // For a local checkout, install editable (-e) so source edits take
    // effect without a reinstall — that is the whole point of pinning to
    // a local branch. Without -e, `uv tool install <dir>` COPIES the
    // source into the tool venv's site-packages and edits are silently
    // ignored until the next reinstall.
    if (antonDevPath) {
      installArgs.push('--editable');
    }
    installArgs.push(antonSource);
    for (const dep of SERVER_PYTHON_DEPS) {
      installArgs.push('--with', dep.spec);
    }
    // --force allows replacing an existing tool entry; --reinstall makes uv
    // rebuild the environment contents too. Both matter when a user already
    // has an anton tool venv that predates the server dependency set.
    // Skip --upgrade for local paths so uv doesn't try to resolve a
    // newer version from PyPI and clobber the editable install.
    if (antonDevPath) {
      installArgs.push('--force', '--reinstall');
    } else {
      installArgs.push('--force', '--reinstall', '--upgrade');
    }

    const uvBin = fileExists(getUvBinary()) ? getUvBinary() : 'uv';
    const installResult = await runCommand(uvBin, installArgs, win, { shouldAbort });
    if (abortIfRequested()) return false;

    if (installResult.code !== 0) {
      setStep('anton', 'error');
      sendLog(win, '\nERROR: Failed to install Anton.\n');
      sendInstallError(win, 'Anton installation failed');
      return false;
    }
    sendLog(win, 'Anton installed.\n');
    setStep('anton', 'done');

    // Step 4: Verify
    //
    // Two checks here, in order — the second one is the part most
    // commonly missing in user reports of "server won't start":
    //   (a) the `anton` CLI binary exists at the expected path
    //   (b) the bundled server's Python deps are importable from the
    //       same interpreter `server-process.ts` will spawn. A silent
    //       failure mid-install (network blip, partial venv) leaves
    //       (a) green and (b) red, which is exactly the symptom users
    //       report ("Anton installed but the server never starts").
    if (abortIfRequested()) return false;
    setStep('verify', 'running');
    sendLog(win, '\n--- Verifying installation ---\n');
    const antonInstalled = await checkAntonInstalled();
    if (!antonInstalled) {
      setStep('verify', 'error');
      sendLog(win, 'ERROR: Anton binary not found after installation.\n');
      sendInstallError(win, 'Verification failed');
      return false;
    }
    sendLog(win, 'Anton CLI found.\n');

    // (b) — import the server deps via the tool venv's python.
    const toolPython = getAntonToolPython();
    if (!fileExists(toolPython)) {
      setStep('verify', 'error');
      sendLog(win, `ERROR: tool python not found at ${toolPython}\n`);
      sendInstallError(win, 'Tool venv missing');
      return false;
    }
    sendLog(win, 'Verifying server dependencies...\n');
    // Print version per dep so the install log is self-diagnosing
    // when a user reports a problem; missing imports produce a
    // single ImportError that surfaces the offending module.
    const verifyScript = getServerDepsVerifyScript();
    const verifyDeps = await runCommand(toolPython, ['-c', verifyScript], win, { shouldAbort });
    if (abortIfRequested()) return false;
    if (verifyDeps.code !== 0) {
      setStep('verify', 'error');
      sendLog(win,
        '\nERROR: server dependencies could not be imported.\n' +
        'This usually means the previous install step finished with a ' +
        'partial venv. Try re-running the installer; if it persists, ' +
        'manually run:\n' +
        `  uv tool install --force git+https://github.com/mindsdb/anton.git ${
          SERVER_PYTHON_DEPS.map((d) => `--with '${d.spec}'`).join(' ')
        }\n`
      );
      sendInstallError(win, 'Server dependencies missing');
      return false;
    }
    sendLog(win, 'Anton is ready!\n');
    setStep('verify', 'done');

    // Step 5: Start the bundled FastAPI server (server/main.py) using the
    // python interpreter uv just installed. Failure here doesn't roll back
    // the install — anton itself is fine. The server can be retried later
    // by re-launching the app.
    if (abortIfRequested()) return false;
    setStep('server', 'running');
    sendLog(win, '\n--- Starting Anton server ---\n');
    try {
      const { startServer } = await import('./server-process');
      const result = await startServer();
      if (result.ok) {
        sendLog(win, `Anton server running on http://127.0.0.1:${result.port}\n`);
        setStep('server', 'done');
      } else {
        sendLog(win, `WARNING: server did not start: ${result.reason}\n`);
        sendLog(win, 'You can retry by re-launching the app.\n');
        setStep('server', 'warning');
      }
    } catch (err: any) {
      sendLog(win, `WARNING: server start threw: ${err.message}\n`);
      setStep('server', 'warning');
    }

    sendEvent('ANTONAPP_INSTALLATION_SUCCESS');
    if (canSend(win)) {
      win.webContents.send(IPC.INSTALL_DONE);
    }
    return true;
  } catch (err: any) {
    sendLog(win, `\nUnexpected error: ${err.message}\n`);
    sendInstallError(win, err.message);
    return false;
  }
}


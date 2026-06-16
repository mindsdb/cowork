import { spawn, execFile } from 'child_process';
import { BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IPC } from '../shared/ipc-channels';
import { sendEvent } from './analytics';

interface InstallStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'warning';
}

interface InstallerOptions {
  shouldAbort?: () => boolean;
}

// Pinned cowork-server version. Bump this deliberately when shipping a
// cowork release that requires backend changes. The installer will
// install at least this version (a minimum floor), picking up any
// newer compatible releases automatically.
const COWORK_SERVER_MIN_VERSION = '0.1.5';

// PyO3 (used by pywinpty on Windows) doesn't support 3.14 yet.
// Keep in sync with server-updater.ts PYTHON_RANGE and cowork-server requires-python.
const PYTHON_RANGE = '>=3.12,<3.14';

// Package source for cowork-server. Override with COWORK_SERVER_PACKAGE
// env var (e.g. a local path or alternative git URL during development).
const COWORK_SERVER_PACKAGE = process.env.COWORK_SERVER_PACKAGE
  || `cowork-server>=${COWORK_SERVER_MIN_VERSION}`;


function getSteps(): InstallStep[] {
  const steps: InstallStep[] = [];
  if (process.platform === 'darwin') {
    steps.push({ id: 'xcode', label: 'Xcode Command Line Tools', status: 'pending' });
  }
  steps.push(
    { id: 'git', label: 'Check for git (required)', status: 'pending' },
    { id: 'uv', label: 'Install uv (Python package manager)', status: 'pending' },
    { id: 'cowork-server', label: 'Install cowork-server', status: 'pending' },
    { id: 'verify', label: 'Verify installation', status: 'pending' },
    { id: 'server', label: 'Start server', status: 'pending' },
  );
  return steps;
}

function getLocalBin(): string {
  return path.join(os.homedir(), '.local', 'bin');
}

function getCoworkServerBinary(): string {
  const localBin = getLocalBin();
  if (process.platform === 'win32') {
    return path.join(localBin, 'cowork-server.exe');
  }
  return path.join(localBin, 'cowork-server');
}

function getUvBinary(): string {
  const localBin = getLocalBin();
  if (process.platform === 'win32') {
    return path.join(localBin, 'uv.exe');
  }
  return path.join(localBin, 'uv');
}

function findUv(): string | null {
  const explicit = getUvBinary();
  if (fileExists(explicit)) return explicit;

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const winCandidate = path.join(process.env.LOCALAPPDATA, 'bin', 'uv.exe');
    if (fileExists(winCandidate)) return winCandidate;
  }

  const cargoBin = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (fileExists(cargoBin)) return cargoBin;

  if (process.platform === 'darwin') {
    for (const p of ['/opt/homebrew/bin/uv', '/usr/local/bin/uv']) {
      if (fileExists(p)) return p;
    }
  }

  return null;
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
  opts?: { shell?: boolean; shouldAbort?: () => boolean; env?: NodeJS.ProcessEnv }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      PATH: getEnvPath(),
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      // Caller-supplied overrides (e.g. UV_PYTHON_PREFERENCE for the
      // `uv tool install` step) win over the inherited environment.
      ...(opts?.env ?? {}),
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
    execFile('xcode-select', ['-p'], (err) => {
      resolve(!err);
    });
  });
}

function triggerXcodeInstall(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('xcode-select', ['--install'], { stdio: 'pipe' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
        return;
      }
      sendLog(win, 'Trying alternate install method...\n');
      const fallback = spawn('open', ['/System/Library/CoreServices/Install Command Line Developer Tools.app']);
      fallback.on('close', (fbCode) => {
        resolve(fbCode === 0);
      });
      fallback.on('error', () => resolve(false));
    });
    proc.on('error', () => resolve(false));
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

export async function checkCoworkServerInstalled(): Promise<boolean> {
  // Dev mode: if the sibling cowork-server source directory exists,
  // treat it as installed — server-process.ts will run it via `uv run`.
  if (!app.isPackaged) {
    const devDir = process.env.COWORK_SERVER_DIR
      ? path.resolve(process.env.COWORK_SERVER_DIR)
      : path.join(__dirname, '..', '..', '..', '..', 'cowork-server');
    if (fileExists(path.join(devDir, 'pyproject.toml'))) return true;
  }
  const hasBinary = fileExists(getCoworkServerBinary()) || await commandExists('cowork-server');
  if (!hasBinary) return false;

  // Binary exists — verify the installed version meets the minimum.
  // An outdated version may be missing new dependencies (e.g. alembic)
  // and crash on import, so we treat it as "not installed" to trigger
  // the installer which does --force --reinstall.
  const installedVersion = await getInstalledVersion();
  if (!installedVersion) {
    console.log('[installer] cowork-server version could not be determined, reinstall needed');
    return false;
  }
  if (compareVersions(installedVersion, COWORK_SERVER_MIN_VERSION) < 0) {
    console.log(
      `[installer] cowork-server ${installedVersion} is below minimum ${COWORK_SERVER_MIN_VERSION}, needs upgrade`,
    );
    return false;
  }
  return true;
}

/** Get the installed cowork-server version from `uv tool list`. */
function getInstalledVersion(): Promise<string | null> {
  const uvBin = findUv();
  if (!uvBin) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(uvBin, ['tool', 'list'], { env: { ...process.env, PATH: getEnvPath() }, timeout: 10000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      for (const line of stdout.split('\n')) {
        const match = line.match(/^cowork-server\s+v?([\d.]+)/);
        if (match) { resolve(match[1]); return; }
      }
      resolve(null);
    });
  });
}

/** Compare two X.Y.Z version strings. Returns <0 if a < b, 0 if equal, >0 if a > b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Convenience wrapper used by the boot flow IPC. Returns the full
// readiness picture so the renderer can branch cleanly.
export async function checkInstallStatus(): Promise<{
  antonInstalled: boolean;
  serverDepsReady: boolean;
}> {
  const installed = await checkCoworkServerInstalled();
  // Both fields report the same value — cowork-server is a single
  // package that includes all server dependencies. The two-field
  // shape is kept for renderer compatibility with the old boot flow.
  return { antonInstalled: installed, serverDepsReady: installed };
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
      } else {
        sendLog(win, 'Install it from: https://git-scm.com/downloads/win\n');
      }
      sendInstallError(win, 'git is required but not found.');
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

    // Step 3: Install cowork-server
    if (abortIfRequested()) return false;
    setStep('cowork-server', 'running');
    sendLog(win, `\n--- Installing cowork-server v${COWORK_SERVER_MIN_VERSION}+ ---\n`);

    const uvBin = fileExists(getUvBinary()) ? getUvBinary() : 'uv';
    const installArgs = [
      'tool', 'install',
      COWORK_SERVER_PACKAGE,
      '--force', '--reinstall',
      '--python', PYTHON_RANGE,
    ];

    /*
     * UV_PYTHON_PREFERENCE=only-managed — without this uv builds the tool
     * venv on whatever base interpreter it discovers on PATH (Anaconda /
     * Miniconda, the Windows Store python stub, …). Those bases are not
     * self-contained, so the resulting venv can be broken or fail to launch
     * outside their activation shell. A uv-managed standalone CPython has no
     * such dependency, and uv fetches it on demand if absent.
     */
    const uvEnv: NodeJS.ProcessEnv = { UV_PYTHON_PREFERENCE: 'only-managed' };
    sendLog(win, 'Python: uv-managed (UV_PYTHON_PREFERENCE=only-managed)\n');

    const installResult = await runCommand(uvBin, installArgs, win, { shouldAbort, env: uvEnv });
    if (abortIfRequested()) return false;

    if (installResult.code !== 0) {
      setStep('cowork-server', 'error');
      sendLog(win, '\nERROR: Failed to install cowork-server.\n');
      sendInstallError(win, 'cowork-server installation failed');
      return false;
    }
    sendLog(win, 'cowork-server installed.\n');
    setStep('cowork-server', 'done');

    // Step 4: Verify
    if (abortIfRequested()) return false;
    setStep('verify', 'running');
    sendLog(win, '\n--- Verifying installation ---\n');
    const installed = await checkCoworkServerInstalled();
    if (!installed) {
      setStep('verify', 'error');
      sendLog(win, 'ERROR: cowork-server binary not found after installation.\n');
      sendInstallError(win, 'Verification failed');
      return false;
    }
    sendLog(win, 'cowork-server is ready!\n');
    setStep('verify', 'done');

    // Step 5: Start the server
    if (abortIfRequested()) return false;
    setStep('server', 'running');
    sendLog(win, '\n--- Starting server ---\n');
    try {
      const { startServer } = await import('./server-process');
      const result = await startServer();
      if (result.ok) {
        sendLog(win, `Server running on http://127.0.0.1:${result.port}\n`);
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

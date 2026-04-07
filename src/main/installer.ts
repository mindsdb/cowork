import { spawn, execFile } from 'child_process';
import { BrowserWindow } from 'electron';
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

function getSteps(): InstallStep[] {
  const steps: InstallStep[] = [];
  if (process.platform === 'darwin') {
    steps.push({ id: 'xcode', label: 'Xcode Command Line Tools', status: 'pending' });
  }
  steps.push(
    { id: 'git', label: 'Check for git (required)', status: 'pending' },
    { id: 'uv', label: 'Install uv (Python package manager)', status: 'pending' },
    { id: 'anton', label: 'Install Anton', status: 'pending' },
    { id: 'verify', label: 'Verify installation', status: 'pending' },
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
    const env = { ...process.env, PATH: getEnvPath() };
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

    // Step 3: Install Anton
    if (abortIfRequested()) return false;
    setStep('anton', 'running');
    sendLog(win, '\n--- Installing Anton ---\n');

    const uvBin = fileExists(getUvBinary()) ? getUvBinary() : 'uv';
    const installResult = await runCommand(
      uvBin,
      ['tool', 'install', 'git+https://github.com/mindsdb/anton.git', '--force'],
      win,
      { shouldAbort }
    );
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
    sendLog(win, 'Anton is ready!\n');
    setStep('verify', 'done');

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

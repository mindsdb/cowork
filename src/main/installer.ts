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
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
}

function getSteps(): InstallStep[] {
  const steps: InstallStep[] = [];
  if (process.platform === 'darwin') {
    steps.push({ id: 'xcode', label: 'Xcode Command Line Tools', status: 'pending' });
  }
  steps.push(
    { id: 'git', label: 'Check for git', status: 'pending' },
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

function sendLog(win: BrowserWindow, message: string) {
  win.webContents.send(IPC.INSTALL_LOG, message);
}

function sendProgress(win: BrowserWindow, steps: InstallStep[]) {
  win.webContents.send(IPC.INSTALL_PROGRESS, JSON.parse(JSON.stringify(steps)));
}

function runCommand(
  command: string,
  args: string[],
  win: BrowserWindow,
  opts?: { shell?: boolean }
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
      resolve({ code: code ?? 1, stdout, stderr });
    });

    proc.on('error', (err) => {
      sendLog(win, `Error: ${err.message}\n`);
      resolve({ code: 1, stdout, stderr: err.message });
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

function waitForXcodeInstall(win: BrowserWindow, timeoutMs: number = 600000): Promise<boolean> {
  return new Promise((resolve) => {
    let elapsed = 0;
    const interval = 3000;
    const check = () => {
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

export async function checkAntonInstalled(): Promise<boolean> {
  if (fileExists(getAntonBinary())) return true;
  return commandExists('anton');
}

export async function runInstaller(win: BrowserWindow): Promise<boolean> {
  const steps = getSteps();

  const setStep = (id: string, status: InstallStep['status']) => {
    const step = steps.find((s) => s.id === id);
    if (step) step.status = status;
    sendProgress(win, steps);
  };

  try {
    // Step 0 (macOS only): Xcode Command Line Tools
    if (process.platform === 'darwin') {
      setStep('xcode', 'running');
      sendLog(win, '--- Checking for Xcode Command Line Tools ---\n');
      const hasXcode = await xcodeCliInstalled();
      if (!hasXcode) {
        sendLog(win, 'Xcode Command Line Tools not found.\n');
        sendLog(win, 'Launching installer — please click "Install" in the system dialog.\n');
        const triggered = await triggerXcodeInstall(win);
        if (!triggered) {
          setStep('xcode', 'error');
          sendLog(win, 'ERROR: Could not launch Xcode Command Line Tools installer.\n');
          sendLog(win, 'Please open Terminal and run: xcode-select --install\n');
          win.webContents.send(IPC.INSTALL_ERROR, 'Could not launch Xcode CLT installer. Please run "xcode-select --install" in Terminal.');
          return false;
        }
        sendLog(win, 'Waiting for installation to complete');
        const installed = await waitForXcodeInstall(win);
        sendLog(win, '\n');
        if (!installed) {
          setStep('xcode', 'error');
          sendLog(win, 'ERROR: Xcode Command Line Tools installation timed out or was cancelled.\n');
          sendLog(win, 'Please install manually by running: xcode-select --install\n');
          win.webContents.send(IPC.INSTALL_ERROR, 'Xcode Command Line Tools are required');
          return false;
        }
        sendLog(win, 'Xcode Command Line Tools installed.\n');
      } else {
        sendLog(win, 'Xcode Command Line Tools found.\n');
      }
      setStep('xcode', 'done');
    }

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
      win.webContents.send(IPC.INSTALL_ERROR, 'git is required but not found');
      return false;
    }
    sendLog(win, 'git found.\n');
    setStep('git', 'done');

    // Step 2: Check/install uv
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
          win
        );
        if (result.code !== 0) {
          setStep('uv', 'error');
          win.webContents.send(IPC.INSTALL_ERROR, 'Failed to install uv');
          return false;
        }
      } else {
        const result = await runCommand(
          'sh',
          ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'],
          win,
          { shell: false }
        );
        if (result.code !== 0) {
          setStep('uv', 'error');
          win.webContents.send(IPC.INSTALL_ERROR, 'Failed to install uv');
          return false;
        }
      }
      // Verify uv installed
      hasUv = await commandExists('uv') || fileExists(getUvBinary());
      if (!hasUv) {
        setStep('uv', 'error');
        sendLog(win, 'ERROR: uv installation completed but binary not found.\n');
        win.webContents.send(IPC.INSTALL_ERROR, 'uv installation failed');
        return false;
      }
      sendLog(win, 'uv installed successfully.\n');
    } else {
      sendLog(win, 'uv found.\n');
    }
    setStep('uv', 'done');

    // Step 3: Install Anton
    setStep('anton', 'running');
    sendLog(win, '\n--- Installing Anton ---\n');

    const uvBin = fileExists(getUvBinary()) ? getUvBinary() : 'uv';
    const installResult = await runCommand(
      uvBin,
      ['tool', 'install', 'git+https://github.com/mindsdb/anton.git', '--force'],
      win
    );

    if (installResult.code !== 0) {
      setStep('anton', 'error');
      sendLog(win, '\nERROR: Failed to install Anton.\n');
      win.webContents.send(IPC.INSTALL_ERROR, 'Anton installation failed');
      return false;
    }
    sendLog(win, 'Anton installed.\n');
    setStep('anton', 'done');

    // Step 4: Verify
    setStep('verify', 'running');
    sendLog(win, '\n--- Verifying installation ---\n');
    const antonInstalled = await checkAntonInstalled();
    if (!antonInstalled) {
      setStep('verify', 'error');
      sendLog(win, 'ERROR: Anton binary not found after installation.\n');
      win.webContents.send(IPC.INSTALL_ERROR, 'Verification failed');
      return false;
    }
    sendLog(win, 'Anton is ready!\n');
    setStep('verify', 'done');

    sendEvent('ANTONAPP_INSTALLATION_SUCCESS');
    win.webContents.send(IPC.INSTALL_DONE);
    return true;
  } catch (err: any) {
    sendLog(win, `\nUnexpected error: ${err.message}\n`);
    win.webContents.send(IPC.INSTALL_ERROR, err.message);
    return false;
  }
}

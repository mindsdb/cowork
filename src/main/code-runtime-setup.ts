// Code Mode setup, run the first time Code Mode is switched on.
//
// The coding agent's components (cowork-server's `code` extra: the Codex
// runtime and its native binary, over 100 MB per platform) are not part of
// the first install. This installs them into the existing cowork-server tool
// environment, restarts the sidecar and confirms the engine reports itself
// available. Where the computer has no working Git, that is installed first:
// Code Mode cannot clone, make worktrees or commit without it, and a stock
// Mac's /usr/bin/git only works once the Xcode Command Line Tools exist.
//
// Progress streams to the renderer on the CODE_SETUP_* channels, mirroring
// the first-run installer's shape (steps + log lines + done/error/cancelled).

import { execFile } from 'child_process';
import * as http from 'http';
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

import { IPC } from '../shared/ipc-channels';
import {
  codeRuntimeInstalledIn,
  codeSetupSteps,
  gitInstallRoute,
  withCodeExtra,
  type CodeSetupStep,
  type CodeSetupStatus,
} from './code-runtime-spec';
import { runCommand, triggerXcodeInstall, waitForXcodeInstall, xcodeCliInstalled } from './installer';
import { authHeader } from './server-auth';
import { getServerPort, isServerRunning, startServer, stopServer, withServerMaintenance } from './server-process';
import { getAntonRef, getCoworkRef, getInstallSpec } from './server-source';
import { antonWithArgs, readVcsInfo, sitesPackagesDir, uvToolsDir } from './server-updater';
import { PYTHON_RANGE, findOnPath, getEnvPath, getInstalledVersion, resolveUv, writeUvOverrides } from './uv-paths';

const GIT_WAIT_MS = 20 * 60 * 1000;   // the Xcode Command Line Tools download can take a while
const ENGINE_WAIT_MS = 60 * 1000;

export interface CodeSetupStatusReport {
  installed: boolean;
  gitWorks: boolean;
  devSource: boolean;
}

export interface CodeSetupOptions {
  shouldAbort?: () => boolean;
}


function canSend(win: BrowserWindow): boolean {
  return !win.isDestroyed() && !win.webContents.isDestroyed();
}

function devSourceDir(): string | null {
  if (app.isPackaged) return null;
  const dir = process.env.COWORK_SERVER_DIR
    ? path.resolve(process.env.COWORK_SERVER_DIR)
    : path.join(__dirname, '..', '..', '..', '..', 'cowork-server');
  return fs.existsSync(path.join(dir, 'pyproject.toml')) ? dir : null;
}

/** `git --version` succeeds. On macOS the binary exists without the Command Line Tools and fails; that counts as missing. */
export function gitWorks(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('git', ['--version'], { env: { ...process.env, PATH: getEnvPath() }, timeout: 15_000 }, (err, stdout) => {
      resolve(!err && /git version/i.test(String(stdout)));
    });
  });
}

/** What the renderer needs to decide whether switching Code Mode on must install anything. */
export async function codeSetupStatus(): Promise<CodeSetupStatusReport> {
  const devSource = devSourceDir() !== null;
  const works = await gitWorks();
  if (devSource) return { installed: true, gitWorks: works, devSource };
  const uv = await resolveUv();
  const toolsDir = uv ? await uvToolsDir(uv) : null;
  return {
    installed: codeRuntimeInstalledIn(sitesPackagesDir(toolsDir ?? undefined)),
    gitWorks: works,
    devSource,
  };
}

/** Whether the sidecar's Codex engine reports itself available. */
function codexEngineAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: getServerPort(), path: '/api/v1/coding/engines', timeout: 5_000, headers: authHeader() },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const engines = JSON.parse(body) as Array<{ id?: string; available?: boolean }>;
            resolve(Array.isArray(engines) && engines.some((engine) => engine.id === 'codex' && engine.available === true));
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** The `uv tool install` spec that adds the `code` extra to the server that is installed now. */
export async function codeInstallSpec(uv: string, toolsDir: string | null): Promise<{ args: string[]; env: NodeJS.ProcessEnv }> {
  const explicit = process.env.COWORK_SERVER_PACKAGE;
  if (explicit) {
    const spec = getInstallSpec();
    return { args: [withCodeExtra(spec.package)], env: writeUvOverrides(spec.overrides) };
  }
  if (readVcsInfo('cowork_server', toolsDir ?? undefined)) {
    const spec = getInstallSpec({ coworkRef: getCoworkRef(), antonRef: getAntonRef() });
    return { args: [withCodeExtra(spec.package)], env: writeUvOverrides(spec.overrides) };
  }
  const installed = await getInstalledVersion(uv);
  const withArgs = installed ? await antonWithArgs(installed) : [];
  return { args: [withCodeExtra(installed ? `cowork-server==${installed}` : 'cowork-server'), ...withArgs], env: {} };
}


export async function runCodeRuntimeSetup(win: BrowserWindow, opts: CodeSetupOptions = {}): Promise<boolean> {
  const shouldAbort = opts.shouldAbort ?? (() => false);
  const log = (text: string) => { if (canSend(win)) win.webContents.send(IPC.CODE_SETUP_LOG, text); };
  const steps: CodeSetupStep[] = codeSetupSteps(!(await gitWorks()));
  const progress = () => { if (canSend(win)) win.webContents.send(IPC.CODE_SETUP_PROGRESS, steps); };
  const setStep = (id: CodeSetupStep['id'], status: CodeSetupStatus) => {
    const step = steps.find((item) => item.id === id);
    if (step) step.status = status;
    progress();
  };
  const fail = (id: CodeSetupStep['id'], message: string) => {
    setStep(id, 'error');
    for (const step of steps) if (step.status === 'pending') step.status = 'skipped';
    progress();
    log(`\nERROR: ${message}\n`);
    if (canSend(win)) win.webContents.send(IPC.CODE_SETUP_ERROR, message);
    return false;
  };
  const cancelled = () => {
    if (!shouldAbort()) return false;
    for (const step of steps) if (step.status === 'pending' || step.status === 'running') step.status = 'skipped';
    progress();
    log('\nSetup cancelled.\n');
    if (canSend(win)) win.webContents.send(IPC.CODE_SETUP_CANCELLED);
    return true;
  };
  progress();

  // Git, only when it is missing.
  if (steps.some((step) => step.id === 'git')) {
    setStep('git', 'running');
    const route = gitInstallRoute(process.platform);
    if (route === 'xcode') {
      log('--- Git ---\nGit needs the Xcode Command Line Tools on this Mac.\n');
      if (!(await xcodeCliInstalled())) {
        log('Asking macOS to install them; please click Install in the system dialog.\n');
        const triggered = await triggerXcodeInstall(win);
        if (!triggered) return fail('git', 'Could not start the Xcode Command Line Tools installer. Run "xcode-select --install" in Terminal, then try again.');
        log('Waiting for the install to finish (this can take several minutes)…\n');
        const installed = await waitForXcodeInstall(win, GIT_WAIT_MS, shouldAbort);
        if (cancelled()) return false;
        if (!installed) return fail('git', 'The Xcode Command Line Tools did not finish installing. Complete that install, then try again.');
      }
      if (!(await gitWorks())) return fail('git', 'Git is still not working after the Command Line Tools install. Open Terminal, run "git --version", then try again.');
    } else if (route === 'winget') {
      log('--- Git ---\nInstalling Git with winget…\n');
      const result = await runCommand('winget', [
        'install', '--id', 'Git.Git', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements',
      ], win, { shell: true, shouldAbort, log });
      if (cancelled()) return false;
      if (result.code !== 0) return fail('git', 'Git could not be installed with winget. Install it from https://git-scm.com/downloads/win, then try again.');
      for (const candidate of ['C:\\Program Files\\Git\\cmd', path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'cmd')]) {
        if (fs.existsSync(path.join(candidate, 'git.exe')) && !process.env.PATH?.includes(candidate)) {
          process.env.PATH = `${candidate}${path.delimiter}${process.env.PATH ?? ''}`;
        }
      }
      if (!(await findOnPath('git')) || !(await gitWorks())) return fail('git', 'Git was installed but is not available yet. Restart the app, then try again.');
    } else {
      return fail('git', 'Git is not installed. Install it with your package manager (for example "sudo apt install git"), then try again.');
    }
    log('Git is ready.\n');
    setStep('git', 'done');
  }
  if (cancelled()) return false;

  // The coding agent's components.
  setStep('components', 'running');
  log('--- Code Mode components ---\n');
  const uv = await resolveUv();
  if (!uv) return fail('components', 'uv was not found. Run the app installer again from Settings › Backend, then try again.');
  const toolsDir = await uvToolsDir(uv);
  const spec = await codeInstallSpec(uv, toolsDir);
  log(`Installing ${spec.args[0]}\n`);
  const install = await withServerMaintenance(async () => {
    const wasRunning = isServerRunning();
    if (wasRunning) {
      log('Stopping the Code service while its components install…\n');
      await stopServer();
    }
    return runCommand(uv, ['tool', 'install', ...spec.args, '--force', '--reinstall', '--python', PYTHON_RANGE], win, {
      shouldAbort,
      log,
      env: { UV_PYTHON_PREFERENCE: 'only-managed', ...spec.env },
    });
  });
  if (cancelled()) {
    // The service was stopped for the install; bring it back so the app keeps working.
    await startServer().catch(() => undefined);
    return false;
  }
  if (install.code !== 0) {
    await startServer().catch(() => undefined);
    return fail('components', 'The components did not install. Check your connection and disk space, then try again.');
  }
  if (!codeRuntimeInstalledIn(sitesPackagesDir(toolsDir ?? undefined))) {
    await startServer().catch(() => undefined);
    return fail('components', 'The install finished but the coding agent is missing from it. Try again; if this keeps happening, report it with the details below.');
  }
  setStep('components', 'done');

  // Restart the sidecar on the new environment.
  setStep('restart', 'running');
  log('\n--- Restarting the Code service ---\n');
  const started = await startServer();
  if (!started.ok) return fail('restart', `The Code service did not start after the install: ${started.reason || 'unknown reason'}.`);
  setStep('restart', 'done');

  // Confirm the engine is there.
  setStep('verify', 'running');
  log('Checking the coding agent…\n');
  const deadline = Date.now() + ENGINE_WAIT_MS;
  let available = false;
  while (Date.now() < deadline) {
    if (cancelled()) return false;
    available = await codexEngineAvailable();
    if (available) break;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  if (!available) return fail('verify', 'The coding agent did not report itself ready. Restart the app; if it is still missing, run the setup again.');
  log('Code Mode is ready.\n');
  setStep('verify', 'done');
  if (canSend(win)) win.webContents.send(IPC.CODE_SETUP_DONE);
  return true;
}

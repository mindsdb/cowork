import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { IPC } from '../shared/ipc-channels';

// Map of project name -> pty process
const ptyProcesses: Map<string, any> = new Map();

function getEnvPath(): string {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  return [localBin, cargoBin, currentPath].join(path.delimiter);
}

function getAntonBinary(): string {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const bin = process.platform === 'win32' ? 'anton.exe' : 'anton';
  const fullPath = path.join(localBin, bin);
  if (fs.existsSync(fullPath)) return fullPath;
  return 'anton';
}

function getShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export function startAnton(
  win: BrowserWindow,
  cols: number,
  rows: number,
  projectName: string,
  cwd?: string
) {
  const pty = require('node-pty');

  // If already running for this project, don't restart
  if (ptyProcesses.has(projectName)) {
    return;
  }

  const antonBin = getAntonBinary();
  const env = { ...process.env, PATH: getEnvPath(), TERM: 'xterm-256color', ANTON_SUPPRESS_BANNER: '1' };

  let spawnCmd: string;
  let spawnArgs: string[];
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const shell = getShell();
    spawnCmd = shell;
    spawnArgs = ['-l', '-i', '-c', antonBin];
  } else {
    spawnCmd = antonBin;
    spawnArgs = [];
  }

  try {
    const proc = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 40,
      cwd: cwd || os.homedir(),
      env,
    });

    ptyProcesses.set(projectName, proc);

    proc.onData((data: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.ANTON_DATA, projectName, data);
      }
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.ANTON_EXIT, projectName, exitCode);
      }
      ptyProcesses.delete(projectName);
    });
  } catch (err: any) {
    if (!win.isDestroyed()) {
      win.webContents.send(
        IPC.ANTON_DATA,
        projectName,
        `\r\n\x1b[31mFailed to start Anton: ${err.message}\x1b[0m\r\n` +
          `\x1b[33mAnton binary: ${antonBin}\x1b[0m\r\n` +
          `\x1b[33mPATH: ${env.PATH}\x1b[0m\r\n`
      );
      win.webContents.send(IPC.ANTON_EXIT, projectName, 1);
    }
  }
}

export function isAntonRunning(projectName: string): boolean {
  return ptyProcesses.has(projectName);
}

export function writeToAnton(projectName: string, data: string) {
  const proc = ptyProcesses.get(projectName);
  if (proc) {
    proc.write(data);
  }
}

export function resizeAnton(projectName: string, cols: number, rows: number) {
  const proc = ptyProcesses.get(projectName);
  if (proc) {
    proc.resize(cols, rows);
  }
}

export function killAnton(projectName?: string) {
  if (projectName) {
    const proc = ptyProcesses.get(projectName);
    if (proc) {
      proc.kill();
      ptyProcesses.delete(projectName);
    }
  } else {
    // Kill all
    for (const [name, proc] of ptyProcesses) {
      proc.kill();
    }
    ptyProcesses.clear();
  }
}

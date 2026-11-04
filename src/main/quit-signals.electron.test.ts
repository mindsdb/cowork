// Real-Electron regression test for the quit signal handlers. The unit tests
// emit events on a mock process, so they can't see Electron replace the
// handlers with its own native ones during startup. That replacement is what
// let an earlier version pass them while a repeated Ctrl-C still killed main
// partway through the sidecar drain.
//
// This launches the Electron binary with a small app that installs the handlers
// the way app.ts does, starts a detached child in its own process group as a
// stand-in for the sidecar, and stops it from a copy of app.ts's before-quit
// drain. It then delivers repeated operating-system signals and checks that the
// drain finished, the app exited cleanly, and the child is gone.
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

function electronBinary(): string | null {
  try {
    // In Node, the electron package exports the path to its binary.
    const bin = require('electron') as unknown as string;
    return typeof bin === 'string' && fs.existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

function hasCommand(name: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${name}`]).status === 0;
}

// Linux CI has no display; run Electron under xvfb there, as the e2e job does.
const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const bin = electronBinary();
const skipReason = process.platform === 'win32'
  ? 'POSIX signals only'
  : !bin
    ? 'no Electron binary installed'
    : needsXvfb && !hasCommand('xvfb-run')
      ? 'no display and no xvfb-run'
      : null;

// Compile the real helper and its one dependency next to the fixture app.
function buildFixture(dir: string): string {
  const compile = (from: string, to: string) => {
    const source = fs.readFileSync(path.join(__dirname, from), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
    fs.writeFileSync(path.join(dir, to), outputText);
  };
  compile('quit-signals.ts', 'main/quit-signals.js');
  compile('../shared/diagnostics.ts', 'shared/diagnostics.js');
  const main = path.join(dir, 'main.js');
  fs.writeFileSync(main, `
const { app } = require('electron');
const { spawn } = require('child_process');
const { installQuitSignalHandlers } = require('./main/quit-signals.js');

// The sidecar stand-in leads its own process group (detached), like the real
// one, so a Ctrl-C to the app's group never reaches it.
const child = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
console.log('child ' + child.pid);

// Copy of app.ts's before-quit drain, with a slow server stop.
let quitDrained = false;
async function drainServerForQuit() {
  if (quitDrained) return;
  quitDrained = true;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log('drain finished');
}
app.on('before-quit', (event) => {
  if (quitDrained) return;
  event.preventDefault();
  drainServerForQuit().finally(() => app.quit());
});
app.on('window-all-closed', () => {});

// Called at the top level, as app.ts does.
void installQuitSignalHandlers(app);
app.whenReady().then(() => setTimeout(() => console.log('ready'), 200));
`);
  return main;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let electron: ChildProcess | null = null;
let childPid: number | null = null;
let fixtureDir: string | null = null;

afterEach(() => {
  if (electron && electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
  if (childPid && alive(childPid)) process.kill(childPid, 'SIGKILL');
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
  electron = null;
  childPid = null;
  fixtureDir = null;
});

describe.skipIf(skipReason !== null)(`quit signals in real Electron${skipReason ? ` (skipped: ${skipReason})` : ''}`, () => {
  it('stops the sidecar and exits cleanly when Ctrl-C arrives as several signals', async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quit-signals-'));
    const main = buildFixture(fixtureDir);
    const linuxFlags = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [];
    const [cmd, args] = needsXvfb
      ? ['xvfb-run', ['--auto-servernum', '--', bin!, ...linuxFlags, main]]
      : [bin!, [...linuxFlags, main]];
    const proc = spawn(cmd, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ELECTRON_ENABLE_LOGGING: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    electron = proc;

    let output = '';
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      proc.on('exit', (code, signal) => resolve({ code, signal }));
    });
    const ready = new Promise<void>((resolve, reject) => {
      const onData = (data: Buffer) => {
        output += data.toString();
        const match = output.match(/child (\d+)/);
        if (match) childPid = Number(match[1]);
        if (output.includes('ready')) resolve();
      };
      proc.stdout!.on('data', onData);
      proc.stderr!.on('data', (data: Buffer) => { output += data.toString(); });
      void exited.then(() => reject(new Error(`Electron exited before it was ready:\n${output}`)));
    });
    await ready;
    expect(childPid).not.toBeNull();
    expect(alive(childPid!)).toBe(true);

    // One Ctrl-C under `npm run dev` reaches main as several SIGINTs. Under
    // xvfb-run the signals go to Electron itself, not the wrapper.
    const target = needsXvfb ? electronPid(proc.pid!) : proc.pid!;
    for (let i = 0; i < 3; i += 1) {
      process.kill(target, 'SIGINT');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const result = await exited;
    expect(output).toContain('drain finished');
    expect(result).toEqual({ code: 0, signal: null });
    expect(alive(childPid!)).toBe(false);
  }, 30_000);
});

// xvfb-run starts Electron as a descendant; find the Electron main process.
function electronPid(wrapperPid: number): number {
  const out = spawnSync('ps', ['-eo', 'pid=,ppid=,args=']).stdout.toString();
  const rows = out.trim().split('\n').map((line) => {
    const [pid, ppid, ...rest] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), args: rest.join(' ') };
  });
  const descendants = new Set([wrapperPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        grew = true;
      }
    }
  }
  const main = rows.find((row) => descendants.has(row.pid) && row.args.startsWith(bin!) && !row.args.includes('--type='));
  if (!main) throw new Error('Electron main process not found under xvfb-run');
  return main.pid;
}

// Mocked regression tests for build/pkg-scripts/postinstall (ENG-1241 credential
// staging, ENG-2295 bundle ownership handoff).
//
// The script runs as root on a real install and talks to macOS-only tools, so
// this runs the real bash script in a temp sandbox with shims ahead of PATH for
// every command that would touch the system: `stat` (console user), `dscl`
// (home lookup), `dseditgroup` (admin membership), `chown`, `install`, `cp` and
// `chmod`. Each shim appends its argv to a log the assertions read. The script's
// two fixed paths are redirected through the COWORK_PKG_* seams it exposes for
// exactly this purpose. `rm`, `mkdir`, `cat` and `dirname` are the real tools.
//
// These pin decisions that have no visible failure mode: a chown that quietly
// stops happening looks exactly like a slow Squirrel update until the next
// password prompt, and a chown for a standard user would hand app code to a
// non-admin.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../build/pkg-scripts/postinstall');
const APP_NAME = 'MindsHub Cowork (Staging).app';

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

interface Scenario {
  /** What `stat -f%Su /dev/console` reports. Empty means no console session. */
  consoleUser?: string;
  admin?: boolean;
  /** Contents of installed-app-name; null leaves the file out. */
  appName?: string | null;
  /** Whether /Applications/<appName> exists in the sandbox. */
  bundlePresent?: boolean;
  /** Whether server-credentials.json is packaged next to the script. */
  credentials?: boolean;
  /** Make the `cp` shim fail, so credential staging cannot complete. */
  cpFails?: boolean;
}

interface Run {
  status: number | null;
  stderr: string;
  /** Every shim invocation, one `<tool> <args…>` line each. */
  calls: string[];
  chowns: string[];
  appsDir: string;
}

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-postinstall-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeShim(binDir: string, name: string, body: string): void {
  const file = path.join(binDir, name);
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

function runPostinstall(s: Scenario = {}): Run {
  const {
    consoleUser = 'alice',
    admin = true,
    appName = APP_NAME,
    bundlePresent = true,
    credentials = true,
    cpFails = false,
  } = s;

  const scriptsDir = path.join(sandbox, 'scripts');
  const binDir = path.join(sandbox, 'bin');
  const appsDir = path.join(sandbox, 'Applications');
  const fallbackDir = path.join(sandbox, 'shared-fallback');
  const home = path.join(sandbox, 'home');
  const callLog = path.join(sandbox, 'calls.log');
  for (const d of [scriptsDir, binDir, appsDir, home]) fs.mkdirSync(d, { recursive: true });

  fs.copyFileSync(SCRIPT, path.join(scriptsDir, 'postinstall'));
  fs.chmodSync(path.join(scriptsDir, 'postinstall'), 0o755);
  if (appName !== null) fs.writeFileSync(path.join(scriptsDir, 'installed-app-name'), `${appName}\n`);
  if (credentials) fs.writeFileSync(path.join(scriptsDir, 'server-credentials.json'), '{}\n');
  if (bundlePresent && appName) fs.mkdirSync(path.join(appsDir, appName), { recursive: true });

  // Every shim records itself; the system-querying ones answer from the scenario.
  const record = `printf '%s\\n' "$(basename "$0") $*" >> "${callLog}"`;
  writeShim(binDir, 'stat', `${record}\nprintf '%s\\n' '${consoleUser}'`);
  writeShim(binDir, 'dscl', `${record}\nprintf 'NFSHomeDirectory: %s\\n' '${home}'`);
  writeShim(binDir, 'dseditgroup', `${record}\nexit ${admin ? 0 : 1}`);
  writeShim(binDir, 'chown', `${record}\nexit 0`);
  writeShim(binDir, 'chmod', `${record}\nexit 0`);
  writeShim(binDir, 'install', `${record}\nexit 0`);
  writeShim(binDir, 'cp', `${record}\nexit ${cpFails ? 1 : 0}`);

  const result = spawnSync('bash', [path.join(scriptsDir, 'postinstall')], {
    env: {
      PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: home,
      COWORK_PKG_APPLICATIONS_DIR: appsDir,
      COWORK_PKG_SHARED_FALLBACK_DIR: fallbackDir,
    },
    encoding: 'utf8',
  });

  const calls = fs.existsSync(callLog)
    ? fs.readFileSync(callLog, 'utf8').split('\n').filter(Boolean)
    : [];
  return {
    status: result.status,
    stderr: result.stderr,
    calls,
    chowns: calls.filter(c => c.startsWith('chown ')),
    appsDir,
  };
}

describe.skipIf(!hasBash)('pkg postinstall: bundle ownership handoff (ENG-2295)', () => {
  it('hands the bundle to an admin console user with one recursive chown', () => {
    const run = runPostinstall();
    expect(run.status).toBe(0);
    expect(run.chowns).toContain(`chown -R alice:staff ${run.appsDir}/${APP_NAME}`);
    expect(run.chowns.filter(c => c.includes(APP_NAME))).toHaveLength(1);
    expect(run.stderr).toContain('handed the app bundle to admin console user alice');
    expect(run.calls).toContain('dseditgroup -o checkmember -m alice admin');
  });

  it('leaves the bundle root-owned for a standard user, but still stages credentials', () => {
    const run = runPostinstall({ admin: false });
    expect(run.status).toBe(0);
    expect(run.chowns.some(c => c.includes(APP_NAME))).toBe(false);
    expect(run.stderr).not.toContain('handed the app bundle');
    // Credential staging is unaffected by the admin decision.
    expect(run.stderr).toContain('staged credentials for console user alice');
    expect(run.chowns).toContain(`chown alice:staff ${path.join(run.appsDir, '..', 'home', '.cowork-provision', 'server-credentials.json')}`);
  });

  it('still hands over the bundle when no credentials are packaged (unsigned build)', () => {
    const run = runPostinstall({ credentials: false });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('no server-credentials.json packaged');
    expect(run.chowns).toContain(`chown -R alice:staff ${run.appsDir}/${APP_NAME}`);
    expect(run.stderr).toContain('handed the app bundle to admin console user alice');
  });

  it('still hands over the bundle when credential staging fails', () => {
    const run = runPostinstall({ cpFails: true });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('failed to stage credentials anywhere');
    expect(run.chowns).toContain(`chown -R alice:staff ${run.appsDir}/${APP_NAME}`);
  });

  it.each([
    ['empty', '', "unexpected installed-app-name ''"],
    ['path-bearing', 'a/b.app', "unexpected installed-app-name 'a/b.app'"],
    ['parent-escaping', '../evil.app', "unexpected installed-app-name '../evil.app'"],
    ['dot-prefixed', '..hidden.app', "unexpected installed-app-name '..hidden.app'"],
  ])('refuses a %s installed-app-name', (_label, name, logLine) => {
    const run = runPostinstall({ appName: name, bundlePresent: false });
    expect(run.status).toBe(0);
    expect(run.chowns.some(c => c.startsWith('chown -R'))).toBe(false);
    expect(run.stderr).toContain(logLine);
  });

  it('accepts a bundle name with spaces and parentheses', () => {
    const run = runPostinstall({ appName: 'MindsHub Cowork (Staging).app' });
    expect(run.chowns).toContain(`chown -R alice:staff ${run.appsDir}/MindsHub Cowork (Staging).app`);
  });

  it('skips the chown when the name file is missing', () => {
    const run = runPostinstall({ appName: null });
    expect(run.chowns.some(c => c.startsWith('chown -R'))).toBe(false);
    expect(run.stderr).toContain('no installed-app-name packaged');
  });

  it('skips the chown when the bundle is not where the name says', () => {
    const run = runPostinstall({ bundlePresent: false });
    expect(run.chowns.some(c => c.startsWith('chown -R'))).toBe(false);
    expect(run.stderr).toContain(`installed bundle not found at ${run.appsDir}/${APP_NAME}`);
  });

  it.each([
    ['root', 'root'],
    ['no console session', ''],
  ])('does nothing to the bundle when the console user is %s', (_label, consoleUser) => {
    const run = runPostinstall({ consoleUser });
    expect(run.status).toBe(0);
    expect(run.chowns.some(c => c.startsWith('chown -R'))).toBe(false);
    expect(run.calls.some(c => c.startsWith('dseditgroup'))).toBe(false);
    // With no console home, credentials go to the shared fallback.
    expect(run.stderr).toContain('staged credentials at the shared fallback location');
  });

  it('never fails the package install', () => {
    const run = runPostinstall({ admin: false, cpFails: true, credentials: true, bundlePresent: false });
    expect(run.status).toBe(0);
  });
});

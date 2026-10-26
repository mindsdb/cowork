import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { assertSetupPassed, packageIdentity, validateManifest } from './macos-setup-contract.mjs';
import { appEnvironment, assertTrimmed, installedExecutable, removalPlan, rootsToRemove, ROOT_AUTO_UPDATE_BACKUP, ROOT_BACKUP } from './windows-setup-contract.mjs';

const R3 = 'D69B561148F01C77C54578C10926DF5B856976AD';
const X1 = 'CABD2A79A1076A31F21D253635CB039D4329A5E8';
const OTHER = 'A'.repeat(40);
const entry = (store, thumbprint, subject = 'CN=Fixture') => ({ store, thumbprint, subject });

test('the trim removes every downloaded root and the named roots the image installed, nothing else', () => {
  const stores = [
    entry('LocalMachine\\AuthRoot', OTHER), entry('LocalMachine\\AuthRoot', R3),
    entry('LocalMachine\\Root', X1), entry('LocalMachine\\Root', 'B'.repeat(40)),
    entry('CurrentUser\\Root', R3), entry('CurrentUser\\Root', 'B'.repeat(40)),
  ];
  assert.deepEqual(rootsToRemove(stores), [stores[0], stores[1], stores[2]]);
  assert.deepEqual(rootsToRemove([entry('LocalMachine\\Root', X1.toLowerCase())]).length, 1);
});

test('the removal plan names exactly the planned certificates, AuthRoot first, and refuses anything else', () => {
  assert.deepEqual(
    removalPlan([entry('LocalMachine\\Root', R3), entry('LocalMachine\\AuthRoot', OTHER), entry('LocalMachine\\AuthRoot', R3)]),
    [{ store: 'AuthRoot', thumbprint: OTHER }, { store: 'AuthRoot', thumbprint: R3 }, { store: 'Root', thumbprint: R3 }],
  );
  // CurrentUser\Root deletes open a confirmation dialog; a quote would escape a path.
  assert.throws(() => removalPlan([entry('CurrentUser\\Root', R3)]), /Refusing/);
  assert.throws(() => removalPlan([entry('LocalMachine\\Root', `${R3.slice(0, 39)}'`)]), /Refusing/);
  assert.throws(() => removalPlan([entry('LocalMachine\\My', R3)]), /Refusing/);
});

test('the workflow restores the runner\'s roots and settings from where the harness backs them up, even after a failure', () => {
  const workflow = readFileSync(resolve('.github/workflows/windows-setup-smoke.yml'), 'utf8');
  const restore = workflow.slice(workflow.indexOf('- name: Restore the runner\'s root store'));
  assert.match(restore, /^- name: Restore the runner's root store\n\s+if: always\(\)/);
  assert.ok(restore.includes(ROOT_BACKUP) && restore.includes(ROOT_AUTO_UPDATE_BACKUP));
  assert.ok(workflow.indexOf('Restore the runner\'s root store') > workflow.indexOf('npm run test:windows-setup'));
});

test('a trim that left a downloaded root, a named root visible to Python, or root downloads off fails before setup', () => {
  const on = { policy: null, setting: null };
  const trimmed = (entries, rootAutoUpdateOff = on) => assertTrimmed({ entries, rootAutoUpdateOff });
  assert.doesNotThrow(() => trimmed([entry('LocalMachine\\Root', 'B'.repeat(40)), entry('CurrentUser\\Root', 'B'.repeat(40))]));
  assert.throws(() => trimmed([entry('LocalMachine\\AuthRoot', OTHER)]), /remain in LocalMachine\\AuthRoot/);
  assert.throws(() => trimmed([entry('CurrentUser\\Root', R3)]), /GlobalSign Root CA - R3 in CurrentUser\\Root/);
  assert.throws(() => trimmed([entry('LocalMachine\\Root', X1)]), /ISRG Root X1 in LocalMachine\\Root/);
  // The hosted image sets the policy; left on, Install uv fails where a fresh machine downloads ISRG Root X1.
  assert.throws(() => trimmed([], { policy: 1, setting: null }), /still turned off/);
  assert.throws(() => trimmed([], { policy: null, setting: 1 }), /still turned off/);
});

test('the app gets a fresh profile and system folders only, never CI tokens or runner tools', () => {
  const runner = {
    SystemRoot: 'C:\\Windows', SystemDrive: 'C:', PATHEXT: '.COM;.EXE;.BAT;.CMD', ProgramData: 'C:\\ProgramData',
    ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', NUMBER_OF_PROCESSORS: '4',
    PROCESSOR_ARCHITECTURE: 'AMD64', OS: 'Windows_NT', USERNAME: 'runneradmin', USERDOMAIN: 'runner', COMPUTERNAME: 'runner',
    GITHUB_TOKEN: 'secret', ACTIONS_RUNTIME_TOKEN: 'secret', COWORK_SERVER_PACKAGE: 'C:\\source', UV_TOOL_DIR: 'C:\\tools',
    Path: 'C:\\hostedtoolcache\\windows\\uv;C:\\Program Files\\Git\\cmd', USERPROFILE: 'C:\\Users\\runneradmin',
  };
  const environment = appEnvironment('D:\\a\\_temp\\cowork-profile-x', 41234, runner);
  for (const key of ['GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'COWORK_SERVER_PACKAGE', 'UV_TOOL_DIR', 'Path']) assert.equal(environment[key], undefined, key);
  assert.equal(environment.PATH, 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem;C:\\Windows\\System32\\WindowsPowerShell\\v1.0');
  for (const key of ['USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR']) {
    assert.ok(environment[key].startsWith('D:\\a\\_temp\\cowork-profile-x'), key);
  }
  assert.equal(environment.COWORK_SERVER_PORT, '41234');
});

// Shapes recorded from the hosted runner: no InstallLocation, and Stable's folder is the package name.
const registration = (displayName, displayIcon) => ({ displayName, installLocation: null, displayIcon });
const programs = 'C:\\Users\\runneradmin\\AppData\\Local\\Programs';

test('the installed executable comes from the channel\'s own uninstall registration', () => {
  const staging = registration('MindsHub Cowork (Staging) 2.261023.1-722.ge5d59fbb', `${programs}\\anton\\MindsHub Cowork (Staging).exe,0`);
  const prod = registration('MindsHub Cowork 2.261023.1', `"${programs}\\MindsHub Cowork\\MindsHub Cowork.exe",0`);
  assert.deepEqual(installedExecutable([staging, prod], 'MindsHub Cowork (Staging)', programs), { installLocation: `${programs}\\anton`, executable: `${programs}\\anton\\MindsHub Cowork (Staging).exe` });
  // Prod's name is a prefix of Staging's; a startsWith match would see two installations.
  assert.equal(installedExecutable([staging, prod], 'MindsHub Cowork', programs).executable, `${programs}\\MindsHub Cowork\\MindsHub Cowork.exe`);
  assert.throws(() => installedExecutable([staging], 'MindsHub Cowork', programs), /found 0/);
  assert.throws(() => installedExecutable([prod, { ...prod }], 'MindsHub Cowork', programs), /found 2/);
  for (const displayIcon of ['C:\\Windows\\System32\\cmd.exe,0', `${programs}\\MindsHub Cowork\\icon.ico`, `${programs}\\MindsHub Cowork.exe`, `${programs}\\a\\b\\MindsHub Cowork.exe`, 'C:\\Users\\other\\MindsHub Cowork\\MindsHub Cowork.exe']) {
    assert.throws(() => installedExecutable([{ ...prod, displayIcon }], 'MindsHub Cowork', programs), /per-user Programs folder/, displayIcon);
  }
});

test('Windows installer URLs and manifests are checked like the macOS package', () => {
  const version = '2.26.10.23.1-stable-e5d59fb';
  const key = `mindshub-cowork/windows/snapshots/mindshub-cowork-${version}.exe`;
  const url = `https://downloads.mindshub.ai/${key}`;
  const manifest = { version, key, url, size_bytes: 113843464, sha256: '523d85c9abea24ac973c60adec1d3a160dc183d42f447280215f3543fc9f4c90' };
  assert.equal(validateManifest(manifest, 'stable', url, '', 'windows'), manifest);
  assert.throws(() => validateManifest(manifest, 'stable', url.replace('e5d59fb', '1234567'), '', 'windows'), /this pipeline/);
  assert.throws(() => validateManifest(manifest, 'stable'), /macOS package URL/);
  for (const invalid of [url.replace('.exe', '.pkg'), url.replace('/windows/', '/mac/'), `${url}?x=1`, url.replace('/snapshots/', '/')]) {
    assert.throws(() => packageIdentity(invalid, 'stable', 'windows'));
  }
  assert.equal(packageIdentity('https://downloads.mindshub.ai/mindshub-cowork/windows/mindshub-cowork-2.26.10.23.1.exe', 'prod', 'windows'), '2.26.10.23.1');
});

test('the notification reads Windows results and can name the root-trim phase', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cowork-windows-summary-'));
  const artifacts = join(directory, 'test-results/windows-setup-stable');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, failingStep: 'Trim root store' }));
  const output = join(directory, 'output');
  writeFileSync(output, '');
  const processResult = spawnSync(process.execPath, [resolve('scripts/macos-setup-summary.mjs')], { cwd: directory, env: { ...process.env, CHANNELS: 'stable', GITHUB_OUTPUT: output, INSTALL_RESULT: 'failure', SETUP_PLATFORM: 'windows' }, encoding: 'utf8' });
  assert.equal(processResult.status, 0, processResult.stderr);
  assert.match(readFileSync(output, 'utf8'), /label=Windows setup \(stable: Trim root store; setup logs/);
  const unknown = spawnSync(process.execPath, [resolve('scripts/macos-setup-summary.mjs')], { cwd: directory, env: { ...process.env, CHANNELS: 'stable', GITHUB_OUTPUT: output, SETUP_PLATFORM: 'linux' }, encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
});

test('the real smoke command refuses a local machine and still writes failure evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cowork-windows-guard-'));
  const command = spawnSync(process.execPath, [resolve('scripts/windows-setup-smoke.mjs')], {
    cwd: directory, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, GITHUB_ACTIONS: 'false', WINDOWS_SETUP_CHANNEL: 'stable', GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(command.status, 1, command.stderr);
  const result = JSON.parse(readFileSync(join(directory, 'test-results/windows-setup-stable/result.json'), 'utf8'));
  assert.equal(result.passed, false);
  assert.equal(result.failingStep, 'Preparation');
  assert.match(result.error, /GitHub-hosted Windows runner/);
});

function setupObserver(invoke, isMainFrame = true) {
  const ipcRenderer = new EventEmitter();
  ipcRenderer.invoke = invoke;
  let bridge;
  runInNewContext(readFileSync(new URL('./windows-setup-observer.cjs', import.meta.url), 'utf8'), {
    process: { isMainFrame },
    require: (name) => {
      assert.equal(name, 'electron');
      return { ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => {
        assert.equal(name, '__setupSmoke');
        bridge = value;
      } } };
    },
  });
  return { ipcRenderer, snapshot: () => JSON.parse(JSON.stringify(bridge.snapshot())), bridge };
}

test('the observer routes onboarding to setup without starting or replacing installation', async () => {
  const calls = [];
  const { ipcRenderer, snapshot } = setupObserver(async (...args) => {
    calls.push(args);
    return args[0] === 'install:start' ? true : { configured: false };
  });
  assert.equal(snapshot().startCalls, 0);
  assert.equal(calls.length, 0);
  assert.equal((await ipcRenderer.invoke('settings:check-configured')).configured, true);
  assert.equal(calls.length, 0);
  await ipcRenderer.invoke('install:check', 'unchanged argument');
  assert.deepEqual(calls, [['install:check', 'unchanged argument']]);
  assert.equal(await ipcRenderer.invoke('install:start'), true);
  assert.equal(snapshot().returned, true);
  assert.equal(snapshot().startCalls, 1);
  assert.equal(calls.filter(([channel]) => channel === 'install:start').length, 1);
  assert.equal((await ipcRenderer.invoke('settings:check-configured')).configured, false);
  await ipcRenderer.invoke('install:start');
  assert.equal(snapshot().startCalls, 2);
});

test('completion events cannot turn a false return or warning into a passing setup', async () => {
  for (const returned of [false, true]) {
    const { ipcRenderer, snapshot } = setupObserver(async () => returned);
    const steps = ['uv', 'cowork-server', 'verify', 'server'].map((id) => ({ id, status: 'done' }));
    ipcRenderer.emit('install:progress', {}, steps);
    ipcRenderer.emit('install:log', {}, 'uv not found. Installing...\n');
    ipcRenderer.emit('install:log', {}, 'uv installed at fixture\n');
    ipcRenderer.emit('install:done', {});
    assert.equal(snapshot().returned, null);
    assert.equal(await ipcRenderer.invoke('install:start'), returned);
    assert.equal(snapshot().returned, returned);
    if (returned) assert.doesNotThrow(() => assertSetupPassed(snapshot()));
    else assert.throws(() => assertSetupPassed(snapshot()), /did not finish successfully/);
    steps[3].status = 'warning';
    ipcRenderer.emit('install:progress', {}, steps);
    assert.throws(() => assertSetupPassed(snapshot()));
  }
});

test('the observer preserves installer rejection, error and cancellation without installing in subframes', async () => {
  const error = new Error('installer failed');
  const { ipcRenderer, snapshot } = setupObserver(async () => { throw error; });
  await assert.rejects(ipcRenderer.invoke('install:start'), (actual) => actual === error);
  assert.equal(snapshot().returned, false);
  assert.match(snapshot().error, /installer failed/);
  ipcRenderer.emit('install:error', {}, 'certificate failure');
  assert.equal(snapshot().error, 'certificate failure');
  ipcRenderer.emit('install:cancelled', {});
  assert.equal(snapshot().cancelled, true);
  const child = setupObserver(() => assert.fail('subframe invoked IPC'), false);
  assert.equal(child.bridge, undefined);
  assert.equal(child.ipcRenderer.eventNames().length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageIdentity, validateManifest } from './macos-setup-contract.mjs';
import { appEnvironment, assertTrimmed, installedExecutable, removalScript, rootsToRemove } from './windows-setup-contract.mjs';

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

test('the removal script names exactly the planned certificates and refuses anything else', () => {
  assert.equal(
    removalScript([entry('LocalMachine\\AuthRoot', OTHER), entry('LocalMachine\\Root', R3)]),
    `Remove-Item -LiteralPath 'Cert:\\LocalMachine\\AuthRoot\\${OTHER}'\nRemove-Item -LiteralPath 'Cert:\\LocalMachine\\Root\\${R3}'`,
  );
  // CurrentUser\Root deletes open a confirmation dialog; a quote would escape the literal path.
  assert.throws(() => removalScript([entry('CurrentUser\\Root', R3)]), /Refusing/);
  assert.throws(() => removalScript([entry('LocalMachine\\Root', `${R3.slice(0, 39)}'`)]), /Refusing/);
  assert.throws(() => removalScript([entry('LocalMachine\\My', R3)]), /Refusing/);
});

test('a trim that left a downloaded root or a named root visible to Python fails before setup', () => {
  assert.doesNotThrow(() => assertTrimmed([entry('LocalMachine\\Root', 'B'.repeat(40)), entry('CurrentUser\\Root', 'B'.repeat(40))]));
  assert.throws(() => assertTrimmed([entry('LocalMachine\\AuthRoot', OTHER)]), /remain in LocalMachine\\AuthRoot/);
  assert.throws(() => assertTrimmed([entry('CurrentUser\\Root', R3)]), /GlobalSign Root CA - R3 in CurrentUser\\Root/);
  assert.throws(() => assertTrimmed([entry('LocalMachine\\Root', X1)]), /ISRG Root X1 in LocalMachine\\Root/);
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

const registration = (displayName, installLocation, displayIcon) => ({ displayName, installLocation, displayIcon });
const programs = 'C:\\Users\\runneradmin\\AppData\\Local\\Programs';

test('the installed executable comes from the channel\'s own uninstall registration', () => {
  const staging = registration('MindsHub Cowork (Staging) 2.26.10.23.1', `${programs}\\MindsHub Cowork (Staging)`, `"${programs}\\MindsHub Cowork (Staging)\\MindsHub Cowork (Staging).exe",0`);
  const prod = registration('MindsHub Cowork 2.26.10.23.1', `${programs}\\MindsHub Cowork`, `${programs}\\MindsHub Cowork\\MindsHub Cowork.exe,0`);
  assert.equal(installedExecutable([staging, prod], 'MindsHub Cowork (Staging)').executable, `${programs}\\MindsHub Cowork (Staging)\\MindsHub Cowork (Staging).exe`);
  // Prod's name is a prefix of Staging's; a startsWith match would see two installations.
  assert.equal(installedExecutable([staging, prod], 'MindsHub Cowork').executable, `${programs}\\MindsHub Cowork\\MindsHub Cowork.exe`);
  assert.throws(() => installedExecutable([staging], 'MindsHub Cowork'), /found 0/);
  assert.throws(() => installedExecutable([prod, { ...prod }], 'MindsHub Cowork'), /found 2/);
  assert.throws(() => installedExecutable([{ ...prod, displayIcon: 'C:\\Windows\\System32\\cmd.exe,0' }], 'MindsHub Cowork'), /not inside/);
  assert.throws(() => installedExecutable([{ ...prod, displayIcon: `${programs}\\MindsHub Cowork\\icon.ico` }], 'MindsHub Cowork'), /not inside/);
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

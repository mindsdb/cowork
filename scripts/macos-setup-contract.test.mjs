import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertAppIdentity, assertSetupPassed, channels, failureStep, packageIdentity, validateManifest, STEP_NAMES } from './macos-setup-contract.mjs';

function completed() {
  return {
    steps: Object.keys(STEP_NAMES).map((id) => ({ id, status: 'done' })),
    done: true, returned: true, cancelled: false, error: '',
    log: 'uv not found. Installing...\nuv installed at /fresh/.local/bin/uv.\n',
  };
}

test('all four real steps must finish, including cold uv bootstrap', () => {
  assert.doesNotThrow(() => assertSetupPassed(completed()));
  const warm = completed();
  warm.log = 'uv found at /opt/homebrew/bin/uv.\n';
  assert.throws(() => assertSetupPassed(warm), /Install uv.*existing uv/);
});

test('INSTALL_DONE and a true return cannot hide a Start server warning', () => {
  const result = completed();
  result.steps[3].status = 'warning';
  assert.equal(failureStep(result), 'Start server');
  assert.throws(() => assertSetupPassed(result), /Start server: warning/);
});

test('Verify error is attributed even without a completion event', () => {
  const result = completed();
  result.steps[2].status = 'error';
  result.done = false;
  result.returned = false;
  result.error = 'Could not determine the installed version';
  assert.throws(() => assertSetupPassed(result), /Verify installation: Could not determine/);
});

for (const status of ['pending', 'running', 'skipped', 'error', 'warning']) {
  test(`a ${status} step never passes`, () => {
    const result = completed();
    result.steps[1].status = status;
    assert.throws(() => assertSetupPassed(result), /Install cowork-server/);
  });
}

for (const [name, change] of [
  ['missing step', (result) => result.steps.pop()],
  ['duplicate step', (result) => { result.steps[3] = result.steps[2]; }],
  ['unexpected step', (result) => { result.steps[3] = { id: 'other', status: 'done' }; }],
  ['cancelled setup', (result) => { result.cancelled = true; }],
  ['hung setup', (result) => { result.returned = null; result.done = false; result.steps[1].status = 'running'; }],
  ['false return', (result) => { result.returned = false; }],
  ['missing completion', (result) => { result.done = false; }],
]) {
  test(`${name} fails`, () => {
    const result = completed();
    change(result);
    assert.throws(() => assertSetupPassed(result));
  });
}

const version = '2.26.10.23.1-stable-e710635';
const key = `mindshub-cowork/mac/snapshots/mindshub-cowork-${version}.pkg`;
const url = `https://downloads.mindshub.ai/${key}`;
const manifest = { version, key, url, sha256: 'a'.repeat(64), size_bytes: 225101117 };

test('published package identity is pinned to the triggering upload', () => {
  assert.equal(validateManifest(manifest, 'stable', url), manifest);
  assert.throws(() => validateManifest(manifest, 'stable', url.replace('e710635', '1234567')), /this pipeline/);
  assert.throws(() => validateManifest({ ...manifest, key: key.replace('e710635', '1234567') }, 'stable'), /inconsistent/);
  assert.throws(() => validateManifest({ ...manifest, sha256: 'bad' }, 'stable'), /inconsistent/);
  assert.throws(() => validateManifest({ ...manifest, size_bytes: 0 }, 'stable'), /inconsistent/);
});

test('package URLs refuse foreign hosts, credentials, redirects-by-query and other channels', () => {
  for (const invalid of [url.replace('downloads.mindshub.ai', 'example.com'), `${url}?redirect=x`, `${url}#x`, url.replace('https://', 'https://user@'), url.replace('/snapshots/', '/previews/'), url.replace('.pkg', '.exe')]) {
    assert.throws(() => packageIdentity(invalid, 'stable'));
  }
  assert.throws(() => packageIdentity(url, 'prod'));
});

test('prod checks the actual release tag, not a previous manifest', () => {
  const prodVersion = '2.26.10.23.1';
  const prodKey = `mindshub-cowork/mac/mindshub-cowork-${prodVersion}.pkg`;
  const prod = { ...manifest, version: prodVersion, key: prodKey, url: `https://downloads.mindshub.ai/${prodKey}` };
  assert.doesNotThrow(() => validateManifest(prod, 'prod', prod.url, `v${prodVersion}`));
  assert.throws(() => validateManifest(prod, 'prod', '', '2.26.10.24.1'), /tagged release/);
  assert.doesNotThrow(() => assertAppIdentity({ app: prodVersion, buildKind: 'prod', source: 'bundled', ui: null }, prodVersion, 'prod'));
  assert.throws(() => assertAppIdentity({ app: '2.0.7', buildKind: 'prod', source: 'bundled', ui: null }, prodVersion, 'prod'), /differs/);
});

test('Stable correlates git-describe display version with its manifest release and commit', () => {
  const info = { app: '2.26.10.23.1-714-ge7106359b', buildKind: 'stable', source: 'bundled', ui: null };
  assert.doesNotThrow(() => assertAppIdentity(info, version, 'stable'));
  assert.doesNotThrow(() => assertAppIdentity({ ...info, app: '2.26.10.23.1' }, version, 'stable'));
  assert.throws(() => assertAppIdentity({ ...info, app: '2.26.10.23.1-714-g123456789' }, version, 'stable'), /differs/);
  assert.throws(() => assertAppIdentity({ ...info, app: '2.26.10.22.1-714-ge7106359b' }, version, 'stable'), /differs/);
  assert.throws(() => assertAppIdentity({ ...info, source: 'ota', ui: '2.26.10.25.1' }, version, 'stable'), /bundled renderer/);
  assert.throws(() => assertAppIdentity({ ...info, buildKind: 'prod' }, version, 'stable'), /installed channel/);
});

test('channel selection refuses empty, duplicate and unknown matrix entries', () => {
  assert.deepEqual(channels('prod,stable'), ['prod', 'stable']);
  for (const value of ['', 'prod,', 'prod,prod', 'preview', 'prod,other']) assert.throws(() => channels(value));
});

test('notification names a failing step, reports missing evidence, and never accepts raw text into its label', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cowork-summary-'));
  const artifacts = join(directory, 'test-results/macos-setup-stable');
  mkdirSync(artifacts, { recursive: true });
  const output = join(directory, 'output');
  const summarize = (value, installResult = 'failure') => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify(value));
    writeFileSync(output, '');
    const processResult = spawnSync(process.execPath, [resolve('scripts/macos-setup-summary.mjs')], { cwd: directory, env: { ...process.env, CHANNELS: 'prod,stable', GITHUB_OUTPUT: output, INSTALL_RESULT: installResult }, encoding: 'utf8' });
    assert.equal(processResult.status, 0, processResult.stderr);
    return readFileSync(output, 'utf8');
  };
  const failed = summarize({ passed: false, failingStep: 'Verify installation' });
  assert.match(failed, /failed=true/);
  assert.match(failed, /stable: Verify installation/);
  assert.match(failed, /prod: runner or workflow failure/);
  const unsafe = summarize({ passed: false, failingStep: '"\n@channel arbitrary log' });
  assert.match(unsafe, /stable: Setup/);
  assert.doesNotMatch(unsafe, /@channel/);
});

test('the real smoke command refuses local installation and still writes failure evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cowork-local-guard-'));
  const command = spawnSync(process.execPath, [resolve('scripts/macos-setup-smoke.mjs')], {
    cwd: directory, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, GITHUB_ACTIONS: 'false', MACOS_SETUP_CHANNEL: 'stable', GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(command.status, 1, command.stderr);
  const result = JSON.parse(readFileSync(join(directory, 'test-results/macos-setup-stable/result.json'), 'utf8'));
  assert.equal(result.passed, false);
  assert.equal(result.failingStep, 'Preparation');
  assert.match(result.error, /GitHub-hosted macOS runner/);
});

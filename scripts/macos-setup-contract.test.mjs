import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { assertAppIdentity, assertSetupPassed, channels, failureStep, forbiddenEntitlements, inspectableCopy, packageIdentity, validateManifest, FORBIDDEN_ENTITLEMENTS, STEP_NAMES } from './macos-setup-contract.mjs';
import { checkFuses, enableInspector, fuseMismatches, INSPECTABLE_FUSES, RELEASE_FUSES } from './release-fuses.mjs';

const require = createRequire(import.meta.url);
const { flipFuses, getCurrentFuseWire, FuseV1Options, FuseVersion } = require('@electron/fuses');
const { SENTINEL } = require('@electron/fuses/dist/constants.js');

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

test('the log lines and step ids this contract reads still come from the installer', () => {
  const installer = readFileSync(resolve('src/main/installer.ts'), 'utf8');
  for (const id of Object.keys(STEP_NAMES)) assert.ok(installer.includes(`id: '${id}'`), id);
  assert.ok(installer.includes('uv not found. Installing...'));
  assert.ok(installer.includes('uv installed at '));
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
  for (const step of ['Check release fuses', 'Check entitlements', 'Prepare inspectable copy']) {
    assert.match(summarize({ passed: false, failingStep: step }), new RegExp(`stable: ${step}`));
  }
  const unsafe =summarize({ passed: false, failingStep: '"\n@channel arbitrary log' });
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

/* A stand-in for an Electron binary: @electron/fuses finds the wire after its
   sentinel, a version byte and a length byte, one character per fuse. Electron
   45 ships the wire 10110001, which leaves all five release fuses unset. */
const ELECTRON_DEFAULTS = '10110001';
const fuseFixtures = mkdtempSync(join(tmpdir(), 'cowork-fuse-fixtures-'));
after(() => rmSync(fuseFixtures, { recursive: true, force: true }));
function electronBinary(states, name = 'electron') {
  const file = join(mkdtempSync(join(fuseFixtures, 'binary-')), name);
  writeFileSync(file, Buffer.concat([Buffer.from('code before'), Buffer.from(SENTINEL), Buffer.from([1, states.length]), Buffer.from(states), Buffer.from('code after')]));
  return file;
}

/** A wire @electron/fuses itself wrote with the release fuses, then `change`, and read back. */
async function releaseWire(change = {}) {
  const file = electronBinary(ELECTRON_DEFAULTS);
  await flipFuses(file, { version: FuseVersion.V1, ...RELEASE_FUSES, ...change });
  return getCurrentFuseWire(file);
}

test('a wire flipped to the release fuses passes, and an unfused Electron fails on all five', async () => {
  assert.deepEqual(fuseMismatches(await releaseWire()), []);
  assert.deepEqual(fuseMismatches(await getCurrentFuseWire(electronBinary(ELECTRON_DEFAULTS))), [
    'RunAsNode is on, expected off', 'EnableNodeOptionsEnvironmentVariable is on, expected off', 'EnableNodeCliInspectArguments is on, expected off',
    'EnableEmbeddedAsarIntegrityValidation is off, expected on', 'OnlyLoadAppFromAsar is off, expected on',
  ]);
});

for (const [index, enabled] of Object.entries(RELEASE_FUSES)) {
  test(`a release wire with only ${FuseV1Options[index]} wrong fails, naming it`, async () => {
    const [actual, expected] = enabled ? ['off', 'on'] : ['on', 'off'];
    assert.deepEqual(fuseMismatches(await releaseWire({ [index]: !enabled })), [`${FuseV1Options[index]} is ${actual}, expected ${expected}`]);
  });
}

test('a fuse the wire is too short to hold, a removed fuse, and another wire version fail', async () => {
  const short = electronBinary('1011');
  await flipFuses(short, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false });
  assert.deepEqual(fuseMismatches(await getCurrentFuseWire(short)), [
    'EnableEmbeddedAsarIntegrityValidation is missing, expected on', 'OnlyLoadAppFromAsar is missing, expected on',
  ]);
  assert.deepEqual(fuseMismatches(await getCurrentFuseWire(electronBinary('00001r01'))), ['OnlyLoadAppFromAsar is removed, expected on']);
  assert.deepEqual(fuseMismatches({ ...await releaseWire(), version: '2' }), ['fuse wire version 2 is not 1']);
});

test('the inspectable copy differs from the release in its inspector fuse alone, read the way the smokes read it', async () => {
  const file = electronBinary(ELECTRON_DEFAULTS, 'MindsHub Cowork.exe');
  await flipFuses(file, { version: FuseVersion.V1, ...RELEASE_FUSES });
  assert.deepEqual((await checkFuses(file)).mismatches, []);
  await enableInspector(file);
  const copy = await checkFuses(file, INSPECTABLE_FUSES);
  assert.deepEqual(copy.mismatches, []);
  assert.equal(copy.states['MindsHub Cowork.exe'].EnableNodeCliInspectArguments, 'on');
  assert.equal(copy.states['MindsHub Cowork.exe'].EnableCookieEncryption, 'off');
  assert.deepEqual((await checkFuses(file)).mismatches, ['MindsHub Cowork.exe: EnableNodeCliInspectArguments is on, expected off']);
});

/* What `codesign -d --entitlements - --xml` printed for a released app that still
   held both keys. codesign is macOS-only, and these tests run on Linux. */
const RELEASED_ENTITLEMENTS = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-dyld-environment-variables</key><true/><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/><key>com.apple.security.device.audio-input</key><true/></dict></plist>';
const withoutKey = (xml, key) => xml.replace(`<key>${key}</key><true/>`, '');

test('entitlements holding either forbidden key fail, and entitlements without them pass', () => {
  const [dyld, library] = FORBIDDEN_ENTITLEMENTS;
  assert.deepEqual(forbiddenEntitlements(RELEASED_ENTITLEMENTS), [dyld, library]);
  assert.deepEqual(forbiddenEntitlements(withoutKey(RELEASED_ENTITLEMENTS, library)), [dyld]);
  assert.deepEqual(forbiddenEntitlements(withoutKey(RELEASED_ENTITLEMENTS, dyld)), [library]);
  assert.deepEqual(forbiddenEntitlements(withoutKey(withoutKey(RELEASED_ENTITLEMENTS, dyld), library)), []);
  assert.deepEqual(forbiddenEntitlements(RELEASED_ENTITLEMENTS.replace(`<key>${dyld}</key><true/>`, `<key>${dyld}</key><false/>`)), [dyld, library]);
});

test('code signed without entitlements passes, and a print that is not a plist never passes as empty', () => {
  assert.deepEqual(forbiddenEntitlements(''), []);
  assert.deepEqual(forbiddenEntitlements('\n'), []);
  for (const print of ['[Dict]\n\t[Key] com.apple.security.cs.allow-jit\n\t[Value]\n\t\t[Bool] true\n', 'Executable=/Applications/MindsHub Cowork.app/Contents/MacOS/MindsHub Cowork', '<plist version="1.0"><dict>']) {
    assert.throws(() => forbiddenEntitlements(print), /did not print an entitlements plist/, print);
  }
});

test('the inspectable copy keeps the bundle\'s name in a fresh folder and launches the executable inside it', () => {
  const bundle = '/Applications/MindsHub Cowork (Staging).app';
  const copy = inspectableCopy(bundle, `${bundle}/Contents/MacOS/MindsHub Cowork (Staging)`, '/Users/runner/work/_temp/cowork-app-x', posix);
  assert.deepEqual(copy, {
    root: '/Users/runner/work/_temp/cowork-app-x/MindsHub Cowork (Staging).app',
    executable: '/Users/runner/work/_temp/cowork-app-x/MindsHub Cowork (Staging).app/Contents/MacOS/MindsHub Cowork (Staging)',
  });
  for (const executable of [bundle, '/Applications/MindsHub Cowork.app/Contents/MacOS/MindsHub Cowork', `${bundle}.old/Contents/MacOS/MindsHub Cowork (Staging)`]) {
    assert.throws(() => inspectableCopy(bundle, executable, '/Users/runner/work/_temp/cowork-app-x', posix), /not inside the installed app/, executable);
  }
});

/* src/main/release-hardening.invariant.test.ts pins electron-builder.yml's
   electronFuses block to RELEASE_FUSES. */
test('the entitlements file the build signs with passes the smoke entitlement scan', () => {
  assert.deepEqual(forbiddenEntitlements(readFileSync(resolve('build/entitlements.mac.plist'), 'utf8')), []);
});

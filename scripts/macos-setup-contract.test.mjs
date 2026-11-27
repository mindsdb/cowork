import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, posix, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import {
  checkLaunches, checkLint, diagnosticEvents, lintProblems, lintResult, refusalProblems, runAsNodeProblems,
  DENIED_LAUNCH, FOREIGN_LINT_RUNNER, FOREIGN_RUNNER_MARKER, LAUNCH_STEP, LINT_CASES, LINT_FIXTURES, LINT_STEP, MODULES_LOADED_EVENT, RENDERER_LOAD_EVENT, RUN_AS_NODE,
} from './installed-app-checks.mjs';
import { assertAppIdentity, assertSetupPassed, channels, failureStep, forbiddenEntitlements, inspectableCopy, packageIdentity, validateManifest, FORBIDDEN_ENTITLEMENTS, STEP_NAMES } from './macos-setup-contract.mjs';
import { heldEntitlements, FORBIDDEN_ENTITLEMENTS as RELEASE_CHECK_ENTITLEMENTS } from './release-app-check.mjs';
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
  for (const step of ['Check release fuses', 'Check entitlements', LAUNCH_STEP, LINT_STEP, 'Prepare inspectable copy']) {
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
   45.2.3 ships the nine-fuse wire 101100011, which leaves all five release
   fuses unset. @electron/fuses 1.8.0 names the first eight; the ninth is on. */
const ELECTRON_DEFAULTS = '101100011';
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

test('the build and the smokes refuse one list of entitlements', () => {
  assert.equal(RELEASE_CHECK_ENTITLEMENTS, FORBIDDEN_ENTITLEMENTS);
});

test('the entitlement check reads the app and each helper app, and names every forbidden key they hold', async () => {
  const bundle = join(mkdtempSync(join(fuseFixtures, 'bundle-')), 'MindsHub Cowork.app');
  for (const name of ['MindsHub Cowork Helper.app', 'MindsHub Cowork Helper (Renderer).app', 'Electron Framework.framework']) {
    mkdirSync(join(bundle, 'Contents/Frameworks', name), { recursive: true });
  }
  const read = [];
  const print = async (code) => {
    read.push(basename(code));
    return code.endsWith('(Renderer).app') ? RELEASED_ENTITLEMENTS : '';
  };
  assert.deepEqual(await heldEntitlements(bundle, print), FORBIDDEN_ENTITLEMENTS.map((key) => `MindsHub Cowork Helper (Renderer).app holds ${key}`));
  assert.deepEqual(read, ['MindsHub Cowork.app', 'MindsHub Cowork Helper (Renderer).app', 'MindsHub Cowork Helper.app']);
  const bare = join(mkdtempSync(join(fuseFixtures, 'bundle-')), 'Bare.app');
  mkdirSync(join(bare, 'Contents/Frameworks'), { recursive: true });
  await assert.rejects(heldEntitlements(bare, print), /has no helper apps to check/);
});

test('the build\'s release check passes an exe with the release fuses and fails one without them, naming each fuse', async () => {
  const check = (args) => spawnSync(process.execPath, [resolve('scripts/release-app-check.mjs'), ...args], { encoding: 'utf8', timeout: 15_000 });
  const release = electronBinary(ELECTRON_DEFAULTS, 'MindsHub Cowork.exe');
  await flipFuses(release, { version: FuseVersion.V1, ...RELEASE_FUSES });
  const passed = check([release]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /MindsHub Cowork\.exe holds the release fuses\./);
  const unfused = check([electronBinary(ELECTRON_DEFAULTS, 'MindsHub Cowork.exe')]);
  assert.equal(unfused.status, 1);
  assert.match(unfused.stderr, /release-app-check: MindsHub Cowork\.exe: RunAsNode is on, expected off/);
  assert.match(unfused.stderr, /release-app-check: MindsHub Cowork\.exe: OnlyLoadAppFromAsar is off, expected on/);
  for (const args of [[], [''], [release, release]]) assert.equal(check(args).status, 2, JSON.stringify(args));
});

test('the macOS build runs the release check on the signed app before it notarizes or packs it', () => {
  const script = readFileSync(resolve('scripts/release-mac-pkg-notarized.sh'), 'utf8');
  const check = script.indexOf('node scripts/release-app-check.mjs "$APP_PATH"');
  assert.ok(check > script.indexOf('codesign --verify --deep --strict'), 'after the signature check');
  assert.ok(check < script.indexOf('xcrun notarytool submit "$APP_ZIP"'), 'before notarization');
  assert.ok(check < script.indexOf('--sign "$INSTALLER_IDENTITY"'), 'before the installer is built');
  assert.match(script, /^set -euo pipefail$/m);
});

/* What main writes for one diagnostic (src/shared/diagnostics.ts). */
const diagnostic = (event, level = 'INFO') => JSON.stringify({ logged_at: '2026-11-27T00:00:00.000Z', logger: 'main.app', log_level: level, event, message: event.replace(/_/g, ' ') });

test('diagnostic events come from the JSON lines main writes, and from nothing else', () => {
  const stdout = ['[main] other output', diagnostic(MODULES_LOADED_EVENT), '{"not": "a diagnostic"}', '{broken', `  ${diagnostic(RENDERER_LOAD_EVENT)}\r`, ''].join('\n');
  assert.deepEqual(diagnosticEvents(stdout), [MODULES_LOADED_EVENT, RENDERER_LOAD_EVENT]);
});

test('a refused launch ends with status 1 and the guard\'s line before the app loads', () => {
  const refused = { exit: { code: 1, signal: null }, stdout: '', stderr: `${DENIED_LAUNCH.stderrLine}\n${diagnostic('launch_guard_refused_denied_switch', 'ERROR')}\n` };
  assert.deepEqual(refusalProblems(refused), []);
  assert.deepEqual(refusalProblems({ ...refused, stderr: refused.stderr.replace(/\n/g, '\r\n') }), []);
  assert.match(refusalProblems({ ...refused, exit: { code: 0, signal: null } }).join(' '), /status 0, not status 1/);
  assert.match(refusalProblems({ ...refused, exit: { code: null, signal: 'SIGKILL' } }).join(' '), /signal SIGKILL, not status 1/);
  assert.match(refusalProblems({ ...refused, stderr: 'launch-guard: a packaged build does not start with --remote-debugging-port\n' }).join(' '), /lacks "launch-guard/);
  assert.match(refusalProblems({ ...refused, stdout: `${diagnostic(MODULES_LOADED_EVENT)}\n` }).join(' '), /started before the guard ran: boot_modules_loaded/);
});

test('under ELECTRON_RUN_AS_NODE the app starts as the app and never prints the Node answer', () => {
  const started = { stdout: `${diagnostic(RENDERER_LOAD_EVENT)}\n`, stderr: '' };
  assert.deepEqual(runAsNodeProblems(started), []);
  assert.match(runAsNodeProblems({ stdout: `${RUN_AS_NODE.marker}\n`, stderr: '' }).join(' '), /ran the app as Node: it printed node-ran\..*never wrote main_loading_renderer_from/);
  assert.match(runAsNodeProblems({ ...started, stderr: `${RUN_AS_NODE.marker}\r\n` }).join(' '), /ran the app as Node/);
  // The launch's own arguments in a log line are not the answer.
  assert.deepEqual(runAsNodeProblems({ ...started, stderr: `argv: ${RUN_AS_NODE.args.join(' ')}\n` }), []);
});

/* What the bundled runner prints for a page with nothing to report. */
const PASSING = Object.freeze({ consoleErrors: [], failedRequests: [], crashed: false, crashDetails: null, emptyPage: false });
const lintOutput = (result) => `${diagnostic('crash_reporter_minidumps')}\nRESULT_JSON_START\n${JSON.stringify(result)}\nRESULT_JSON_END\n`;
const lintCase = (name) => LINT_CASES.find((entry) => entry.name === name);

test('the lint result is the JSON between the runner\'s markers, with the runner\'s fields', () => {
  assert.deepEqual(lintResult(lintOutput(PASSING)), PASSING);
  assert.deepEqual(lintResult(lintOutput(PASSING).replace(/\n/g, '\r\n')), PASSING);
  for (const output of ['', 'RESULT_JSON_START\n{}\n', `RESULT_JSON_START\n${JSON.stringify(PASSING)}\n\nRESULT_JSON_END\n`]) {
    assert.throws(() => lintResult(output), /no result between RESULT_JSON_START and RESULT_JSON_END/, output);
  }
  assert.throws(() => lintResult('RESULT_JSON_START\n{broken\nRESULT_JSON_END\n'), /not JSON/);
  assert.throws(() => lintResult(lintOutput({ ...PASSING, failedRequests: [{ url: 1, error: 'HTTP 404' }] })), /runner's fields/);
  assert.throws(() => lintResult(lintOutput({ consoleErrors: [] })), /runner's fields/);
});

test('each lint case passes only the report it expects', () => {
  const scriptError = { message: 'Uncaught Error: lint smoke: script error', line: 11 };
  const missingApp = { url: 'cowork-lint://artifact/app.js', error: 'HTTP 404' };
  for (const name of ['clean', 'module']) {
    assert.deepEqual(lintProblems(lintCase(name), PASSING), []);
    assert.match(lintProblems(lintCase(name), { ...PASSING, consoleErrors: [scriptError] }).join(' '), new RegExp(`${name}: console error`));
    assert.match(lintProblems(lintCase(name), { ...PASSING, failedRequests: [missingApp] }).join(' '), /cowork-lint:\/\/artifact\/app\.js failed with HTTP 404/);
    assert.match(lintProblems(lintCase(name), { ...PASSING, emptyPage: true }).join(' '), /empty page/);
    assert.match(lintProblems(lintCase(name), { ...PASSING, crashed: true }).join(' '), /crashed its renderer/);
  }
  assert.deepEqual(lintProblems(lintCase('script-error'), { ...PASSING, consoleErrors: [scriptError] }), []);
  assert.match(lintProblems(lintCase('script-error'), PASSING).join(' '), /no console error holds "lint smoke: script error"/);
  assert.deepEqual(lintProblems(lintCase('root-absolute'), { ...PASSING, failedRequests: [missingApp] }), []);
  // A lint that serves the page's folder at the origin root loads /app.js and reports nothing.
  assert.match(lintProblems(lintCase('root-absolute'), PASSING).join(' '), /root-absolute: no request for \/app\.js failed with HTTP 404/);
  for (const request of [{ ...missingApp, error: 'HTTP 403' }, { ...missingApp, url: 'cowork-lint://artifact/page/app.js' }]) {
    assert.match(lintProblems(lintCase('root-absolute'), { ...PASSING, failedRequests: [request] }).join(' '), /no request for \/app\.js/, request.url);
  }
});

test('the lint fixtures hold each page and the files beside it that its case needs', () => {
  const fixture = (name) => readFileSync(join(LINT_FIXTURES, name), 'utf8');
  for (const { page } of LINT_CASES) assert.ok(existsSync(join(LINT_FIXTURES, page)), page);
  assert.match(fixture('module/index.html'), /<script type="module">[\s\S]*from '\.\/greeting\.js'[\s\S]*fetch\('\.\/data\.json'\)/);
  assert.match(fixture('module/greeting.js'), /^export const greeting = /);
  assert.equal(JSON.parse(fixture('module/data.json')).status, 'loaded');
  assert.match(fixture('script-error/index.html'), /throw new Error\('lint smoke: script error'\)/);
  // app.js sits beside the page, so only a lint that serves the page's folder at the origin root loads /app.js.
  assert.match(fixture('root-absolute/index.html'), /<script src="\/app\.js"><\/script>/);
  assert.ok(existsSync(join(LINT_FIXTURES, 'root-absolute/app.js')));
  assert.ok(readFileSync(FOREIGN_LINT_RUNNER, 'utf8').includes(`'${FOREIGN_RUNNER_MARKER}\\n'`));
});

test('the lines, events and variables the launch and lint steps read still come from the app', () => {
  const source = (file) => readFileSync(resolve(file), 'utf8');
  const guard = source('src/main/launch-guard.ts');
  assert.ok(guard.includes("'host-rules',"), 'host-rules is a denied switch');
  assert.ok(DENIED_LAUNCH.args[0].startsWith('--host-rules='));
  assert.ok(guard.includes(DENIED_LAUNCH.stderrLine.replace('host-rules', '${refusal.name}\\n')), 'the guard writes the line the step reads');
  const app = source('src/main/app.ts');
  for (const event of [MODULES_LOADED_EVENT, RENDERER_LOAD_EVENT]) assert.ok(app.includes(`"INFO", "${event}"`), event);
  assert.ok(source('src/shared/diagnostics.ts').includes('LOG_LEVEL'));
  const runner = source('src/main/html-lint-runner.ts');
  for (const marker of ['RESULT_JSON_START', 'RESULT_JSON_END']) assert.ok(runner.includes(`'${marker}\\n'`), marker);
  const host = source('src/main/html-lint-host.ts');
  for (const name of ['ANTON_HTML_LINT_TARGET', 'ANTON_HTML_LINT_RUNNER']) assert.ok(host.includes(`'${name}'`), name);
});

test('the smoke launches and lints the installed app before it makes the inspectable copy', () => {
  const smoke = readFileSync(resolve('scripts/macos-setup-smoke.mjs'), 'utf8');
  const at = (text) => {
    const index = smoke.indexOf(text);
    assert.ok(index > 0, text);
    return index;
  };
  assert.ok(at("result.failingStep = 'Check entitlements'") < at('await checkLaunches(installedApp)'));
  assert.ok(at('await checkLaunches(installedApp)') < at('await checkLint(installedApp)'));
  assert.ok(at('await checkLint(installedApp)') < at("result.failingStep = 'Prepare inspectable copy'"));
  assert.match(smoke, /const installedApp = \{ executable: join\(bundle, 'Contents\/MacOS', executableName\),/);
});

/* A stand-in for the installed app, for the launch and lint steps. It answers
   the way a release build does unless FAKE_DEFECT names one way to differ:
   - ignores-guard: starts with a denied switch, then exits with status 0;
   - runs-as-node: runs `-e` under ELECTRON_RUN_AS_NODE=1, as plain Node does;
   - serves-origin-root: passes the root-absolute page, as a lint that served
     the page's folder at the origin root did;
   - runs-foreign-runner: runs the script ANTON_HTML_LINT_RUNNER names.
   Started as the app, it starts a child process that stays up and writes both
   process ids beside its Chromium profile folder, so a test can check that
   the step killed both. */
const FAKE_APP = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { basename, dirname } = require('node:path');
const defect = process.env.FAKE_DEFECT || '';
const args = process.argv.slice(2);
const target = process.env.ANTON_HTML_LINT_TARGET;
if (target) {
  if (defect === 'runs-foreign-runner') require(process.env.ANTON_HTML_LINT_RUNNER);
  const page = basename(dirname(target));
  const result = { consoleErrors: [], failedRequests: [], crashed: false, crashDetails: null, emptyPage: false };
  if (page === 'script-error') result.consoleErrors.push({ message: 'Uncaught Error: lint smoke: script error', line: 11 });
  if (page === 'root-absolute' && defect !== 'serves-origin-root') result.failedRequests.push({ url: 'cowork-lint://artifact/app.js', error: 'HTTP 404' });
  process.stdout.write('RESULT_JSON_START\\n' + JSON.stringify(result) + '\\nRESULT_JSON_END\\n');
  process.exit(0);
}
if (process.env.ELECTRON_RUN_AS_NODE === '1' && defect === 'runs-as-node') {
  console.log('node-ran');
  process.exit(0);
}
const log = (event) => { if (process.env.LOG_LEVEL === 'INFO') console.log(JSON.stringify({ log_level: 'INFO', event })); };
if (args.some((arg) => arg.startsWith('--host-rules'))) {
  if (defect !== 'ignores-guard') {
    process.stderr.write('launch-guard: a packaged build does not start with --host-rules\\n');
    process.exit(1);
  }
  log('boot_modules_loaded');
  process.exit(0);
}
log('boot_modules_loaded');
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
const profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
writeFileSync(profile + '.pids', JSON.stringify([process.pid, helper.pid]));
log('main_loading_renderer_from');
setInterval(() => {}, 1000);
`;
const fakeApps = mkdtempSync(join(tmpdir(), 'cowork-fake-app-'));
after(() => rmSync(fakeApps, { recursive: true, force: true }));
const posixOnly = { skip: process.platform === 'win32' && 'the stand-in app is a script that starts through its shebang line' };

function fakeInstalledApp(defect = '') {
  const folder = mkdtempSync(join(fakeApps, 'app-'));
  const executable = join(folder, 'fake-app');
  writeFileSync(executable, `#!${process.execPath}\n${FAKE_APP}`);
  chmodSync(executable, 0o755);
  const saved = new Map();
  let windowChecks = 0;
  const app = {
    executable,
    profile: async (purpose) => ({ env: { FAKE_DEFECT: defect }, userDataDir: join(mkdtempSync(join(folder, `${purpose}-`)), 'chromium') }),
    // The window shows on the second look, so the step has to wait for it.
    showsWindow: async () => ++windowChecks > 1,
    save: (name, value) => saved.set(name, value),
  };
  const pids = () => readdirSync(folder).map((name) => join(folder, name, 'chromium.pids')).filter((file) => existsSync(file)).flatMap((file) => JSON.parse(readFileSync(file, 'utf8')));
  return { app, saved, pids };
}

async function assertGone(pid) {
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() > deadline) assert.fail(`process ${pid} still runs after the step`);
    await delay(100);
  }
}

test('the launch step passes a release build, and kills each app it starts and the app\'s children', posixOnly, async () => {
  const { app, saved, pids } = fakeInstalledApp();
  await checkLaunches(app);
  assert.deepEqual([...saved.keys()], ['launch-plain.log', 'launch-denied-switch.log', 'launch-run-as-node.log']);
  assert.match(saved.get('launch-denied-switch.log'), /--user-data-dir=\S+ --host-rules=MAP \* 127\.0\.0\.1\nexit: status 1/);
  // The plain and run-as-node launches each start the app and one child.
  assert.equal(pids().length, 4);
  for (const pid of pids()) await assertGone(pid);
});

for (const [defect, message] of [
  ['ignores-guard', /status 0, not status 1\. Its stderr lacks "launch-guard: a packaged build does not start with --host-rules"\. The app started before the guard ran: boot_modules_loaded\./],
  ['runs-as-node', /ELECTRON_RUN_AS_NODE ran the app as Node: it printed node-ran\./],
]) {
  test(`the launch step fails a build that ${defect.replace(/-/g, ' ')}`, posixOnly, async () => {
    const { app, pids } = fakeInstalledApp(defect);
    await assert.rejects(checkLaunches(app), message);
    for (const pid of pids()) await assertGone(pid);
  });
}

test('the lint step passes a build whose bundled runner reports each page as its case expects', posixOnly, async () => {
  const { app, saved } = fakeInstalledApp();
  await checkLint(app);
  assert.deepEqual([...saved.keys()], LINT_CASES.map(({ name }) => `lint-${name}.log`));
  // Lint mode starts from the environment alone, as anton starts it.
  const [command, exit] = saved.get('lint-clean.log').split('\n');
  assert.match(command, /^\$ ANTON_HTML_LINT_TARGET=.*clean.index\.html ANTON_HTML_LINT_RUNNER=.*foreign-lint-runner\.cjs .*fake-app$/);
  assert.match(exit, /^exit: status 0 \(stopped\)$/);
});

for (const [defect, message] of [
  ['serves-origin-root', /root-absolute: no request for \/app\.js failed with HTTP 404\./],
  ['runs-foreign-runner', /clean: the app ran the script ANTON_HTML_LINT_RUNNER names\. clean: the lint ended with status 3\./],
]) {
  test(`the lint step fails a build that ${defect.replace(/-/g, ' ')}`, posixOnly, async () => {
    await assert.rejects(checkLint(fakeInstalledApp(defect).app), message);
  });
}

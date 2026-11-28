import { _electron } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, copyFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { checkLaunches, LAUNCH_STEP } from './installed-app-checks.mjs';
import { assertAppIdentity, assertSetupPassed, failureStep, packageIdentity, validateManifest, within, STEP_NAMES } from './macos-setup-contract.mjs';
import { heldEntitlements } from './release-app-check.mjs';
import { checkFuses } from './release-fuses.mjs';
import { makeInspectableCopy } from './inspectable-copy.mjs';

const execute = promisify(execFile);
const channel = process.env.MACOS_SETUP_CHANNEL;
const output = resolve('test-results', `macos-setup-${channel}`);
const result = { channel, passed: false, failingStep: 'Preparation', error: '', elapsedSeconds: 0 };
const setup = { steps: [], done: false, error: '', cancelled: false, returned: null, log: '' };
let app;
let page;
let profile;
let appEnvironment;
let serverLog;
const started = Date.now();

function save(name, value) {
  writeFileSync(join(output, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

async function command(file, args, options = {}) {
  try {
    const value = await execute(file, args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options });
    appendFileSync(join(output, 'package.log'), `$ ${file} ${args.join(' ')}\n${value.stdout}${value.stderr}\n`);
    return value.stdout.trim();
  } catch (error) {
    appendFileSync(join(output, 'package.log'), `${error.stdout ?? ''}${error.stderr ?? ''}\n${error.message}\n`);
    throw error;
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('Could not allocate a loopback port.');
  return address.port;
}

/** A fresh folder in RUNNER_TEMP to stand in for the app's home, with its temporary folder. */
async function freshHome(prefix) {
  const home = await mkdtemp(join(process.env.RUNNER_TEMP, prefix));
  await mkdir(join(home, 'tmp'));
  return home;
}

// An allowlist keeps CI tokens, provider configuration, and source overrides out of the app.
function isolatedEnvironment(home, port) {
  return {
    HOME: home, CFFIXED_USER_HOME: home, TMPDIR: join(home, 'tmp'), MAC_CHROMIUM_TMPDIR: join(home, 'tmp'),
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/sh', LANG: 'en_US.UTF-8',
    USER: process.env.USER, LOGNAME: process.env.LOGNAME,
    COWORK_SERVER_PORT: String(port),
    UV_CACHE_DIR: join(home, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(home, 'uv-python'),
  };
}

/** A throwaway profile for one launch of the installed app (installed-app-checks.mjs). */
async function throwawayProfile(purpose) {
  const home = await freshHome(`cowork-${purpose}-`);
  return { env: isolatedEnvironment(home, await freePort()), userDataDir: join(home, 'chromium') };
}

async function downloadManifest() {
  const snapshot = process.env.MACOS_SETUP_SNAPSHOT_URL;
  if (snapshot) {
    if (channel !== 'stable' || !/^[a-f0-9]{64}$/.test(process.env.MACOS_SETUP_SNAPSHOT_SHA256 ?? '')) {
      throw new Error('Historical snapshots require stable and an independently recorded SHA-256.');
    }
    return { version: packageIdentity(snapshot, channel), url: snapshot, sha256: process.env.MACOS_SETUP_SNAPSHOT_SHA256, historical: true };
  }
  const name = channel === 'stable' ? 'staging.json' : 'latest.json';
  const response = await fetch(`https://downloads.mindshub.ai/mindshub-cowork/mac/${name}`, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
  return validateManifest(await response.json(), channel, process.env.MACOS_SETUP_EXPECTED_URL, process.env.MACOS_SETUP_EXPECTED_VERSION);
}

async function run() {
  // Installing a pkg changes /Applications. Only disposable hosted runners run this command.
  if (process.platform !== 'darwin' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('Run this smoke through Actions on a GitHub-hosted macOS runner.');
  }
  if (!['prod', 'stable'].includes(channel)) throw new Error('Select prod or stable.');
  const appName = channel === 'stable' ? 'MindsHub Cowork (Staging)' : 'MindsHub Cowork';
  const bundle = `/Applications/${appName}.app`;
  if (existsSync(bundle)) throw new Error('Runner already has this app installed.');
  const manifest = await downloadManifest();
  save('manifest.json', manifest);
  result.version = manifest.version;
  result.failingStep = 'Download package';
  const response = await fetch(manifest.url, { redirect: 'error', signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Package HTTP ${response.status}`);
  const pkg = join(process.env.RUNNER_TEMP, `cowork-${channel}.pkg`);
  const hash = createHash('sha256');
  let bytes = 0;
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => { hash.update(chunk); bytes += chunk.length; });
  await pipeline(source, createWriteStream(pkg, { flags: 'wx' }));
  if (hash.digest('hex') !== manifest.sha256 || (manifest.size_bytes && bytes !== manifest.size_bytes)) throw new Error('Downloaded package checksum/size differs from the manifest.');
  result.failingStep = 'Install package';
  await command('/usr/sbin/pkgutil', ['--check-signature', pkg]);
  await command('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose', pkg]);
  await command('/usr/bin/sudo', ['-n', '/usr/sbin/installer', '-pkg', pkg, '-target', '/'], { timeout: 5 * 60_000 });
  const executableName = await command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', join(bundle, 'Contents/Info.plist')]);
  if (!executableName || executableName.includes('/')) throw new Error('Invalid installed executable name.');

  result.failingStep = 'Check release fuses';
  const fuses = await checkFuses(bundle);
  save('fuses-installed.json', fuses.states);
  if (fuses.mismatches.length) throw new Error(`Installed app does not carry the release fuses: ${fuses.mismatches.join('; ')}.`);

  result.failingStep = 'Check entitlements';
  // The same check the build runs before it uploads the app (release-app-check.mjs).
  const held = await heldEntitlements(bundle);
  if (held.length) throw new Error(`${held.join('; ')}.`);

  /* The installed, notarized app under its hardened runtime and library
     validation, which the inspectable copy below gives up. Each launch uses a
     throwaway home and Chromium profile and is killed before the next. */
  const installedApp = { executable: join(bundle, 'Contents/MacOS', executableName), profile: throwawayProfile, save };
  result.failingStep = LAUNCH_STEP;
  await checkLaunches(installedApp);

  result.failingStep = 'Prepare inspectable copy';
  /* Playwright attaches through Node's inspector, which the release fuses off,
     so the smoke drives the copy that testers make with scripts/inspectable-copy.mjs,
     and leaves the installed app as shipped. */
  const copy = await makeInspectableCopy({
    installed: bundle, executable: join(bundle, 'Contents/MacOS', executableName),
    folder: await mkdtemp(join(process.env.RUNNER_TEMP, 'cowork-app-')), exec: command,
  }).catch((error) => {
    if (error.fuses) save('fuses-copy.json', error.fuses);
    throw error;
  });
  save('fuses-copy.json', copy.fuses);
  const executablePath = copy.executable;

  result.failingStep = 'Launch and isolate app';
  profile = await freshHome('cowork-profile-');
  const port = await freePort();
  appEnvironment = isolatedEnvironment(profile, port);
  app = await _electron.launch({ executablePath, args: [`--user-data-dir=${join(profile, 'chromium')}`], env: appEnvironment, timeout: 60_000 });
  app.process().stdout?.on('data', (chunk) => appendFileSync(join(output, 'electron-stdout.log'), chunk));
  app.process().stderr?.on('data', (chunk) => appendFileSync(join(output, 'electron-stderr.log'), chunk));
  const isolation = await bounded(app.evaluate(async ({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
    const path = require('node:path');
    const root = app.getAppPath();
    const paths = Object.fromEntries(['home', 'appData', 'userData', 'sessionData', 'logs', 'crashDumps'].map((key) => [key, app.getPath(key)]));
    const uv = require(path.join(root, 'dist/main/main/uv-paths.js'));
    await uv.primeLoginShellPath();
    return {
      packaged: app.isPackaged, executable: process.execPath, nodeHome: require('node:os').homedir(), paths,
      uv: await uv.resolveUv(), toolDir: process.env.UV_TOOL_DIR, toolBinDir: process.env.UV_TOOL_BIN_DIR,
      coworkHome: require(path.join(root, 'dist/main/main/cowork-home.js')).coworkHome(),
      serverLog: require(path.join(root, 'dist/main/main/server-process.js')).getServerLogPath(),
    };
  }), 15_000, 'App isolation probe timed out.');
  save('isolation.json', isolation);
  if (!isolation.packaged || await realpath(isolation.executable) !== await realpath(executablePath)) throw new Error('Not running the inspectable copy\'s packaged executable.');
  for (const path of [isolation.nodeHome, isolation.coworkHome, isolation.serverLog, ...Object.values(isolation.paths), isolation.toolDir, isolation.toolBinDir].filter(Boolean)) {
    if (!within(profile, path)) throw new Error(`App path escapes the fresh profile: ${path}`);
  }
  if (isolation.uv !== null) throw new Error(`Runner exposes preinstalled uv at ${isolation.uv}; cold bootstrap cannot be tested.`);
  serverLog = isolation.serverLog;
  page = await app.firstWindow({ timeout: 30_000 });
  await bounded(app.context().tracing.start({ screenshots: true, snapshots: true }), 15_000, 'Trace startup timed out.');
  await page.waitForFunction(() => Boolean(window.antontron?.awaitBootReady), null, { timeout: 30_000 });
  await bounded(page.evaluate(() => window.antontron.awaitBootReady()), 60_000, 'App boot timed out.');
  const info = await bounded(page.evaluate(() => window.antontron.getUIVersion()), 10_000, 'App identity timed out.');
  save('app-identity.json', info);
  assertAppIdentity(info, manifest.version, channel);
  const initial = await bounded(page.evaluate(() => window.antontron.checkInstall()), 30_000, 'Initial installation probe timed out.');
  save('initial-install.json', initial);
  if (initial.antonInstalled !== false || initial.serverDepsReady !== false) throw new Error('Initial profile is already installed or its state is unknown.');
  await page.screenshot({ path: join(output, 'before.png'), timeout: 10_000 });

  result.failingStep = 'Setup';
  await bounded(page.evaluate(() => {
    const state = window.__setupSmoke = { steps: [], done: false, error: '', cancelled: false, returned: null, log: '' };
    const bridge = window.antontron;
    bridge.onInstallLog((line) => { state.log += line; });
    bridge.onInstallProgress((steps) => { state.steps = steps; });
    bridge.onInstallDone(() => { state.done = true; });
    bridge.onInstallError((error) => { state.error = error; });
    bridge.onInstallCancelled(() => { state.cancelled = true; });
    // Store the promise in the page and observe both outcomes; Node polls the state until it settles.
    window.__setupSmokeRun = bridge.startInstall().then(
      (value) => { state.returned = value; },
      (error) => { state.error = String(error); state.returned = false; },
    );
  }), 10_000, 'App stopped answering before setup started.');
  const deadline = Date.now() + 15 * 60_000;
  while (true) {
    if (page.isClosed()) throw new Error('App window closed during setup.');
    const current = await bounded(page.evaluate(() => window.__setupSmoke), 10_000, 'App stopped answering during setup.');
    if (!current) throw new Error('App reloaded during setup.');
    Object.assign(setup, current);
    save('setup.log', setup.log);
    save('steps.json', setup.steps);
    result.failingStep = failureStep(setup);
    if (setup.returned !== null || setup.error || setup.cancelled) break;
    if (Date.now() > deadline) throw new Error(`${failureStep(setup)}: setup timed out after 15 minutes.`);
    await delay(500);
  }
  assertSetupPassed(setup);
  result.failingStep = 'Start server';
  const server = await bounded(page.evaluate(() => window.antontron.serverInfo()), 10_000, 'Server state timed out.');
  if (!server.running || server.port !== port) throw new Error('Installed server is not running on its isolated port.');
  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/v1/health/`, { signal: AbortSignal.timeout(5000) });
  const health = await healthResponse.json();
  save('health.json', health);
  if (!healthResponse.ok || !health.capabilities?.includes('coding')) throw new Error('Installed server health is incompatible.');
  assertAppIdentity(await bounded(page.evaluate(() => window.antontron.getUIVersion()), 10_000, 'Final app identity timed out.'), manifest.version, channel);
  result.passed = true;
  result.failingStep = '';
}

await mkdir(output, { recursive: true });
try {
  await run();
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  // Collect named diagnostics only. Never archive the profile, credential files, or installed environment.
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: join(output, 'after.png'), timeout: 10_000 }); } catch (error) { save('screenshot-error.txt', error.message); }
    try { save('server-diagnostics.json', await bounded(page.evaluate(() => window.antontron.serverDiagnostics()), 10_000, 'Diagnostics timed out.')); } catch (error) { save('diagnostics-error.txt', error.message); }
  }
  if (serverLog && existsSync(serverLog)) {
    try { await copyFile(serverLog, join(output, 'server.log')); } catch (error) { save('server-log-error.txt', error.message); }
  }
  const uv = profile && join(profile, '.local/bin/uv');
  if (uv && existsSync(uv)) {
    try { save('uv-version.log', (await execute(uv, ['--version'], { env: appEnvironment, timeout: 15_000 })).stdout); } catch (error) { save('uv-version.log', error.message); }
    const toolRoot = channel === 'stable' ? join(profile, '.cowork-stable/uv') : join(profile, '.local/share/uv');
    try {
      const diagnostic = await execute(uv, ['tool', 'list'], { env: { ...appEnvironment, UV_TOOL_DIR: join(toolRoot, 'tools') }, timeout: 15_000 });
      save('uv-tool-list.log', diagnostic.stdout + diagnostic.stderr);
    } catch (error) {
      const diagnostic = `${error.stdout ?? ''}${error.stderr ?? ''}\n${error.message}`;
      save('uv-tool-list.log', diagnostic);
      appendFileSync(join(output, 'setup.log'), `\nPost-setup uv tool list diagnostic:\n${diagnostic}\n`);
    }
  }
  if (app) {
    try { await bounded(app.context().tracing.stop({ path: join(output, 'trace.zip') }), 15_000, 'Trace save timed out.'); } catch (error) { save('trace-error.txt', error.message); }
    try { await bounded(app.close(), 20_000, 'App shutdown timed out.'); } catch (error) {
      save('close-error.txt', error.message);
      app.process().kill('SIGKILL');
    }
  }
  result.elapsedSeconds = Math.round((Date.now() - started) / 1000);
  result.steps = setup.steps;
  save('result.json', result);
  const summary = [`### macOS setup: ${channel}`, `Version: ${result.version ?? 'unresolved'}`, ...setup.steps.map((step) => `- ${STEP_NAMES[step.id] ?? step.id}: ${step.status}`), result.passed ? 'Result: passed' : `Result: failed at ${result.failingStep}: ${result.error}`, `Elapsed: ${result.elapsedSeconds}s`].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

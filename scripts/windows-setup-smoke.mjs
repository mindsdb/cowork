import { _electron } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createWriteStream, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, copyFile, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { channelIdentity } from './channel-identity.mjs';
import { assertAppIdentity, assertSetupPassed, failureStep, packageIdentity, validateManifest, STEP_NAMES } from './macos-setup-contract.mjs';
import { appEnvironment as isolatedEnvironment, assertTrimmed, installedExecutable, removalPlan, rootsToRemove, ON_DEMAND_ROOTS, ROOT_AUTO_UPDATE_BACKUP, ROOT_BACKUP, ROOT_STORES } from './windows-setup-contract.mjs';

const execute = promisify(execFile);
const channel = process.env.WINDOWS_SETUP_CHANNEL;
const output = resolve('test-results', `windows-setup-${channel}`);
const result = { channel, passed: false, failingStep: 'Preparation', error: '', elapsedSeconds: 0 };
const setup = { steps: [], done: false, error: '', cancelled: false, returned: null, log: '', startCalls: 0 };
let app;
let page;
let profile;
let appEnvironment;
let serverLog;
let toolDir;
let trimmed = false;
let terminalScreenshot = false;
const started = Date.now();

function save(name, value) {
  writeFileSync(join(output, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function within(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

async function command(file, args, options = {}) {
  try {
    const value = await execute(file, args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...options });
    appendFileSync(join(output, 'package.log'), `$ ${file} ${args.join(' ')}\n${value.stdout}${value.stderr}\n`);
    return value.stdout.trim();
  } catch (error) {
    appendFileSync(join(output, 'package.log'), `${error.stdout ?? ''}${error.stderr ?? ''}\n${error.message}\n`);
    throw error;
  }
}

function powershell(script, { env = process.env, ...options } = {}) {
  // The runner's PSModulePath names PowerShell 7's modules, which hides the Cert: drive from Windows PowerShell.
  const inherited = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
  // Every error stops the script, so reaching the end is success; without the explicit exit,
  // -Command reports a deliberately silenced miss (a value that isn't set) as a failure.
  return command('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ErrorActionPreference = 'Stop'\nImport-Module Microsoft.PowerShell.Security\n${script}\nexit 0`], { ...options, env: inherited });
}

// Where Windows reads whether it may download a missing root: the policy, then the machine setting.
const ROOT_AUTO_UPDATE = { policy: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\SystemCertificates\\AuthRoot', setting: 'HKLM:\\SOFTWARE\\Microsoft\\SystemCertificates\\AuthRoot' };

// Backs up each certificate to its store's folder before removing it. One already gone is skipped:
// removing a certificate from AuthRoot also removes it from the Root view.
const REMOVE_ROOTS = `
foreach ($entry in ($env:COWORK_ROOTS_TO_REMOVE | ConvertFrom-Json)) {
  $path = "Cert:\\LocalMachine\\$($entry.store)\\$($entry.thumbprint)"
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $cert = Get-Item -LiteralPath $path
  $folder = Join-Path $env:COWORK_ROOT_BACKUP $entry.store
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $folder "$($entry.thumbprint).cer"), $cert.RawData)
  Remove-Item -LiteralPath $path
  "LocalMachine\\$($entry.store) $($entry.thumbprint) $($cert.Subject)"
}`;

/** The certificates in each store this smoke reads, and whether Windows may download missing roots. */
async function rootStores(name) {
  const listing = JSON.parse(await powershell(`
$entries = foreach ($store in ${ROOT_STORES.map((store) => `'${store}'`).join(', ')}) {
  Get-ChildItem -LiteralPath "Cert:\\$store" | ForEach-Object { [pscustomobject]@{ store = $store; thumbprint = $_.Thumbprint; subject = $_.Subject } }
}
$policy = Get-ItemProperty -LiteralPath '${ROOT_AUTO_UPDATE.policy}' -ErrorAction SilentlyContinue
$setting = Get-ItemProperty -LiteralPath '${ROOT_AUTO_UPDATE.setting}' -ErrorAction SilentlyContinue
ConvertTo-Json -Compress -Depth 3 -InputObject @{ entries = @($entries); rootAutoUpdateOff = @{ policy = $policy.DisableRootAutoUpdate; setting = $setting.DisableRootAutoUpdate } }`));
  const counts = Object.fromEntries(ROOT_STORES.map((store) => [store, listing.entries.filter((entry) => entry.store === store).length]));
  const onDemand = listing.entries.filter((entry) => Object.hasOwn(ON_DEMAND_ROOTS, entry.thumbprint.toUpperCase()))
    .map((entry) => `${ON_DEMAND_ROOTS[entry.thumbprint.toUpperCase()]} in ${entry.store}`);
  save(name, { counts, onDemand, rootAutoUpdateOff: listing.rootAutoUpdateOff, entries: listing.entries });
  console.log(`${name}: ${JSON.stringify(counts)}; named roots: ${onDemand.join(', ') || 'none'}; root downloads off: ${JSON.stringify(listing.rootAutoUpdateOff)}`);
  return listing;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('Could not allocate a loopback port.');
  return address.port;
}

async function downloadManifest() {
  const snapshot = process.env.WINDOWS_SETUP_SNAPSHOT_URL;
  if (snapshot) {
    if (channel !== 'stable' || !/^[a-f0-9]{64}$/.test(process.env.WINDOWS_SETUP_SNAPSHOT_SHA256 ?? '')) {
      throw new Error('Historical snapshots require stable and an independently recorded SHA-256.');
    }
    return { version: packageIdentity(snapshot, channel, 'windows'), url: snapshot, sha256: process.env.WINDOWS_SETUP_SNAPSHOT_SHA256, historical: true };
  }
  const name = channel === 'stable' ? 'staging.json' : 'latest.json';
  const response = await fetch(`https://downloads.mindshub.ai/mindshub-cowork/windows/${name}`, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
  return validateManifest(await response.json(), channel, process.env.WINDOWS_SETUP_EXPECTED_URL, process.env.WINDOWS_SETUP_EXPECTED_VERSION, 'windows');
}

async function registrations() {
  const value = await powershell(`
$keys = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName
ConvertTo-Json -Compress -InputObject @($keys | ForEach-Object { [pscustomobject]@{ displayName = $_.DisplayName; installLocation = $_.InstallLocation; displayIcon = $_.DisplayIcon } })`);
  return value ? JSON.parse(value) : [];
}

async function run() {
  // Installing changes the runner's user profile and trimming changes its machine root stores.
  // Only disposable hosted runners run this command.
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('Run this smoke through Actions on a GitHub-hosted Windows runner.');
  }
  if (!['prod', 'stable'].includes(channel)) throw new Error('Select prod or stable.');
  const productName = channelIdentity(channel)?.productName ?? 'MindsHub Cowork';
  await rootStores('roots-runner.json');
  if ((await registrations()).some((entry) => entry.displayName?.startsWith(productName))) throw new Error('Runner already has this app installed.');
  const manifest = await downloadManifest();
  save('manifest.json', manifest);
  result.version = manifest.version;
  result.failingStep = 'Download package';
  const response = await fetch(manifest.url, { redirect: 'error', signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Package HTTP ${response.status}`);
  const installer = join(process.env.RUNNER_TEMP, `cowork-${channel}-setup.exe`);
  const hash = createHash('sha256');
  let bytes = 0;
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => { hash.update(chunk); bytes += chunk.length; });
  await pipeline(source, createWriteStream(installer, { flags: 'wx' }));
  if (hash.digest('hex') !== manifest.sha256 || (manifest.size_bytes && bytes !== manifest.size_bytes)) throw new Error('Downloaded package checksum/size differs from the manifest.');

  result.failingStep = 'Install package';
  const signature = JSON.parse(await powershell(`$s = Get-AuthenticodeSignature -LiteralPath $env:COWORK_INSTALLER
ConvertTo-Json -Compress -InputObject @{ status = [string]$s.Status; signer = $s.SignerCertificate.Subject }`, { env: { ...process.env, COWORK_INSTALLER: installer } }));
  save('signature.json', signature);
  if (signature.status !== 'Valid') throw new Error(`Installer signature is ${signature.status}.`);
  // The assisted NSIS installer installs for the current user, without a prompt, under /S.
  await command(installer, ['/S'], { timeout: 5 * 60_000 });
  const { installLocation, executable: executablePath } = installedExecutable(await registrations(), productName, join(process.env.LOCALAPPDATA, 'Programs'));
  save('install.json', { installLocation, executablePath, signer: signature.signer });
  // A launch by the installer would set up the runner's real profile, not the fresh one.
  const stopped = await powershell(`Get-Process | Where-Object { try { $_.Path -and $_.Path.StartsWith($env:COWORK_INSTALL_DIR, [StringComparison]::OrdinalIgnoreCase) } catch { $false } } | Stop-Process -Force -PassThru | ForEach-Object { "$($_.Id) $($_.Path)" }`,
    { env: { ...process.env, COWORK_INSTALL_DIR: installLocation } });
  if (stopped) save('stopped-after-install.txt', stopped);

  result.failingStep = 'Trim root store';
  // Last, so no earlier step that verifies through Windows (the signature check) downloads a root back.
  const before = await rootStores('roots-before-trim.json');
  writeFileSync(join(process.env.RUNNER_TEMP, ROOT_AUTO_UPDATE_BACKUP), JSON.stringify(before.rootAutoUpdateOff));
  trimmed = true;
  const removed = (await powershell(REMOVE_ROOTS, { env: {
    ...process.env, COWORK_ROOT_BACKUP: join(process.env.RUNNER_TEMP, ROOT_BACKUP),
    COWORK_ROOTS_TO_REMOVE: JSON.stringify(removalPlan(rootsToRemove(before.entries))),
  } })).split(/\r?\n/).filter(Boolean);
  save('roots-removed.txt', `${removed.join('\n')}\n`);
  console.log(`Removed ${removed.length} roots:\n${removed.join('\n')}`);
  // A fresh Windows downloads a missing root when a program verifies through Windows, as
  // setup's uv installer does; the image turns that off, which would fail Install uv instead.
  await powershell(Object.values(ROOT_AUTO_UPDATE).map((key) => `Remove-ItemProperty -LiteralPath '${key}' -Name DisableRootAutoUpdate -ErrorAction SilentlyContinue`).join('\n'));
  assertTrimmed(await rootStores('roots-trimmed.json'));

  result.failingStep = 'Launch and isolate app';
  profile = await mkdtemp(join(process.env.RUNNER_TEMP, 'cowork-profile-'));
  for (const folder of ['tmp', 'AppData/Roaming', 'AppData/Local']) await mkdir(join(profile, folder), { recursive: true });
  const port = await freePort();
  appEnvironment = isolatedEnvironment(profile, port, process.env);
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
  if (!isolation.packaged || await realpath(isolation.executable) !== await realpath(executablePath)) throw new Error('Not running the installed packaged executable.');
  // Electron resolves its home folder through Windows' known-folder API, not the
  // environment, so it stays the runner's; every path the app writes setup to must not.
  const { home: _home, ...appPaths } = isolation.paths;
  for (const path of [isolation.nodeHome, isolation.coworkHome, isolation.serverLog, ...Object.values(appPaths), isolation.toolDir, isolation.toolBinDir].filter(Boolean)) {
    if (!within(profile, path)) throw new Error(`App path escapes the fresh profile: ${path}`);
  }
  if (isolation.uv !== null) throw new Error(`Runner exposes preinstalled uv at ${isolation.uv}; cold bootstrap cannot be tested.`);
  serverLog = isolation.serverLog;
  toolDir = isolation.toolDir;
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
  const observerPath = join(profile, 'setup-observer.cjs');
  await copyFile(fileURLToPath(new URL('./windows-setup-observer.cjs', import.meta.url)), observerPath);
  const windowHandle = await app.browserWindow(page);
  await windowHandle.evaluate((window, filePath) => window.webContents.session.registerPreloadScript({ type: 'frame', filePath }), observerPath);
  // The observer is attached before boot chooses setup; SetupScreen alone starts it.
  await page.evaluate(() => localStorage.setItem('anton.termsConsent', 'true'));
  await page.reload({ timeout: 30_000 });
  await page.getByText('LOADING WORLD', { exact: true }).waitFor({ timeout: 30_000 });
  const deadline = Date.now() + 15 * 60_000;
  while (true) {
    if (page.isClosed()) throw new Error('App window closed during setup.');
    const current = await bounded(page.evaluate(() => window.__setupSmoke?.snapshot()), 10_000, 'App stopped answering during setup.');
    if (!current) throw new Error('App reloaded during setup.');
    Object.assign(setup, current);
    save('setup.log', setup.log);
    save('steps.json', setup.steps);
    result.failingStep = failureStep(setup);
    if (setup.startCalls > 1) throw new Error('Setup screen started installation more than once.');
    if (setup.returned !== null || setup.error || setup.cancelled) break;
    if (Date.now() > deadline) throw new Error(`${failureStep(setup)}: setup timed out after 15 minutes.`);
    await delay(500);
  }
  // Capture the terminal screen before its automatic transition to the workspace.
  if (setup.error || setup.cancelled) await page.getByRole('alert').waitFor({ timeout: 10_000 });
  else if (setup.done) await page.getByText('SETUP COMPLETE!', { exact: true }).waitFor({ timeout: 2_000 });
  await page.screenshot({ path: join(output, 'after.png'), timeout: 10_000 });
  terminalScreenshot = true;
  if (setup.startCalls !== 1) throw new Error('Expected the setup screen to start installation exactly once.');
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
    if (!terminalScreenshot) {
      try { await page.screenshot({ path: join(output, 'after.png'), timeout: 10_000 }); } catch (error) { save('screenshot-error.txt', error.message); }
    }
    try { save('server-diagnostics.json', await bounded(page.evaluate(() => window.antontron.serverDiagnostics()), 10_000, 'Diagnostics timed out.')); } catch (error) { save('diagnostics-error.txt', error.message); }
  }
  if (serverLog && existsSync(serverLog)) {
    try { await copyFile(serverLog, join(output, 'server.log')); } catch (error) { save('server-log-error.txt', error.message); }
  }
  // Which roots setup's own Windows downloads (the uv installer) brought back.
  if (trimmed) {
    try { await rootStores('roots-after-setup.json'); } catch (error) { save('roots-after-setup-error.txt', error.message); }
  }
  const uv = profile && join(profile, '.local', 'bin', 'uv.exe');
  if (uv && existsSync(uv)) {
    try { save('uv-version.log', (await execute(uv, ['--version'], { env: appEnvironment, timeout: 15_000 })).stdout); } catch (error) { save('uv-version.log', error.message); }
    try {
      const diagnostic = await execute(uv, ['tool', 'list'], { env: { ...appEnvironment, ...(toolDir ? { UV_TOOL_DIR: toolDir } : {}) }, timeout: 15_000 });
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
  result.startCalls = setup.startCalls;
  save('result.json', result);
  const summary = [`### Windows setup: ${channel}`, `Version: ${result.version ?? 'unresolved'}`, ...setup.steps.map((step) => `- ${STEP_NAMES[step.id] ?? step.id}: ${step.status}`), result.passed ? 'Result: passed' : `Result: failed at ${result.failingStep}: ${result.error}`, `Elapsed: ${result.elapsedSeconds}s`].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

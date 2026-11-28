import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildKindOf, makeInspectableCopy, pinSettings, testProfile, ACCOUNTS_FOLDER, HOME_FOLDERS, PINNED_SETTINGS } from './inspectable-copy.mjs';
import { checkFuses, INSPECTABLE_FUSES, RELEASE_FUSES } from './release-fuses.mjs';

const require = createRequire(import.meta.url);
const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses');
const { SENTINEL } = require('@electron/fuses/dist/constants.js');

const ELECTRON_DEFAULTS = '10110001';
const fixtures = mkdtempSync(join(tmpdir(), 'cowork-inspectable-copy-'));
after(() => rmSync(fixtures, { recursive: true, force: true }));
const EXE = 'MindsHub Cowork (Staging).exe';

/* A Windows install folder whose executable holds a fuse wire @electron/fuses
   reads and writes, flipped to the release fuses unless `release` is false. */
async function installFolder({ release = true, kind = 'stable' } = {}) {
  const root = join(mkdtempSync(join(fixtures, 'install-')), 'anton');
  mkdirSync(join(root, 'resources'), { recursive: true });
  const executable = join(root, EXE);
  writeFileSync(executable, Buffer.concat([Buffer.from('code before'), Buffer.from(SENTINEL), Buffer.from([1, ELECTRON_DEFAULTS.length]), Buffer.from(ELECTRON_DEFAULTS), Buffer.from('code after')]));
  if (release) await flipFuses(executable, { version: FuseVersion.V1, ...RELEASE_FUSES });
  if (kind) writeFileSync(join(root, 'resources', 'build-config.json'), JSON.stringify({ buildKind: kind }));
  writeFileSync(join(root, 'resources', 'app.asar'), 'asar');
  return { root, executable };
}

const fresh = () => join(mkdtempSync(join(fixtures, 'out-')), 'app');

test('the copy differs from the release in the inspector fuse alone, and the installed app stays as shipped', async () => {
  const installed = await installFolder();
  const before = readFileSync(installed.executable);
  const folder = fresh();
  const copy = await makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'win32' });
  assert.equal(copy.root, join(folder, 'anton'));
  assert.equal(copy.executable, join(folder, 'anton', EXE));
  assert.deepEqual((await checkFuses(copy.executable, INSPECTABLE_FUSES)).mismatches, []);
  assert.deepEqual((await checkFuses(installed.executable, RELEASE_FUSES)).mismatches, []);
  assert.deepEqual(readFileSync(installed.executable), before);
  assert.equal(readFileSync(join(copy.root, 'resources', 'app.asar'), 'utf8'), 'asar');
  assert.equal(copy.fuses[EXE].EnableNodeCliInspectArguments, 'on');
});

test('a copy whose flip did not take is refused and removed, and the error carries its fuses', async () => {
  const installed = await installFolder();
  const folder = fresh();
  await assert.rejects(
    makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'win32', flip: async () => 1 }),
    (error) => {
      assert.match(error.message, /differs from the release in more than its inspector fuse: .*EnableNodeCliInspectArguments is off, expected on/);
      assert.equal(error.fuses[EXE].EnableNodeCliInspectArguments, 'off');
      return true;
    },
  );
  assert.deepEqual(readdirSync(folder), []);
});

test('a copy that already exists is refused before anything is written', async () => {
  const installed = await installFolder();
  const folder = fresh();
  mkdirSync(join(folder, 'anton', 'resources'), { recursive: true });
  await assert.rejects(makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'win32' }), /exists\. Delete it/);
  assert.deepEqual(readdirSync(join(folder, 'anton')), ['resources']);
});

test('an installed app whose fuses differ from this checkout\'s, inspector still off, is refused as a version skew', async () => {
  const installed = await installFolder();
  await flipFuses(installed.executable, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: true });
  const folder = fresh();
  await assert.rejects(
    makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'win32' }),
    /fuses differ from this checkout's release fuses: .*RunAsNode is on, expected off.*Check out the commit that built the app/,
  );
  assert.equal(existsSync(folder), false);
});

test('an installed app without the release fuses is refused before anything is written', async () => {
  const installed = await installFolder({ release: false });
  const folder = fresh();
  await assert.rejects(
    makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'win32' }),
    /does not carry the release fuses, so it needs no copy: .*EnableNodeCliInspectArguments is on, expected off/,
  );
  assert.equal(existsSync(folder), false);
});

test('a copy inside the installed app is refused, through a name starting with two dots or a symlink too', async () => {
  const installed = await installFolder();
  const shipped = readdirSync(installed.root).sort();
  const link = join(mkdtempSync(join(fixtures, 'link-')), 'installed');
  symlinkSync(installed.root, link, 'junction');
  for (const folder of [installed.root, join(installed.root, 'resources', 'copy'), join(installed.root, '..qa', 'app'), join(link, 'copy')]) {
    await assert.rejects(makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'win32' }), /must go outside the installed app/, folder);
  }
  assert.deepEqual(readdirSync(installed.root).sort(), shipped);
  assert.deepEqual(readdirSync(join(installed.root, 'resources')).sort(), ['app.asar', 'build-config.json']);
});

const swapCase = (text) => [...text].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
test('a copy inside the installed app is refused when the path differs only in case', { skip: !existsSync(swapCase(fixtures)) && 'the file system is case-sensitive' }, async () => {
  const installed = await installFolder();
  const folder = join(swapCase(installed.root), 'copy');
  await assert.rejects(makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'win32' }), /must go outside the installed app/);
  assert.deepEqual(readdirSync(installed.root).sort(), [EXE, 'resources']);
});

test('Linux is refused, since nothing checks an installed .deb copy', async () => {
  const installed = await installFolder();
  const folder = fresh();
  await assert.rejects(makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'linux' }), /macOS and Windows only, not linux/);
  assert.equal(existsSync(folder), false);
});

test('the command refuses Linux before it asks for an .exe', { skip: process.platform !== 'linux' && 'runs on Linux only' }, () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'inspectable-copy.mjs');
  const folder = fresh();
  const result = spawnSync(process.execPath, [script, '/opt/MindsHub Cowork/mindshub-cowork', folder], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /macOS and Windows only, not linux/);
  assert.equal(existsSync(folder), false);
});

test('the build kind comes from build-config.json, and no file means prod', async () => {
  assert.equal(await buildKindOf((await installFolder({ kind: 'stable' })).root, 'win32'), 'stable');
  assert.equal(await buildKindOf((await installFolder({ kind: null })).root, 'win32'), 'prod');
  await assert.rejects(buildKindOf((await installFolder({ kind: 'nightly' })).root, 'win32'), /Unknown build kind/);
});

test('the test profile points every home and temp folder into it and pins the build under test', async () => {
  const profile = join(mkdtempSync(join(fixtures, 'profile-')), 'profile');
  const mac = await testProfile(profile, 'stable', 'darwin');
  assert.deepEqual(mac.env, { HOME: profile, CFFIXED_USER_HOME: profile, TMPDIR: join(profile, 'tmp'), COWORK_BUILD_KIND: 'stable' });
  assert.deepEqual(mac.args, [`--user-data-dir=${join(profile, 'chromium')}`]);
  assert.equal(readFileSync(join(profile, '.cowork-stable', '.env'), 'utf8'), 'SHELL_AUTO_UPDATE_ENABLED=false\nUI_UPDATE_MODE=manual\n');

  const { COWORK_BUILD_KIND, ...windows } = (await testProfile(profile, 'prod', 'win32')).env;
  assert.equal(COWORK_BUILD_KIND, 'prod');
  assert.deepEqual(Object.keys(windows).sort(), ['APPDATA', 'HOME', 'LOCALAPPDATA', 'TEMP', 'TMP', 'USERPROFILE']);
  for (const value of Object.values(windows)) assert.ok(value.startsWith(profile), value);
  assert.ok(existsSync(join(profile, '.cowork', '.env')));
});

test('every account the profile holds gets the pinned settings, since the app reads .env from the signed-in account\'s root', async () => {
  const profile = join(mkdtempSync(join(fixtures, 'profile-')), 'profile');
  const accounts = join(profile, '.cowork-stable', ACCOUNTS_FOLDER);
  mkdirSync(join(accounts, 'second'), { recursive: true });
  mkdirSync(join(accounts, 'third'), { recursive: true });
  writeFileSync(join(accounts, 'second', '.env'), 'DEV_MODE=live\nUI_UPDATE_MODE=auto\n');
  await testProfile(profile, 'stable', 'darwin');
  assert.equal(readFileSync(join(profile, '.cowork-stable', '.env'), 'utf8'), pinSettings(''));
  assert.equal(readFileSync(join(accounts, 'second', '.env'), 'utf8'), 'DEV_MODE=live\nSHELL_AUTO_UPDATE_ENABLED=false\nUI_UPDATE_MODE=manual\n');
  assert.equal(readFileSync(join(accounts, 'third', '.env'), 'utf8'), pinSettings(''));
});

test('a kept profile keeps its other settings and gets the pinned ones once', () => {
  assert.equal(pinSettings('DEV_MODE=live\nUI_UPDATE_MODE=auto\n\nSHELL_AUTO_UPDATE_ENABLED=true\n'), 'DEV_MODE=live\nSHELL_AUTO_UPDATE_ENABLED=false\nUI_UPDATE_MODE=manual\n');
  assert.equal(pinSettings(pinSettings('')), pinSettings(''));
  assert.deepEqual(Object.keys(PINNED_SETTINGS), ['SHELL_AUTO_UPDATE_ENABLED', 'UI_UPDATE_MODE']);
});

test('each data home matches the one the app uses for its build kind', () => {
  const channels = readFileSync(new URL('../src/main/channels.ts', import.meta.url), 'utf8');
  const homes = Object.fromEntries([...channels.matchAll(/kind: '(\w+)', homeDirName: '([^']+)'/g)].map(([, kind, home]) => [kind, home]));
  assert.deepEqual(homes, { ...HOME_FOLDERS });
});

test('the accounts folder matches the one the app keeps each later account\'s data root in', () => {
  const accountData = readFileSync(new URL('../src/main/account-data.ts', import.meta.url), 'utf8');
  assert.equal(accountData.match(/export const ACCOUNTS_DIR = '([^']+)'/)?.[1], ACCOUNTS_FOLDER);
});

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildKindOf, makeInspectableCopy, pinSettings, testProfile, HOME_FOLDERS, PINNED_SETTINGS } from './inspectable-copy.mjs';
import { checkFuses, INSPECTABLE_FUSES, RELEASE_FUSES } from './release-fuses.mjs';

const require = createRequire(import.meta.url);
const { flipFuses, FuseVersion } = require('@electron/fuses');
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

test('a copy whose flip did not take is refused, not handed to the tester', async () => {
  const installed = await installFolder();
  await assert.rejects(
    makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder: fresh(), platform: 'win32', flip: async () => 1 }),
    /differs from the release in more than its inspector fuse: .*EnableNodeCliInspectArguments is off, expected on/,
  );
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

test('a copy inside the installed app is refused', async () => {
  const installed = await installFolder();
  for (const folder of [installed.root, join(installed.root, 'resources', 'copy')]) {
    await assert.rejects(makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'win32' }), /must go outside the installed app/, folder);
  }
  assert.deepEqual(readdirSync(join(installed.root, 'resources')).sort(), ['app.asar', 'build-config.json']);
});

test('Linux is refused, since nothing checks an installed .deb copy', async () => {
  const installed = await installFolder();
  const folder = fresh();
  await assert.rejects(makeInspectableCopy({ installed: installed.root, executable: installed.executable, folder, platform: 'linux' }), /macOS and Windows only, not linux/);
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
  assert.deepEqual(mac.env, { HOME: profile, CFFIXED_USER_HOME: profile, TMPDIR: join(profile, 'tmp') });
  assert.deepEqual(mac.args, [`--user-data-dir=${join(profile, 'chromium')}`]);
  assert.equal(readFileSync(join(profile, '.cowork-stable', '.env'), 'utf8'), 'SHELL_AUTO_UPDATE_ENABLED=false\nUI_UPDATE_MODE=manual\n');

  const windows = await testProfile(profile, 'prod', 'win32');
  assert.deepEqual(Object.keys(windows.env).sort(), ['APPDATA', 'HOME', 'LOCALAPPDATA', 'TEMP', 'TMP', 'USERPROFILE']);
  for (const value of Object.values(windows.env)) assert.ok(value.startsWith(profile), value);
  assert.ok(existsSync(join(profile, '.cowork', '.env')));
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

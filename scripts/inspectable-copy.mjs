/* Makes a copy of an installed release app that test automation can drive.
 *
 * A release build refuses --remote-debugging-port and its kin at start, and its
 * inspector fuse keeps Node's inspector off, so Playwright's `_electron.launch`
 * (which waits for the inspector) cannot start it. The launch guard lets a run
 * through only while the inspector is on, and only a copy with that fuse turned
 * back on gets there. This script makes that copy, the same way the macOS and
 * Windows setup smokes do, and leaves the installed app as shipped.
 *
 * On macOS the flip breaks the Developer ID signature, so the copy is signed
 * again ad hoc, without the hardened runtime: the runtime's library validation
 * refuses a framework no team signed. ditto leaves out extended attributes,
 * since codesign refuses Finder info and resource forks, and a quarantine flag
 * would send the ad hoc copy to Gatekeeper. On Windows the flip breaks the
 * copy's Authenticode signature, which Windows does not check when it starts a
 * program that carries no mark of the web.
 *
 *   node scripts/inspectable-copy.mjs <installed app> <folder>
 *
 * <installed app> is the .app bundle on macOS and the app's .exe on Windows. The
 * copy goes into <folder>/app, which must not exist yet. A test profile goes into
 * <folder>/profile and is kept across runs, so a signed-in test account survives
 * a fresh copy. The script prints the copy's executable, its build kind, and the
 * environment and arguments that run it in that profile. */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inspectableCopy, within } from './macos-setup-contract.mjs';
import { checkFuses, enableInspector, INSPECTABLE_FUSES, RELEASE_FUSES } from './release-fuses.mjs';

const run = promisify(execFile);
const TIMEOUT = 5 * 60_000;

/* The data home each build kind keeps under the user's home folder, as
   CHANNELS[kind].homeDirName in src/main/channels.ts names it. The contract
   test pins the two together. */
export const HOME_FOLDERS = Object.freeze({ dev: '.cowork-dev', preview: '.cowork-preview', stable: '.cowork-stable', prod: '.cowork' });

/* Settings the app reads from its data home's .env (src/main/app.ts). Shell
   auto-update would replace the build under test partway through a run, and a
   UI update would change the page it drives. */
export const PINNED_SETTINGS = Object.freeze({ SHELL_AUTO_UPDATE_ENABLED: 'false', UI_UPDATE_MODE: 'manual' });

/* The folder in a data home that holds the data root of every account after
   the first, as ACCOUNTS_DIR in src/main/account-data.ts names it. The contract
   test pins the two together. */
export const ACCOUNTS_FOLDER = 'accounts';

/**
 * @typedef {object} InspectableCopy
 * @property {string} root The copy's .app bundle on macOS, its install folder on Windows.
 * @property {string} executable The copy's executable.
 * @property {Record<string, Record<string, string>>} fuses The copy's fuse states, by slice.
 */

/**
 * @typedef {object} LaunchValues What `_electron.launch` adds to run the copy in its test profile.
 * @property {Record<string, string>} env
 * @property {string[]} args
 */

/* `folder` as the file system names it: symlinks resolved and each existing
   folder in its case on disk, through the nearest folder that exists, with the
   rest of the path appended as given. fs/promises realpath returns the case on
   disk, and realpathSync does not. */
async function onDisk(folder) {
  const rest = [];
  let existing = path.resolve(folder);
  while (!existsSync(existing)) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(await realpath(existing), ...rest);
}

const INSPECTOR = 'EnableNodeCliInspectArguments';

/* Nothing checks a copy of the installed Linux .deb, so the script makes none. */
function refuseOtherPlatforms(platform) {
  if (platform !== 'darwin' && platform !== 'win32') throw new Error(`An inspectable copy is made on macOS and Windows only, not ${platform}.`);
}

/* What checkFuses reads: the bundle on macOS, where the fuses live in its
   framework, and the executable on Windows. */
const fuseTarget = (copy, platform) => (platform === 'darwin' ? copy.root : copy.executable);

/**
 * Copies `installed` (the .app bundle on macOS, the install folder on Windows)
 * into `folder`, turns the inspector fuse on in the copy alone, and checks both:
 * the installed app must carry the release fuses, and the copy must differ from
 * them in the inspector fuse alone. A failure after the copy starts removes it,
 * and a failed copy check carries the copy's fuse states as `error.fuses`.
 * @returns {Promise<InspectableCopy>}
 */
export async function makeInspectableCopy({ installed, executable, folder, platform = process.platform, exec = run, flip = enableInspector }) {
  refuseOtherPlatforms(platform);
  if (within(await realpath(installed), await onDisk(folder))) throw new Error(`The copy must go outside the installed app: ${folder}`);
  const copy = inspectableCopy(installed, executable, folder);
  if (existsSync(copy.root)) throw new Error(`${copy.root} exists. Delete it to make a fresh copy.`);

  const shipped = await checkFuses(fuseTarget({ root: installed, executable }, platform), RELEASE_FUSES);
  if (shipped.mismatches.length) {
    const inspectable = Object.values(shipped.states).every((states) => states[INSPECTOR] === 'on');
    throw new Error(inspectable
      ? `The installed app does not carry the release fuses, so it needs no copy: ${shipped.mismatches.join('; ')}.`
      : `The installed app's fuses differ from this checkout's release fuses: ${shipped.mismatches.join('; ')}. Check out the commit that built the app and run this again.`);
  }

  await mkdir(folder, { recursive: true });
  try {
    if (platform === 'darwin') {
      await exec('/usr/bin/ditto', ['--noextattr', installed, copy.root], { timeout: TIMEOUT });
    } else {
      await cp(installed, copy.root, { recursive: true, errorOnExist: true, force: false });
    }
    await flip(fuseTarget(copy, platform));
    if (platform === 'darwin') {
      await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', copy.root], { timeout: TIMEOUT });
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', copy.root], { timeout: TIMEOUT });
    }
    const copied = await checkFuses(fuseTarget(copy, platform), INSPECTABLE_FUSES);
    if (copied.mismatches.length) {
      throw Object.assign(new Error(`The copy differs from the release in more than its inspector fuse: ${copied.mismatches.join('; ')}.`), { fuses: copied.states });
    }
    return { ...copy, fuses: copied.states };
  } catch (error) {
    // copy.root did not exist before this run, so everything in it is this run's.
    await rm(copy.root, { recursive: true, force: true });
    throw error;
  }
}

/* The build kind the copy runs as, from the build-config.json packed beside
   app.asar. No file means a release from before build kinds, which is prod. */
export async function buildKindOf(root, platform = process.platform) {
  const resources = platform === 'darwin' ? path.join(root, 'Contents', 'Resources') : path.join(root, 'resources');
  let raw;
  try {
    raw = await readFile(path.join(resources, 'build-config.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return 'prod';
    throw error;
  }
  const kind = JSON.parse(raw).buildKind;
  if (!Object.hasOwn(HOME_FOLDERS, kind)) throw new Error(`Unknown build kind in build-config.json: ${kind}`);
  return kind;
}

/* `.env` text with PINNED_SETTINGS set, keeping every other line as it was. */
export function pinSettings(text) {
  const kept = text.split('\n').filter((line) => line.trim() && !Object.hasOwn(PINNED_SETTINGS, line.split('=')[0].trim()));
  return [...kept, ...Object.entries(PINNED_SETTINGS).map(([key, value]) => `${key}=${value}`)].join('\n') + '\n';
}

/**
 * A test profile in `profile`: the variables that point the app's home, app-data
 * and temp folders into it and fix its build kind, the Chromium profile argument,
 * and PINNED_SETTINGS in the .env of every account root the kind's data home
 * holds. The app reads .env from the signed-in account's root, the data home for
 * the first account and a folder in ACCOUNTS_FOLDER for each one after it. An
 * existing profile is kept, so a signed-in account survives.
 * @returns {Promise<LaunchValues>}
 */
export async function testProfile(profile, kind, platform = process.platform) {
  const tmp = path.join(profile, 'tmp');
  const folders = platform === 'win32'
    ? { USERPROFILE: profile, HOME: profile, APPDATA: path.join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(profile, 'AppData', 'Local'), TEMP: tmp, TMP: tmp }
    : { HOME: profile, CFFIXED_USER_HOME: profile, TMPDIR: tmp };
  const home = path.join(profile, HOME_FOLDERS[kind]);
  for (const folder of [tmp, home, ...(platform === 'win32' ? [folders.APPDATA, folders.LOCALAPPDATA] : [])]) await mkdir(folder, { recursive: true });
  const accounts = path.join(home, ACCOUNTS_FOLDER);
  const roots = [home, ...(existsSync(accounts) ? (await readdir(accounts, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(accounts, entry.name)) : [])];
  for (const root of roots) {
    const settings = path.join(root, '.env');
    await writeFile(settings, pinSettings(existsSync(settings) ? await readFile(settings, 'utf8') : ''));
  }
  return { env: { ...folders, COWORK_BUILD_KIND: kind }, args: [`--user-data-dir=${path.join(profile, 'chromium')}`] };
}

async function main([installed, folder]) {
  if (!installed || !folder) throw new Error('Usage: node scripts/inspectable-copy.mjs <installed app> <folder>');
  const platform = process.platform;
  refuseOtherPlatforms(platform);
  installed = path.resolve(installed);
  folder = path.resolve(folder);
  let root;
  let executable;
  if (platform === 'darwin') {
    if (!installed.endsWith('.app')) throw new Error(`Pass the installed .app bundle: ${installed}`);
    const { stdout } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(installed, 'Contents', 'Info.plist')]);
    const name = stdout.trim();
    if (!name || name.includes('/')) throw new Error('The bundle names no executable.');
    [root, executable] = [installed, path.join(installed, 'Contents', 'MacOS', name)];
  } else {
    if (!installed.toLowerCase().endsWith('.exe')) throw new Error(`Pass the installed app's .exe: ${installed}`);
    [root, executable] = [path.dirname(installed), installed];
  }
  const app = path.join(folder, 'app');
  if (existsSync(app)) throw new Error(`${app} exists. Delete it to make a fresh copy; the profile beside it stays.`);
  const kind = await buildKindOf(root, platform);
  const copy = await makeInspectableCopy({ installed: root, executable, folder: app, platform });
  const profile = await testProfile(path.join(folder, 'profile'), kind, platform);
  console.log(JSON.stringify({ executable: copy.executable, kind, ...profile }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`inspectable-copy: ${error.message}`);
    process.exit(1);
  });
}

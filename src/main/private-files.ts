import { diagnostic } from '../shared/diagnostics';
/* Owner-only folders for everything Cowork keeps on disk.
 *
 * Another account on the computer cannot list or open anything below a folder
 * whose mode is 0700. Cowork therefore pins every folder it owns to 0700: each
 * data home, each account root, and each repository's `.claude-mindshub`. New
 * files inside need no mode of their own. Installs from before the pin carry
 * 0755 folders and 0644 files, so each home also gets one pass that strips the
 * group and other bits from every entry.
 *
 * There is no process umask on purpose: it would also change the modes of the
 * files Cowork's tools write in the user's own repositories.
 *
 * Windows: chmod there only toggles the read-only flag, and the profile's
 * access list already admits only the user, SYSTEM and Administrators, so the
 * pin and the pass do nothing on win32. A folder Cowork creates inside a
 * repository can sit outside the profile, so it gets an owner-only access list
 * instead (`restrictToOwnerOnWindows`). */
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ACCOUNTS_DIR, ORGS_DIR } from './account-data';
import { retryOnTransientLock } from './fs-retry';

const LOGGER = 'main.private-files';
const PRIVATE_DIR_MODE = 0o700;
const GROUP_AND_OTHER = 0o077;
const PERMISSION_BITS = 0o777;
const MODE_BITS = 0o7777;

/** The platform the chmod decisions follow. A parameter so tests can run the
 *  Linux and the Windows behavior on any machine. */
export interface PlatformOption {
  platform?: NodeJS.Platform;
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('[private-files] this platform reports no user id');
  return uid;
}

/* Read at call time rather than at import, so a test that replaces fs with a
 * partial mock can still import the modules that use this one. */
function openNoFollowFlags(extra: number): number {
  return fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | extra;
}

const stripGroupAndOther = (mode: number) => mode & MODE_BITS & ~GROUP_AND_OTHER;

/* Open `entry` without following a link, and set its mode from what the
 * descriptor shows, when this user owns it. Working on the descriptor means a
 * name swapped for a link is refused (ELOOP) rather than followed. `wanted`
 * returns null to leave an entry as it is. Returns false for an entry another
 * account owns. */
function chmodOwnEntry(entry: string, flags: number, wanted: (seen: fs.Stats) => number | null): boolean {
  const fd = fs.openSync(entry, openNoFollowFlags(flags));
  try {
    const seen = fs.fstatSync(fd);
    if (seen.uid !== currentUid()) return false;
    const mode = wanted(seen);
    if (mode !== null && mode !== (seen.mode & MODE_BITS)) fs.fchmodSync(fd, mode);
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Create `dir` at 0700, or set an existing folder to 0700.
 *
 * mkdir's mode is masked by the umask and ignored for a folder that is already
 * there, which is why this sets the mode on the folder itself. When `dir` is a
 * link, the folder it resolves to is pinned, and only when this user owns it:
 * a folder another account owns is left as it is, with a warning.
 *
 * Throws when the folder cannot be created or its mode cannot be set; callers
 * decide whether that blocks them.
 */
export function pinPrivateDir(dir: string, { platform = process.platform }: PlatformOption = {}): void {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (platform === 'win32') return;
  const owned = chmodOwnEntry(fs.realpathSync(dir), fs.constants.O_DIRECTORY, (seen) =>
    ((seen.mode & PERMISSION_BITS) === PRIVATE_DIR_MODE ? null : PRIVATE_DIR_MODE),
  );
  if (!owned) {
    diagnostic(LOGGER, 'WARNING', 'private_files_another_account_owns_the_folder_its_mode_is_unchanged', '[private-files] another account owns the folder; its mode is unchanged');
  }
}

/** Set a file Cowork just wrote, such as a copied dotenv, to 0600. Node
 *  applies a write's `mode` only when it creates the file. */
export function pinPrivateFile(file: string, { platform = process.platform }: PlatformOption = {}): void {
  if (platform === 'win32') return;
  fs.chmodSync(file, 0o600);
}

/**
 * Strip the group and other bits from the legacy `~/.anton` folder and its
 * `.env`, under the pass's rules: never through a link, and only what this
 * user owns. Runs before the migration copies that `.env`, so a copy of a 0644
 * file never starts out readable by others. Nothing on Windows.
 */
export function tightenLegacyHome(legacyHome: string, { platform = process.platform }: PlatformOption = {}): void {
  if (platform === 'win32') return;
  const tighten = (entry: string, flags: number, isRightType: (seen: fs.Stats) => boolean): boolean => {
    try {
      return chmodOwnEntry(entry, flags, (seen) => (isRightType(seen) ? stripGroupAndOther(seen.mode) : null));
    } catch (err) {
      // Absent, a link (ELOOP), or not a folder (ENOTDIR): nothing to tighten.
      if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(errorCode(err) ?? '')) return false;
      throw err;
    }
  };
  if (!tighten(legacyHome, fs.constants.O_DIRECTORY, (seen) => seen.isDirectory())) return;
  tighten(path.join(legacyHome, '.env'), 0, (seen) => seen.isFile());
}

/** The file a home carries once every entry in it has lost its group and other
 *  bits. Written only after a complete pass, so a pass that failed anywhere
 *  runs again at the next launch. */
export const PRIVATE_MODES_MARKER = '.private-modes';

/* Code mode compares the modes of its copies with the user's repository, so
 * the pass pins this folder and never enters it. It sits directly under each
 * store root: the home, an account root, or an organization root. */
const CODING_DIR = 'coding';

type FolderRole = 'store-root' | 'store-container' | 'plain';

function childRole(parent: FolderRole, name: string): FolderRole {
  if (parent === 'store-root' && (name === ACCOUNTS_DIR || name === ORGS_DIR)) return 'store-container';
  if (parent === 'store-container') return 'store-root';
  return 'plain';
}

/* Set the mode of an entry the pass has just lstat'ed. A file or folder is
 * changed through a descriptor opened with O_NOFOLLOW, after checking that it
 * is still the inode lstat saw, so an entry swapped for a link in between is
 * refused rather than followed. A socket, a FIFO or a device cannot be opened
 * safely, and an entry without its owner's read bit cannot be opened at all;
 * those take a path chmod. Their folder belongs to this user and has already
 * lost its group and other bits, so no other account can swap them. */
async function chmodSeenEntry(entry: string, seen: fs.Stats, mode: number): Promise<void> {
  if (seen.isFile() || seen.isDirectory()) {
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(entry, openNoFollowFlags(seen.isDirectory() ? fs.constants.O_DIRECTORY : 0));
    } catch (err) {
      if (errorCode(err) !== 'EACCES') throw err;
    }
    if (handle) {
      try {
        const opened = await handle.stat();
        if (opened.dev !== seen.dev || opened.ino !== seen.ino) {
          throw new Error('[private-files] an entry changed while its mode was being set');
        }
        await handle.chmod(mode);
      } finally {
        await handle.close();
      }
      return;
    }
  }
  await fs.promises.chmod(entry, mode);
}

export type HomeTightening =
  | { kind: 'tightened'; changed: number }
  | { kind: 'already-tightened' }
  | { kind: 'skipped'; reason: 'windows' | 'another-owner' }
  | { kind: 'incomplete'; changed: number; failures: number };

/**
 * Strip the group and other bits from every entry under `home`, once.
 *
 * Files end 0600, executables and folders 0700, and the owner's own bits never
 * change. The pass reads each entry with lstat and never follows a link, so a
 * link's target outside the home keeps its mode. It stays on the home's
 * device, and it skips, without entering, anything another account owns. A
 * file hard-linked from elsewhere is one inode, so tightening it here tightens
 * it there too. `coding/` is pinned to 0700 and not entered.
 *
 * Folders are tightened before their contents are read, so no other account
 * can swap an entry below a folder the pass has reached. The pass does not
 * touch `home` itself: `pinPrivateDir` owns that.
 *
 * Asynchronous because it is slow: 3 to 6 s for 20,000 entries on macOS. The
 * pin, not this pass, is what keeps other accounts out, so the pass can run
 * after boot. It never rejects: a failure is logged and returned.
 */
export async function tightenHomeOnce(home: string, { platform = process.platform }: PlatformOption = {}): Promise<HomeTightening> {
  if (platform === 'win32') return { kind: 'skipped', reason: 'windows' };
  let changed = 0;
  let failures = 0;
  let firstFailure: unknown;
  const fail = (err: unknown) => {
    // An entry removed while the pass ran has nothing left to tighten.
    if (errorCode(err) === 'ENOENT') return;
    failures += 1;
    firstFailure ??= err;
  };
  const incomplete = (): HomeTightening => {
    diagnostic(LOGGER, 'WARNING', 'private_files_could_not_tighten_every_entry_in_a_home', '[private-files] could not tighten every entry in a home; the pass runs again next launch', { count: failures }, firstFailure);
    return { kind: 'incomplete', changed, failures };
  };

  let root: string;
  let rootStat: fs.Stats;
  try {
    root = await fs.promises.realpath(home);
    rootStat = await fs.promises.lstat(root);
  } catch (err) {
    failures = 1;
    firstFailure = err;
    return incomplete();
  }
  const uid = currentUid();
  if (rootStat.uid !== uid) return { kind: 'skipped', reason: 'another-owner' };
  const marker = path.join(root, PRIVATE_MODES_MARKER);
  if (await isFile(marker)) return { kind: 'already-tightened' };

  const folders: { dir: string; role: FolderRole }[] = [{ dir: root, role: 'store-root' }];
  while (folders.length) {
    const { dir, role } = folders.pop()!;
    let names: string[];
    try {
      names = await fs.promises.readdir(dir);
    } catch (err) {
      fail(err);
      continue;
    }
    for (const name of names) {
      const entry = path.join(dir, name);
      try {
        const seen = await fs.promises.lstat(entry);
        if (seen.isSymbolicLink() || seen.dev !== rootStat.dev || seen.uid !== uid) continue;
        const isCoding = role === 'store-root' && name === CODING_DIR && seen.isDirectory();
        const current = seen.mode & MODE_BITS;
        const wanted = isCoding ? PRIVATE_DIR_MODE : stripGroupAndOther(current);
        const needsChange = isCoding ? (current & PERMISSION_BITS) !== PRIVATE_DIR_MODE : wanted !== current;
        if (needsChange) {
          await chmodSeenEntry(entry, seen, wanted);
          changed += 1;
        }
        if (seen.isDirectory() && !isCoding) folders.push({ dir: entry, role: childRole(role, name) });
      } catch (err) {
        fail(err);
      }
    }
  }

  if (failures > 0) return incomplete();
  try {
    await fs.promises.writeFile(marker, `${JSON.stringify({ tightenedAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    // A second launch that finished the same pass first already wrote it.
    if (errorCode(err) !== 'EEXIST') {
      fail(err);
      return incomplete();
    }
  }
  return { kind: 'tightened', changed };
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.promises.lstat(file)).isFile();
  } catch {
    return false;
  }
}

/** The file inside a folder that says its access list is already owner-only. */
export const OWNER_ONLY_ACCESS_MARKER = '.owner-only-access';

/* The access list CPython gives a folder made with mode 0o700 on Windows:
 * full control for SYSTEM, Administrators and OWNER RIGHTS, and nothing
 * inherited from the parent. Every entry created below inherits it. */
const OWNER_ONLY_ICACLS_ARGS = [
  '/inheritance:r',
  '/grant:r',
  '*S-1-5-18:(OI)(CI)F',
  '*S-1-5-32-544:(OI)(CI)F',
  '*S-1-3-4:(OI)(CI)F',
];

/**
 * Give `dir` an owner-only access list on Windows, once.
 *
 * A folder Cowork creates inside a repository inherits the repository's access
 * list, and a repository outside the profile, such as `C:\src\app`, grants
 * every local account read access. The marker is written only after icacls
 * succeeds, so a failure retries the next time. A failure logs a warning and
 * never stops the caller. Nothing on other platforms.
 */
export function restrictToOwnerOnWindows(dir: string, { platform = process.platform }: PlatformOption = {}): void {
  if (platform !== 'win32') return;
  const marker = path.join(dir, OWNER_ONLY_ACCESS_MARKER);
  if (fs.existsSync(marker)) return;
  try {
    execFileSync('icacls', [dir, ...OWNER_ONLY_ICACLS_ARGS], { stdio: 'ignore', windowsHide: true });
    fs.writeFileSync(marker, '');
  } catch (err) {
    diagnostic(LOGGER, 'WARNING', 'private_files_could_not_restrict_a_folder_to_its_owner', '[private-files] could not restrict a folder to its owner', err);
  }
}

/* Durable `.env` write for Windows: at sign-in finalize this runs while the old
 * server still holds the file open, which EPERM'd onboarding. The fix is the
 * temp-write-then-atomic-rename with retry: the write lands on a fresh,
 * unlocked path and only the rename contends with the lock. Two things matter:
 *   1. Atomic: a torn or failed write must never truncate `.env`, which holds
 *      the user's OTHER credentials and consent flags.
 *   2. mode 0o600 on the temp: it holds the full plaintext key and lives at
 *      that mode through every retry and any crash, so it must be owner-only
 *      from creation. The rename keeps that mode, so the target ends 0600
 *      whatever mode the file it replaced had. `mode` is accepted on Windows
 *      (it just has limited POSIX semantics) and the temp is unlocked, so it
 *      can't reintroduce the EPERM this write class hit. */
export async function writeEnvFileAtomic(
  targetPath: string,
  content: string,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<void> {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  /* Sweep only STALE orphaned temps from a prior hard-kill / power-loss between
   * the write and the rename: they hold the full plaintext key, so they must
   * never linger. The age threshold is what lets this coexist with the random
   * suffix below: a concurrent writer's in-flight temp is fresh and spared, so
   * the sweep can't yank it out from under a live rename. */
  const STALE_TMP_MS = 5 * 60 * 1000;
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(`${base}.tmp-`)) continue;
      const p = path.join(dir, name);
      try {
        if (now - fs.statSync(p).mtimeMs > STALE_TMP_MS) fs.rmSync(p, { force: true });
      } catch { /* best-effort: gone already or unreadable */ }
    }
  } catch { /* dir unreadable: nothing to sweep */ }
  // Random suffix (not pid alone) so two writers can never collide on the name.
  const tmpPath = path.join(dir, `${base}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
  try {
    await retryOnTransientLock(() => fs.renameSync(tmpPath, targetPath), opts);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

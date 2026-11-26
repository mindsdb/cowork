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
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ACCOUNTS_DIR, ORGS_DIR } from './account-data';
import { retryOnTransientLock } from './fs-retry';

const LOGGER = 'main.private-files';
const PRIVATE_DIR_MODE = 0o700;
const GROUP_AND_OTHER = 0o077;
const GROUP_AND_OTHER_WRITE = 0o022;
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

const warnedModesNotKept = new Set<string>();

/* A filesystem that keeps no modes, such as WSL's /mnt/c, exFAT or an SMB
 * share, or a volume with no access lists on Windows, leaves the folder as it
 * is. No mode protects a folder there, and refusing it would stop the user
 * without stopping any reader. Warned once per folder. */
function warnModesNotKept(entry: string, reason: string): void {
  if (warnedModesNotKept.has(entry)) return;
  warnedModesNotKept.add(entry);
  diagnostic(LOGGER, 'WARNING', 'private_files_the_filesystem_keeps_no_private_permissions', `[private-files] the filesystem keeps no private permissions (${reason}); the folder is used as it is`);
}

/* Open `entry` without following a link, and set its mode from what the
 * descriptor shows, when this user owns it. Working on the descriptor means a
 * name swapped for a link is refused (ELOOP) rather than followed. `wanted`
 * returns null to leave an entry as it is. Returns false for an entry another
 * account owns. A mode the filesystem refuses or doesn't keep is a warning. */
function chmodOwnEntry(entry: string, flags: number, wanted: (seen: fs.Stats) => number | null): boolean {
  const fd = fs.openSync(entry, openNoFollowFlags(flags));
  try {
    const seen = fs.fstatSync(fd);
    if (seen.uid !== currentUid()) return false;
    const mode = wanted(seen);
    if (mode !== null && mode !== (seen.mode & MODE_BITS)) {
      try {
        fs.fchmodSync(fd, mode);
      } catch (err) {
        warnModesNotKept(entry, errorCode(err) ?? 'unknown');
        return true;
      }
      if ((fs.fstatSync(fd).mode & MODE_BITS) !== mode) warnModesNotKept(entry, 'mode_not_kept');
    }
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

/** Pin a home, including a home intentionally relocated by a link. Project
 * directories use the no-follow leaf policy instead. */
export function pinPrivateDir(
  dir: string,
  { platform = process.platform, allowHomeLink = true }: PlatformOption & { allowHomeLink?: boolean } = {},
): void {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (platform === 'win32') {
    if (!allowHomeLink && !fs.lstatSync(dir).isDirectory()) throw new Error('Expected a real project directory');
    return;
  }
  const target = allowHomeLink ? fs.realpathSync(dir) : dir;
  if (!chmodOwnEntry(target, fs.constants.O_DIRECTORY, () => PRIVATE_DIR_MODE)) {
    throw new Error('Another account owns the directory');
  }
}

/* Node has no openat. Keep the directory descriptor open while resolving its
 * children through procfs (Linux) or the volume's file ID (Darwin QA1113).
 * A volume that cannot resolve its file IDs fails this pass and gets retried. */
function openDirectoryPath(fd: number): string {
  if (process.platform === 'linux') return `/proc/self/fd/${fd}`;
  const stat = fs.fstatSync(fd, { bigint: true });
  const dir = `/.vol/${stat.dev}/${stat.ino}`;
  const named = fs.statSync(dir, { bigint: true });
  if (named.dev !== stat.dev || named.ino !== stat.ino) throw new Error('The open directory changed identity');
  return dir;
}

function mkdirIfMissing(dir: string): void {
  try {
    fs.mkdirSync(dir, { mode: PRIVATE_DIR_MODE });
  } catch (err) {
    if (errorCode(err) !== 'EEXIST') throw err;
  }
}

/* Both the boot scan and the active-account writer must validate the container.
 * A directory entry under a linked or mounted accounts container can look like
 * a normal account folder while referring to an unrelated volume or tree. */
function withAccountContainer(home: string, create: boolean, visit: (dir: string, device: number) => void): void {
  const root = fs.openSync(fs.realpathSync(home), openNoFollowFlags(fs.constants.O_DIRECTORY));
  try {
    const homeStat = fs.fstatSync(root);
    if (homeStat.uid !== currentUid()) throw new Error('Another account owns the home');
    const container = path.join(openDirectoryPath(root), ACCOUNTS_DIR);
    if (create) mkdirIfMissing(container);
    let accounts: number;
    try {
      accounts = fs.openSync(container, openNoFollowFlags(fs.constants.O_DIRECTORY));
    } catch (err) {
      if (!create && errorCode(err) === 'ENOENT') return;
      throw err;
    }
    try {
      const seen = fs.fstatSync(accounts);
      if (seen.dev !== homeStat.dev || seen.uid !== homeStat.uid) throw new Error('Unexpected accounts directory');
      visit(openDirectoryPath(accounts), seen.dev);
    } finally {
      fs.closeSync(accounts);
    }
  } finally {
    fs.closeSync(root);
  }
}

function pinAccountRoot(dir: string, device: number): void {
  const owned = chmodOwnEntry(dir, fs.constants.O_DIRECTORY, (seen) => {
    if (seen.dev !== device) throw new Error('Account root is on another device');
    return PRIVATE_DIR_MODE;
  });
  if (!owned) throw new Error('Another account owns the account root');
}

export function pinAccountRoots(home: string, { platform = process.platform }: PlatformOption = {}): void {
  if (platform === 'win32') return;
  withAccountContainer(home, false, (dir, device) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        pinAccountRoot(path.join(dir, entry.name), device);
      } catch (err) {
        diagnostic(LOGGER, 'WARNING', 'private_files_could_not_pin_account_root', '[private-files] could not pin an account root', err);
      }
    }
  });
}

export function createPrivateAccountRoot(home: string, name: string): void {
  if (process.platform === 'win32') {
    const accounts = path.join(home, ACCOUNTS_DIR);
    mkdirIfMissing(accounts);
    if (!fs.lstatSync(accounts).isDirectory()) throw new Error('Expected a real accounts directory');
    const root = path.join(accounts, name);
    mkdirIfMissing(root);
    if (!fs.lstatSync(root).isDirectory()) throw new Error('Expected a real account root');
    return;
  }
  withAccountContainer(home, true, (dir, device) => {
    const root = path.join(dir, name);
    mkdirIfMissing(root);
    pinAccountRoot(root, device);
  });
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

type FolderRole = 'store-root' | 'store-container' | 'projects' | 'project' | 'mindshub' | 'plain';

function childRole(parent: FolderRole, name: string): FolderRole {
  if (parent === 'store-root' && (name === ACCOUNTS_DIR || name === ORGS_DIR)) return 'store-container';
  if (parent === 'store-container') return 'store-root';
  if (parent === 'store-root' && name === 'projects') return 'projects';
  if (parent === 'projects') return 'project';
  if (parent === 'project' && name === '.claude-mindshub') return 'mindshub';
  return 'plain';
}

/* Set the mode of an entry the pass has just lstat'ed. A file or folder is
 * changed through a descriptor opened with O_NOFOLLOW, after checking that it
 * is still the inode lstat saw, so an entry swapped for a link in between is
 * refused rather than followed. A socket, a FIFO or a device cannot be opened
 * safely, and an entry without its owner's read bit cannot be opened at all;
 * those use a volume file ID on macOS or a metadata-only descriptor on Linux.
 *
 * Returns false, and changes nothing, when the name no longer holds the entry
 * lstat saw: a different inode, a link (ELOOP) or a file where a folder was
 * (ENOTDIR). The sidecar's own temp-and-rename writes do this while the pass
 * runs. The replacement was made inside a folder that is already private (the
 * pass tightens a folder before it reads it, and the boot pin covers the home),
 * so it needs no mode of its own, like any file created after the pass. */
async function chmodSeenEntry(entry: string, seen: fs.BigIntStats, mode: number): Promise<boolean> {
  if (seen.isFile() || seen.isDirectory()) {
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(entry, openNoFollowFlags(seen.isDirectory() ? fs.constants.O_DIRECTORY : 0));
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ELOOP' || code === 'ENOTDIR') return false;
      if (code !== 'EACCES') throw err;
    }
    if (handle) {
      try {
        const opened = await handle.stat({ bigint: true });
        if (opened.dev !== seen.dev || opened.ino !== seen.ino || opened.uid !== seen.uid) return false;
        await handle.chmod(mode);
      } finally {
        await handle.close();
      }
      return true;
    }
  }
  if (process.platform === 'darwin') {
    // Volume file IDs address the inode itself without opening a FIFO or device.
    await fs.promises.chmod(`/.vol/${seen.dev}/${seen.ino}`, mode);
    return true;
  }
  // Linux O_PATH opens special and unreadable entries without opening their
  // contents. Node does not expose the flag by name. Keep the inode alive and
  // change its permissions through the descriptor after checking its identity.
  const O_PATH = 0o10000000;
  const reference = await fs.promises.open(entry, O_PATH | fs.constants.O_NOFOLLOW);
  try {
    const opened = await reference.stat({ bigint: true });
    if (opened.dev !== seen.dev || opened.ino !== seen.ino || opened.uid !== seen.uid) return false;
    await fs.promises.chmod(`/proc/self/fd/${reference.fd}`, mode);
    return true;
  } finally {
    await reference.close();
  }
}

/* Linux's fs.protected_hardlinks, on by default on Ubuntu, Debian and Fedora,
 * stops an account from hard-linking a file it cannot also write. */
const PROTECTED_HARDLINKS_SETTING = '/proc/sys/fs/protected_hardlinks';

/* False wherever the setting cannot be read, as on macOS, which has no such
 * protection. False is the cautious answer: it makes the pass tighten every
 * hard-linked file. */
async function hardLinksAreProtected(): Promise<boolean> {
  try {
    return (await fs.promises.readFile(PROTECTED_HARDLINKS_SETTING, 'utf8')).trim() === '1';
  } catch {
    return false;
  }
}

/* A file with more than one name shares one inode, and so one mode, with a
 * name that can sit outside the home: on Linux uv, pnpm and bun hard-link
 * package files from their caches into every environment they install. Where
 * hard links are protected and the file grants no group or other write, no
 * other account can have made such a link, so the file is left as it is and
 * its other names keep their mode. Anywhere else another account may have
 * planted the link before the upgrade to keep reading the file, so the pass
 * tightens it like any other entry. */
function isOwnHardLink(seen: fs.BigIntStats, hardLinksProtected: boolean): boolean {
  return hardLinksProtected && seen.isFile() && seen.nlink > 1n && (Number(seen.mode) & GROUP_AND_OTHER_WRITE) === 0;
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
 * hard-linked file is one inode, so tightening it here tightens its other
 * names too; the pass does that unless the link can only be the user's own
 * (`isOwnHardLink`). `coding/` is pinned to 0700 and not entered.
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

  let rootHandle: fs.promises.FileHandle | undefined;
  try {
    const root = await fs.promises.realpath(home);
    rootHandle = await fs.promises.open(root, openNoFollowFlags(fs.constants.O_DIRECTORY));
    const rootStat = await rootHandle.stat({ bigint: true });
    const uid = BigInt(currentUid());
    if (rootStat.uid !== uid) return { kind: 'skipped', reason: 'another-owner' };
    const marker = path.join(openDirectoryPath(rootHandle.fd), PRIVATE_MODES_MARKER);
    if (await isFile(marker)) return { kind: 'already-tightened' };
    const hardLinksProtected = await hardLinksAreProtected();
    const folders: { dir: string; role: FolderRole; seen: fs.BigIntStats }[] = [{ dir: root, role: 'store-root', seen: rootStat }];

    while (folders.length) {
      const { dir, role, seen: expected } = folders.pop()!;
      let handle: fs.promises.FileHandle | undefined;
      try {
        handle = await fs.promises.open(dir, openNoFollowFlags(fs.constants.O_DIRECTORY));
        const opened = await handle.stat({ bigint: true });
        if (opened.dev !== expected.dev || opened.ino !== expected.ino || opened.uid !== uid) {
          throw new Error('A directory changed during its permission upgrade');
        }
        const anchor = openDirectoryPath(handle.fd);
        const names = await fs.promises.readdir(anchor);
        for (const name of names) {
          const entry = path.join(anchor, name);
          try {
            const seen = await fs.promises.lstat(entry, { bigint: true });
            if (seen.isSymbolicLink() || seen.dev !== rootStat.dev || seen.uid !== uid) continue;
            if (isOwnHardLink(seen, hardLinksProtected)) continue;
            const containsCheckouts = seen.isDirectory() && (
              (role === 'store-root' && name === CODING_DIR) || (role === 'mindshub' && name === 'tasks')
            );
            const current = Number(seen.mode) & MODE_BITS;
            const wanted = containsCheckouts ? PRIVATE_DIR_MODE : stripGroupAndOther(current);
            if (wanted !== current) {
              if (!(await chmodSeenEntry(entry, seen, wanted))) continue;
              changed += 1;
            }
            if (seen.isDirectory() && !containsCheckouts) {
              folders.push({ dir: path.join(dir, name), role: childRole(role, name), seen });
            }
          } catch (err) {
            fail(err);
          }
        }
      } catch (err) {
        fail(err);
      } finally {
        await handle?.close();
      }
    }

    if (failures > 0) return incomplete();
    try {
      await fs.promises.writeFile(marker, `${JSON.stringify({ tightenedAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: 'wx' });
    } catch (err) {
      if (errorCode(err) !== 'EEXIST' || !await isFile(marker)) throw err;
    }
    return { kind: 'tightened', changed };
  } catch (err) {
    failures += 1;
    firstFailure ??= err;
    return incomplete();
  } finally {
    await rootHandle?.close();
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.promises.lstat(file)).isFile();
  } catch {
    return false;
  }
}

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

/* FAT, FAT32 and exFAT store no access list, so icacls fails on them for
 * every folder. */
const FORMATS_WITHOUT_ACCESS_LISTS = new Set(['FAT', 'FAT32', 'EXFAT']);

/* The file system of the drive that holds `dir`, as Windows names it, or null
 * when it can't say. The folder travels in the environment, not the command. */
function driveFormat(dir: string): Promise<string | null> {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = '[IO.DriveInfo]::new([IO.Path]::GetPathRoot($env:COWORK_PRIVATE_DIR)).DriveFormat';
  return new Promise((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 15_000, env: { ...process.env, COWORK_PRIVATE_DIR: dir } },
      (err, stdout) => resolve(err ? null : String(stdout ?? '').trim() || null),
    );
  });
}

/** Apply the repository directory's policy on every use. Inheritance can be
 * restored on the same directory between tasks. icacls preserves unrelated
 * explicit administrator grants. Its asynchronous completion gates checkout.
 * A drive with no access lists is used as it is, with a warning. */
export async function restrictToOwnerOnWindows(dir: string, { platform = process.platform }: PlatformOption = {}): Promise<void> {
  if (platform !== 'win32') return;
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('icacls', [dir, ...OWNER_ONLY_ICACLS_ARGS, '/L'], { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    const format = await driveFormat(dir);
    if (format === null || !FORMATS_WITHOUT_ACCESS_LISTS.has(format.toUpperCase())) throw err;
    warnModesNotKept(dir, `volume_keeps_no_acls_${format}`);
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

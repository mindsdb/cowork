/* The folder pin, the one-time pass, the legacy-home tightening and the
 * Windows access list, on a real filesystem under a temp folder. Every case
 * runs the POSIX branch as 'linux' and the Windows branch as 'win32', on any
 * machine, because the platform is a parameter. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const diagnostics = vi.hoisted(() => ({ diagnostic: vi.fn() }));
vi.mock('../shared/diagnostics', () => diagnostics);

const execFile = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFile,
}));

/* Delegates to the real fs. A test can name an entry whose chmod through a
 * descriptor fails, the way an entry the user cannot change fails; entries
 * lstat reports as another account's or as on another device; an entry that
 * is replaced between the pass's lstat and its open, the way the sidecar's
 * temp-and-rename writes replace one; the Linux hard-link setting (null where
 * there is none, as on macOS); and renames that fail, the way a Windows lock
 * fails them. */
const control = vi.hoisted(() => ({
  failChmodFor: null as string | null,
  ownedByAnotherAccount: new Set<string>(),
  onAnotherDevice: new Set<string>(),
  lstatCalls: [] as string[],
  replaceBeforeOpen: null as { entry: string; by: 'file' | { linkTo: string } } | null,
  protectedHardlinks: null as string | null,
  renameFailCode: null as string | null,
  renameFailTimes: 0,
  lastWriteOpts: undefined as unknown,
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const open = async (...args: Parameters<typeof actual.promises.open>) => {
    const replace = control.replaceBeforeOpen;
    if (replace !== null && String(args[0]) === replace.entry) {
      control.replaceBeforeOpen = null;
      const replacement = `${replace.entry}.replacement`;
      if (replace.by === 'file') {
        actual.writeFileSync(replacement, 'replaced');
        actual.chmodSync(replacement, 0o644);
      } else {
        actual.symlinkSync(replace.by.linkTo, replacement);
      }
      actual.renameSync(replacement, replace.entry);
    }
    const handle = await actual.promises.open(...args);
    if (control.failChmodFor !== null && String(args[0]) === control.failChmodFor) {
      handle.chmod = async () => {
        throw Object.assign(new Error('EPERM: operation not permitted, fchmod'), { code: 'EPERM' });
      };
    }
    return handle;
  };
  const lstat = async (entry: string) => {
    control.lstatCalls.push(entry);
    const seen = await actual.promises.lstat(entry);
    if (control.ownedByAnotherAccount.has(entry)) seen.uid += 1;
    if (control.onAnotherDevice.has(entry)) seen.dev += 1;
    return seen;
  };
  const readFile = async (...args: Parameters<typeof actual.promises.readFile>) => {
    if (String(args[0]) !== '/proc/sys/fs/protected_hardlinks') return actual.promises.readFile(...args);
    if (control.protectedHardlinks === null) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    return control.protectedHardlinks;
  };
  const writeFileSync = (...args: Parameters<typeof actual.writeFileSync>) => {
    control.lastWriteOpts = args[2];
    return actual.writeFileSync(...args);
  };
  const renameSync = (...args: Parameters<typeof actual.renameSync>) => {
    if (control.renameFailTimes > 0) {
      control.renameFailTimes -= 1;
      throw Object.assign(new Error(`${control.renameFailCode}: forced by test`), { code: control.renameFailCode });
    }
    return actual.renameSync(...args);
  };
  const promises = { ...actual.promises, open, lstat, readFile };
  const mocked = { ...actual, promises, writeFileSync, renameSync };
  return { ...mocked, default: mocked };
});

import {
  OWNER_ONLY_ACCESS_MARKER,
  PRIVATE_MODES_MARKER,
  pinPrivateDir,
  restrictToOwnerOnWindows,
  tightenHomeOnce,
  tightenLegacyHome,
  writeEnvFileAtomic,
} from './private-files';

const LINUX = { platform: 'linux' as const };
const WINDOWS = { platform: 'win32' as const };

let root: string;
let home: string;

beforeEach(() => {
  diagnostics.diagnostic.mockClear();
  execFile.mockReset().mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => cb(null));
  Object.assign(control, {
    failChmodFor: null,
    ownedByAnotherAccount: new Set<string>(),
    onAnotherDevice: new Set<string>(),
    lstatCalls: [],
    replaceBeforeOpen: null,
    protectedHardlinks: null,
    renameFailCode: null,
    renameFailTimes: 0,
    lastWriteOpts: undefined,
  });
  // Real path: the pass resolves the home, and macOS's tmpdir sits behind /var.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-private-')));
  home = path.join(root, '.cowork-test');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const modeOf = (entry: string) => fs.lstatSync(entry).mode & 0o7777;

function write(entry: string, mode: number, content = 'x'): string {
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, content);
  fs.chmodSync(entry, mode);
  return entry;
}

function folder(entry: string, mode: number): string {
  fs.mkdirSync(entry, { recursive: true });
  fs.chmodSync(entry, mode);
  return entry;
}

const warnings = (event: string) =>
  diagnostics.diagnostic.mock.calls.filter(
    ([logger, level, name]) => logger === 'main.private-files' && level === 'WARNING' && name === event,
  );

describe('pinPrivateDir', () => {
  it.each([0o022, 0o002])('creates a fresh folder at 0700 under umask %o', (mask) => {
    const previous = process.umask(mask);
    try {
      pinPrivateDir(home, LINUX);
    } finally {
      process.umask(previous);
    }
    expect(modeOf(home)).toBe(0o700);
  });

  it('pins an existing 0755 folder', () => {
    folder(home, 0o755);
    pinPrivateDir(home, LINUX);
    expect(modeOf(home)).toBe(0o700);
  });

  it('pins the folder a link resolves to, and leaves the link itself', () => {
    const real = folder(path.join(root, 'real-home'), 0o755);
    fs.symlinkSync(real, home);

    pinPrivateDir(home, LINUX);

    expect(modeOf(real)).toBe(0o700);
    expect(fs.lstatSync(home).isSymbolicLink()).toBe(true);
  });

  it('leaves a folder another account owns as it is, with a warning', () => {
    const real = folder(path.join(root, 'someone-elses'), 0o755);
    fs.symlinkSync(real, home);
    vi.spyOn(process, 'getuid').mockReturnValue(fs.statSync(real).uid + 1);

    pinPrivateDir(home, LINUX);

    expect(modeOf(real)).toBe(0o755);
    expect(warnings('private_files_another_account_owns_the_folder_its_mode_is_unchanged')).toHaveLength(1);
  });

  it('only creates the folder on win32, where chmod would only toggle read-only', () => {
    folder(home, 0o755);
    const fresh = path.join(root, 'fresh');

    pinPrivateDir(home, WINDOWS);
    pinPrivateDir(fresh, WINDOWS);

    expect(modeOf(home)).toBe(0o755);
    expect(fs.statSync(fresh).isDirectory()).toBe(true);
  });
});

describe('tightenHomeOnce', () => {
  beforeEach(() => {
    folder(home, 0o700);
  });

  it('turns 644 into 600, 755 into 700 and 666 into 600, folders included', async () => {
    const db = write(path.join(home, 'cowork.db'), 0o644);
    const tool = write(path.join(home, 'uv', 'bin', 'cowork-server'), 0o755);
    const shared = write(path.join(home, 'files', 'a.txt'), 0o666);
    const projects = folder(path.join(home, 'projects'), 0o755);
    fs.chmodSync(path.join(home, 'uv'), 0o775);

    const result = await tightenHomeOnce(home, LINUX);

    expect(result).toEqual({ kind: 'tightened', changed: 7 });
    expect(modeOf(db)).toBe(0o600);
    expect(modeOf(tool)).toBe(0o700);
    expect(modeOf(shared)).toBe(0o600);
    expect(modeOf(projects)).toBe(0o700);
    expect(modeOf(path.join(home, 'uv'))).toBe(0o700);
    expect(modeOf(path.join(home, 'uv', 'bin'))).toBe(0o700);
    expect(modeOf(path.join(home, 'files'))).toBe(0o700);
  });

  it('never changes the owner bits', async () => {
    const readOnly = write(path.join(home, 'read-only'), 0o444);
    await tightenHomeOnce(home, LINUX);
    expect(modeOf(readOnly)).toBe(0o400);
  });

  it('does not follow a link: the target outside the home keeps its mode and ctime', async () => {
    const outsideDir = folder(path.join(root, 'outside'), 0o755);
    const outsideFile = write(path.join(outsideDir, 'notes.txt'), 0o644);
    fs.symlinkSync(outsideFile, path.join(home, 'link-to-file'));
    fs.symlinkSync(outsideDir, path.join(home, 'link-to-folder'));
    const before = [fs.statSync(outsideFile), fs.statSync(outsideDir)].map((s) => [s.mode, s.ctimeMs]);

    await tightenHomeOnce(home, LINUX);

    const after = [fs.statSync(outsideFile), fs.statSync(outsideDir)].map((s) => [s.mode, s.ctimeMs]);
    expect(after).toEqual(before);
  });

  function hardLink(outsideMode: number, inside: string): { outside: string; inside: string } {
    const outside = write(path.join(root, 'cache', path.basename(inside)), outsideMode);
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.linkSync(outside, inside);
    return { outside, inside };
  }

  it.each([
    ['there is no hard-link setting, as on macOS', null],
    ['Linux hard links are unprotected', '0'],
  ])('tightens a hard-linked file at both names when %s, so a link another account planted stops working', async (_case, setting) => {
    control.protectedHardlinks = setting;
    const db = hardLink(0o644, path.join(home, 'cowork.db'));

    expect(await tightenHomeOnce(home, LINUX)).toEqual({ kind: 'tightened', changed: 1 });

    expect(modeOf(db.inside)).toBe(0o600);
    expect(modeOf(db.outside)).toBe(0o600);
  });

  it('leaves a package file uv hard-linked from its cache where Linux protects hard links, so the cache keeps its mode', async () => {
    control.protectedHardlinks = '1\n';
    const sitePackages = path.join(home, 'uv', 'tools', 'cowork-server', 'lib', 'python3.13', 'site-packages');
    const pkg = hardLink(0o644, path.join(sitePackages, '__init__.py'));
    const db = write(path.join(home, 'cowork.db'), 0o644);

    expect(await tightenHomeOnce(home, LINUX)).toMatchObject({ kind: 'tightened' });

    expect(modeOf(pkg.outside)).toBe(0o644);
    expect(modeOf(pkg.inside)).toBe(0o644);
    expect(modeOf(sitePackages)).toBe(0o700);
    expect(modeOf(db)).toBe(0o600);
  });

  it('still tightens a hard-linked file that grants group or other write, which protected hard links let another account link', async () => {
    control.protectedHardlinks = '1';
    const shared = hardLink(0o666, path.join(home, 'files', 'shared.txt'));

    await tightenHomeOnce(home, LINUX);

    expect(modeOf(shared.inside)).toBe(0o600);
    expect(modeOf(shared.outside)).toBe(0o600);
  });

  it('pins coding/ under every store root and leaves the modes of the copies inside', async () => {
    const roots = [home, path.join(home, 'accounts', 'b'), path.join(home, 'accounts', 'b', 'orgs', 'o'), path.join(home, 'orgs', 'o')];
    const copies = roots.map((storeRoot) => {
      folder(path.join(storeRoot, 'coding'), 0o755);
      return {
        file: write(path.join(storeRoot, 'coding', 'task', 'repo', 'main.py'), 0o644),
        script: write(path.join(storeRoot, 'coding', 'task', 'repo', 'run.sh'), 0o755),
        dir: folder(path.join(storeRoot, 'coding', 'task', 'repo'), 0o755),
      };
    });

    await tightenHomeOnce(home, LINUX);

    for (const storeRoot of roots) expect(modeOf(path.join(storeRoot, 'coding'))).toBe(0o700);
    for (const copy of copies) {
      expect(modeOf(copy.file)).toBe(0o644);
      expect(modeOf(copy.script)).toBe(0o755);
      expect(modeOf(copy.dir)).toBe(0o755);
    }
  });

  it('enters a folder named coding that is not under a store root', async () => {
    const nested = write(path.join(home, 'projects', 'p', 'coding', 'notes.md'), 0o644);
    await tightenHomeOnce(home, LINUX);
    expect(modeOf(nested)).toBe(0o600);
  });

  it('writes a 0600 marker after a complete pass and does nothing on the next run', async () => {
    write(path.join(home, 'cowork.db'), 0o644);

    await tightenHomeOnce(home, LINUX);
    const loosened = write(path.join(home, 'later.json'), 0o644);
    const second = await tightenHomeOnce(home, LINUX);

    expect(modeOf(path.join(home, PRIVATE_MODES_MARKER))).toBe(0o600);
    expect(second).toEqual({ kind: 'already-tightened' });
    expect(modeOf(loosened)).toBe(0o644);
  });

  it('logs a warning and writes no marker when a chmod fails, then retries next launch', async () => {
    const stuck = write(path.join(home, 'stuck.db'), 0o644);
    const other = write(path.join(home, 'other.db'), 0o644);
    control.failChmodFor = stuck;

    const result = await tightenHomeOnce(home, LINUX);

    expect(result).toEqual({ kind: 'incomplete', changed: 1, failures: 1 });
    expect(modeOf(other)).toBe(0o600);
    expect(fs.existsSync(path.join(home, PRIVATE_MODES_MARKER))).toBe(false);
    expect(warnings('private_files_could_not_tighten_every_entry_in_a_home')).toHaveLength(1);

    control.failChmodFor = null;
    expect(await tightenHomeOnce(home, LINUX)).toEqual({ kind: 'tightened', changed: 1 });
    expect(modeOf(stuck)).toBe(0o600);
  });

  it('skips, without entering, what another account owns', async () => {
    const db = write(path.join(home, 'cowork.db'), 0o644);
    const uid = fs.statSync(db).uid;
    // Every entry now reads as another account's, the home included.
    vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);

    expect(await tightenHomeOnce(home, LINUX)).toEqual({ kind: 'skipped', reason: 'another-owner' });
    expect(modeOf(db)).toBe(0o644);
  });

  it('skips, without entering, a folder and a file inside the home that another account owns', async () => {
    const theirFolder = folder(path.join(home, 'projects', 'theirs'), 0o755);
    const belowTheirs = write(path.join(theirFolder, 'notes.md'), 0o644);
    const theirFile = write(path.join(home, 'projects', 'their.db'), 0o644);
    const mine = write(path.join(home, 'projects', 'mine.db'), 0o644);
    control.ownedByAnotherAccount = new Set([theirFolder, theirFile]);

    expect(await tightenHomeOnce(home, LINUX)).toMatchObject({ kind: 'tightened' });

    expect(modeOf(theirFolder)).toBe(0o755);
    expect(modeOf(theirFile)).toBe(0o644);
    expect(modeOf(belowTheirs)).toBe(0o644);
    expect(control.lstatCalls).not.toContain(belowTheirs);
    expect(modeOf(mine)).toBe(0o600);
  });

  it('stays on the home device: entries on another device keep their modes and are not entered', async () => {
    const mount = folder(path.join(home, 'mounted'), 0o755);
    const below = write(path.join(mount, 'notes.md'), 0o644);
    const db = write(path.join(home, 'cowork.db'), 0o644);
    // The home itself reads as on another device than every entry in it.
    control.onAnotherDevice = new Set([home]);

    expect(await tightenHomeOnce(home, LINUX)).toEqual({ kind: 'tightened', changed: 0 });

    expect(modeOf(mount)).toBe(0o755);
    expect(modeOf(db)).toBe(0o644);
    expect(control.lstatCalls).not.toContain(below);
  });

  it('leaves an entry replaced between its lstat and its open, and still completes the pass', async () => {
    const replaced = write(path.join(home, 'state.json'), 0o644);
    const db = write(path.join(home, 'cowork.db'), 0o644);
    control.replaceBeforeOpen = { entry: replaced, by: 'file' };

    expect(await tightenHomeOnce(home, LINUX)).toEqual({ kind: 'tightened', changed: 1 });

    // The replacement is a new file inside a private folder; the pass never saw it.
    expect(fs.readFileSync(replaced, 'utf8')).toBe('replaced');
    expect(modeOf(replaced)).toBe(0o644);
    expect(modeOf(db)).toBe(0o600);
    expect(fs.existsSync(path.join(home, PRIVATE_MODES_MARKER))).toBe(true);
    expect(warnings('private_files_could_not_tighten_every_entry_in_a_home')).toHaveLength(0);
  });

  it('never follows an entry replaced by a link between its lstat and its open', async () => {
    const outside = write(path.join(root, 'outside.txt'), 0o644);
    const replaced = write(path.join(home, 'notes.md'), 0o644);
    control.replaceBeforeOpen = { entry: replaced, by: { linkTo: outside } };

    expect(await tightenHomeOnce(home, LINUX)).toEqual({ kind: 'tightened', changed: 0 });

    expect(fs.lstatSync(replaced).isSymbolicLink()).toBe(true);
    expect(modeOf(outside)).toBe(0o644);
  });

  it('makes no change on win32', async () => {
    const db = write(path.join(home, 'cowork.db'), 0o644);
    const dir = folder(path.join(home, 'projects'), 0o755);

    expect(await tightenHomeOnce(home, WINDOWS)).toEqual({ kind: 'skipped', reason: 'windows' });
    expect(modeOf(db)).toBe(0o644);
    expect(modeOf(dir)).toBe(0o755);
    expect(fs.existsSync(path.join(home, PRIVATE_MODES_MARKER))).toBe(false);
  });
});

describe('tightenLegacyHome', () => {
  let legacy: string;
  beforeEach(() => {
    legacy = path.join(root, '.anton');
  });

  it('strips group and other bits from the folder and its .env', () => {
    folder(legacy, 0o755);
    const env = write(path.join(legacy, '.env'), 0o644);
    const memory = write(path.join(legacy, 'memory.md'), 0o644);

    tightenLegacyHome(legacy, LINUX);

    expect(modeOf(legacy)).toBe(0o700);
    expect(modeOf(env)).toBe(0o600);
    // Only the two entries the migration reads: the folder's mode covers the rest.
    expect(modeOf(memory)).toBe(0o644);
  });

  it('never follows a link at the folder or at its .env', () => {
    const realFolder = folder(path.join(root, 'elsewhere'), 0o755);
    fs.symlinkSync(realFolder, legacy);
    tightenLegacyHome(legacy, LINUX);
    expect(modeOf(realFolder)).toBe(0o755);

    fs.unlinkSync(legacy);
    folder(legacy, 0o755);
    const realEnv = write(path.join(root, 'real.env'), 0o644);
    fs.symlinkSync(realEnv, path.join(legacy, '.env'));
    tightenLegacyHome(legacy, LINUX);
    expect(modeOf(legacy)).toBe(0o700);
    expect(modeOf(realEnv)).toBe(0o644);
  });

  it('leaves a folder another account owns', () => {
    folder(legacy, 0o755);
    vi.spyOn(process, 'getuid').mockReturnValue(fs.statSync(legacy).uid + 1);
    tightenLegacyHome(legacy, LINUX);
    expect(modeOf(legacy)).toBe(0o755);
  });

  it('does nothing when there is no legacy folder, or on win32', () => {
    expect(() => tightenLegacyHome(legacy, LINUX)).not.toThrow();
    folder(legacy, 0o755);
    tightenLegacyHome(legacy, WINDOWS);
    expect(modeOf(legacy)).toBe(0o755);
  });
});

describe('restrictToOwnerOnWindows', () => {
  const ICACLS_ARGS = ['/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-3-4:(OI)(CI)F'];

  it('runs icacls once, without blocking, and then writes the marker', async () => {
    const dir = folder(path.join(root, 'repo', '.claude-mindshub'), 0o755);

    await restrictToOwnerOnWindows(dir, WINDOWS);
    await restrictToOwnerOnWindows(dir, WINDOWS);

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith('icacls', [dir, ...ICACLS_ARGS], expect.anything(), expect.any(Function));
    expect(fs.existsSync(path.join(dir, OWNER_ONLY_ACCESS_MARKER))).toBe(true);
  });

  it('writes no marker when icacls fails, so the next call tries again', async () => {
    const dir = folder(path.join(root, 'repo', '.claude-mindshub'), 0o755);
    execFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) =>
      cb(new Error('icacls failed')),
    );

    await expect(restrictToOwnerOnWindows(dir, WINDOWS)).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(dir, OWNER_ONLY_ACCESS_MARKER))).toBe(false);
    expect(warnings('private_files_could_not_restrict_a_folder_to_its_owner')).toHaveLength(1);

    await restrictToOwnerOnWindows(dir, WINDOWS);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('never runs on linux', async () => {
    const dir = folder(path.join(root, 'repo', '.claude-mindshub'), 0o755);
    await restrictToOwnerOnWindows(dir, LINUX);
    expect(execFile).not.toHaveBeenCalled();
  });
});

/* The canonical private `.env` writer. At sign-in finalize on Windows it runs
 * while the old server still holds the file open, so it must write atomically
 * (never truncating the user's other credentials) and ride out a transient
 * lock on the rename instead of throwing. */
describe('writeEnvFileAtomic', () => {
  let dir: string;
  let target: string;
  beforeEach(() => {
    dir = path.join(root, 'env-home');
    fs.mkdirSync(dir);
    target = path.join(dir, '.env');
  });

  it('writes content to a fresh path and leaves no temp file behind', async () => {
    await writeEnvFileAtomic(target, 'ANTON_MINDS_API_KEY=mdb_abc\n');
    expect(fs.readFileSync(target, 'utf-8')).toBe('ANTON_MINDS_API_KEY=mdb_abc\n');
    expect(fs.readdirSync(dir)).toEqual(['.env']);
  });

  it('overwrites an existing file atomically', async () => {
    fs.writeFileSync(target, 'OLD=1\n');
    await writeEnvFileAtomic(target, 'NEW=2\n');
    expect(fs.readFileSync(target, 'utf-8')).toBe('NEW=2\n');
    expect(fs.readdirSync(dir)).toEqual(['.env']);
  });

  it('creates the temp file owner-only (0o600): it holds the plaintext key through every retry', async () => {
    await writeEnvFileAtomic(target, 'X=1\n');
    expect((control.lastWriteOpts as { mode?: number } | undefined)?.mode).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')('leaves a target an older build wrote at 0644 at 0600', async () => {
    write(target, 0o644, 'OLD=1\n');
    await writeEnvFileAtomic(target, 'NEW=2\n');
    expect(modeOf(target)).toBe(0o600);
  });

  it('retries the rename through a transient EPERM and then succeeds', async () => {
    control.renameFailCode = 'EPERM';
    control.renameFailTimes = 2;
    await writeEnvFileAtomic(target, 'K=v\n', { baseDelayMs: 0 });
    expect(control.renameFailTimes).toBe(0);
    expect(fs.readFileSync(target, 'utf-8')).toBe('K=v\n');
  });

  it('gives up after exhausting attempts and cleans up the temp file', async () => {
    control.renameFailCode = 'EBUSY';
    control.renameFailTimes = Infinity;
    await expect(writeEnvFileAtomic(target, 'K=v\n', { attempts: 3, baseDelayMs: 0 })).rejects.toThrow(/EBUSY/);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('does not retry a non-lock error (e.g. ENOENT): it fails fast', async () => {
    control.renameFailCode = 'ENOENT';
    control.renameFailTimes = 5;
    await expect(writeEnvFileAtomic(target, 'K=v\n', { baseDelayMs: 0 })).rejects.toThrow(/ENOENT/);
    expect(control.renameFailTimes).toBe(4);
  });

  it('sweeps a stale orphaned .env.tmp-* but spares a fresh sibling', async () => {
    /* A hard kill between the write and the rename can leave a temp holding
     * the plaintext key; a stale one is removed, but a concurrent writer's
     * fresh temp survives. */
    const stale = path.join(dir, '.env.tmp-9999-deadbeef');
    fs.writeFileSync(stale, 'ANTON_MINDS_API_KEY=leaked\n');
    fs.utimesSync(stale, new Date(0), new Date(0));
    const fresh = path.join(dir, '.env.tmp-1234-cafebabe');
    fs.writeFileSync(fresh, 'ANTON_MINDS_API_KEY=inflight\n');

    await writeEnvFileAtomic(target, 'K=v\n');

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('K=v\n');
  });
});

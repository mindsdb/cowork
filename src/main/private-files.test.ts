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

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync,
}));

/* Delegates to the real fs. A test names one path whose chmod through a
 * descriptor must fail, the way an entry the user cannot change fails. */
const control = vi.hoisted(() => ({ failChmodFor: null as string | null }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const open = async (...args: Parameters<typeof actual.promises.open>) => {
    const handle = await actual.promises.open(...args);
    if (control.failChmodFor !== null && String(args[0]) === control.failChmodFor) {
      handle.chmod = async () => {
        throw Object.assign(new Error('EPERM: operation not permitted, fchmod'), { code: 'EPERM' });
      };
    }
    return handle;
  };
  const promises = { ...actual.promises, open };
  return { ...actual, promises, default: { ...actual, promises } };
});

import {
  OWNER_ONLY_ACCESS_MARKER,
  PRIVATE_MODES_MARKER,
  pinPrivateDir,
  restrictToOwnerOnWindows,
  tightenHomeOnce,
  tightenLegacyHome,
} from './private-files';

const LINUX = { platform: 'linux' as const };
const WINDOWS = { platform: 'win32' as const };

let root: string;
let home: string;

beforeEach(() => {
  diagnostics.diagnostic.mockClear();
  execFileSync.mockReset();
  control.failChmodFor = null;
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

  it('tightens a hard-linked file, whose inode it shares with the other name', async () => {
    const outside = write(path.join(root, 'cache', 'blob'), 0o644);
    const inside = path.join(home, 'uv', 'tools', 'blob');
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.linkSync(outside, inside);

    await tightenHomeOnce(home, LINUX);

    expect(modeOf(inside)).toBe(0o600);
    expect(modeOf(outside)).toBe(0o600);
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

  it('runs icacls once and then writes the marker', () => {
    const dir = folder(path.join(root, 'repo', '.claude-mindshub'), 0o755);

    restrictToOwnerOnWindows(dir, WINDOWS);
    restrictToOwnerOnWindows(dir, WINDOWS);

    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith('icacls', [dir, ...ICACLS_ARGS], expect.anything());
    expect(fs.existsSync(path.join(dir, OWNER_ONLY_ACCESS_MARKER))).toBe(true);
  });

  it('writes no marker when icacls fails, so the next call tries again', () => {
    const dir = folder(path.join(root, 'repo', '.claude-mindshub'), 0o755);
    execFileSync.mockImplementationOnce(() => {
      throw new Error('icacls failed');
    });

    restrictToOwnerOnWindows(dir, WINDOWS);
    expect(fs.existsSync(path.join(dir, OWNER_ONLY_ACCESS_MARKER))).toBe(false);
    expect(warnings('private_files_could_not_restrict_a_folder_to_its_owner')).toHaveLength(1);

    restrictToOwnerOnWindows(dir, WINDOWS);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it('never runs on linux', () => {
    const dir = folder(path.join(root, 'repo', '.claude-mindshub'), 0o755);
    restrictToOwnerOnWindows(dir, LINUX);
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

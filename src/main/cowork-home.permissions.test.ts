/* A per-account root holds that account's database, files, connector vault and
 * dotenv. Another OS user on the machine should not be able to read it, and
 * which OS user can must not depend on whichever code happened to create the
 * home first.
 *
 * Its own file because it needs coworkHome() and the root resolution both under
 * control: calling ensureAccountDataRoot() against an uncontrolled home would
 * mkdir into the developer's real ~/.cowork-*. For the same reason os.homedir()
 * is a temp folder here, so the boot pin's "real homes" are fakes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const appState = vi.hoisted(() => ({ isPackaged: false }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
    getPath: () => '',
  },
}));

const fakeHome = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const homedir = () => fakeHome.dir || actual.homedir();
  return { ...actual, homedir, default: { ...actual, homedir } };
});

/**
 * Which root the session resolves to; null means the default root.
 *
 * `accountDataHome` is mocked rather than `resolveAccountRoot`, because
 * account-data calls its own resolver internally and an export-level mock never
 * reaches that call.
 */
const accountState = vi.hoisted(() => ({ subdir: null as string | null }));
vi.mock('./account-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./account-data')>()),
  accountDataHome: (home: string) =>
    (accountState.subdir ? `${home}/accounts/${accountState.subdir}` : home),
}));

import { accountDataRoot, coworkHome, ensureAccountDataRoot, pinPrivateHomes, tightenPrivateHomes } from './cowork-home';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-perm-'));
  process.env.COWORK_DEV_HOME = home;
  accountState.subdir = null;
  appState.isPackaged = false;
});

afterEach(() => {
  delete process.env.COWORK_DEV_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

const modeOf = (dir: string) => fs.statSync(dir).mode & 0o777;

describe('per-account root permissions', () => {
  it('creates a per-account root readable only by this OS user', () => {
    accountState.subdir = 'second-account';

    const root = ensureAccountDataRoot();

    expect(root).not.toBe(coworkHome());
    expect(root).toBe(accountDataRoot());
    expect(modeOf(root)).toBe(0o700);
  });

  it('pins the mode past a permissive umask on a root that already exists', () => {
    // mkdir's mode argument is masked by the umask and ignored entirely for a
    // directory that is already there, which is why this chmods rather than
    // trusting creation.
    accountState.subdir = 'second-account';
    const root = ensureAccountDataRoot();
    fs.chmodSync(root, 0o755);

    ensureAccountDataRoot();

    expect(modeOf(root)).toBe(0o700);
  });

  it('pins the shared home too, which the account that owns it uses as its root', () => {
    accountState.subdir = null;
    fs.chmodSync(home, 0o755);

    expect(ensureAccountDataRoot()).toBe(coworkHome());
    expect(modeOf(home)).toBe(0o700);
  });
});

/* The boot step: every Cowork home on the computer is owner-only before any
 * sidecar starts. The channel homes below live under a fake os.homedir(). */
describe('the boot pin of every home', () => {
  let userHome: string;
  const channelHomes = ['.cowork', '.cowork-dev', '.cowork-preview', '.cowork-stable'];

  beforeEach(() => {
    userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-user-home-'));
    fakeHome.dir = userHome;
    for (const name of [...channelHomes, '.cowork-poc-x']) {
      fs.mkdirSync(path.join(userHome, name), { mode: 0o755 });
      fs.chmodSync(path.join(userHome, name), 0o755);
    }
  });

  afterEach(() => {
    fakeHome.dir = '';
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  it('pins only the override when it is set, leaving the sibling and the channel homes alone', async () => {
    fs.chmodSync(home, 0o755);
    const ownRoot = path.join(home, 'accounts', 'second-account');
    fs.mkdirSync(ownRoot, { recursive: true });
    fs.chmodSync(ownRoot, 0o755);
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x');
    fs.chmodSync(path.join(home, 'cowork.db'), 0o644);
    fs.writeFileSync(path.join(userHome, '.cowork', 'cowork.db'), 'x');
    fs.chmodSync(path.join(userHome, '.cowork', 'cowork.db'), 0o644);

    const pinned = pinPrivateHomes({ platform: 'linux' });
    await tightenPrivateHomes(pinned, { platform: 'linux' });

    expect(pinned).toEqual([path.normalize(home)]);
    expect(modeOf(home)).toBe(0o700);
    expect(modeOf(ownRoot)).toBe(0o700);
    expect(modeOf(path.join(home, 'cowork.db'))).toBe(0o600);
    for (const name of [...channelHomes, '.cowork-poc-x']) expect(modeOf(path.join(userHome, name))).toBe(0o755);
    expect(modeOf(path.join(userHome, '.cowork', 'cowork.db'))).toBe(0o644);
  });

  it('pins each channel home by name without the override, never a look-alike', () => {
    delete process.env.COWORK_DEV_HOME;
    fs.rmSync(path.join(userHome, '.cowork-preview'), { recursive: true });
    const ownRoot = path.join(userHome, '.cowork', 'accounts', 'second-account');
    fs.mkdirSync(ownRoot, { recursive: true });
    fs.chmodSync(ownRoot, 0o755);

    const pinned = pinPrivateHomes({ platform: 'linux' });

    expect(pinned.sort()).toEqual(['.cowork', '.cowork-dev', '.cowork-stable'].map((n) => path.join(userHome, n)).sort());
    for (const name of ['.cowork', '.cowork-dev', '.cowork-stable']) expect(modeOf(path.join(userHome, name))).toBe(0o700);
    expect(modeOf(ownRoot)).toBe(0o700);
    expect(modeOf(path.join(userHome, '.cowork-poc-x'))).toBe(0o755);
    expect(fs.existsSync(path.join(userHome, '.cowork-preview'))).toBe(false);
  });

  it('ignores the override in a packaged app', () => {
    appState.isPackaged = true;

    const pinned = pinPrivateHomes({ platform: 'linux' });

    expect(pinned).not.toContain(path.normalize(home));
    expect(modeOf(path.join(userHome, '.cowork-stable'))).toBe(0o700);
  });

  // Root can open a folder without its read bit, so the pin would not fail.
  it.skipIf(process.getuid?.() === 0)('still returns, and so tightens, a home with an account root that cannot be pinned', async () => {
    fs.chmodSync(home, 0o755);
    const db = path.join(home, 'cowork.db');
    fs.writeFileSync(db, 'x');
    fs.chmodSync(db, 0o644);
    // Without its owner's read bit, the pin's open fails with EACCES.
    const unreadable = path.join(home, 'accounts', 'unreadable');
    fs.mkdirSync(unreadable, { recursive: true });
    fs.chmodSync(unreadable, 0o000);
    try {
      const pinned = pinPrivateHomes({ platform: 'linux' });
      await tightenPrivateHomes(pinned, { platform: 'linux' });

      expect(pinned).toEqual([path.normalize(home)]);
      expect(modeOf(home)).toBe(0o700);
      expect(modeOf(db)).toBe(0o600);
    } finally {
      fs.chmodSync(unreadable, 0o700);
    }
  });

  it('never rejects, so the boot step can start the pass without awaiting it', async () => {
    const getuid = vi.spyOn(process, 'getuid').mockImplementation(() => {
      throw new Error('no user id');
    });
    try {
      await expect(tightenPrivateHomes([home], { platform: 'linux' })).resolves.toBeUndefined();
      expect(getuid).toHaveBeenCalled();
    } finally {
      getuid.mockRestore();
    }
  });

  it('makes no chmod on win32', async () => {
    fs.chmodSync(home, 0o755);
    const pinned = pinPrivateHomes({ platform: 'win32' });
    await tightenPrivateHomes(pinned, { platform: 'win32' });
    expect(modeOf(home)).toBe(0o755);
  });
});

// A per-account root holds that account's database, files, connector vault and
// dotenv. Another OS user on the machine should not be able to read it, and
// which OS user can must not depend on whichever code happened to create the
// home first.
//
// Its own file because it needs coworkHome() and the root resolution both under
// control: calling ensureAccountDataRoot() against an uncontrolled home would
// mkdir into the developer's real ~/.cowork-*.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }));

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

import { accountDataRoot, coworkHome, ensureAccountDataRoot } from './cowork-home';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-perm-'));
  process.env.COWORK_DEV_HOME = home;
  accountState.subdir = null;
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

  it('leaves the shared home alone, which predates this and is not ours to change', () => {
    // The account that owns the default root uses coworkHome() itself. Its
    // permissions are whatever the install already had, and tightening them
    // here would change existing state for a reason this did not ask for.
    accountState.subdir = null;
    fs.chmodSync(home, 0o755);

    expect(ensureAccountDataRoot()).toBe(coworkHome());
    expect(modeOf(home)).toBe(0o755);
  });
});

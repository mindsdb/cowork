import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// minds-auth transitively loads token-store / cowork-home, which touch
// electron's `app` at module init. Stub it so the module imports under the
// node test env (vi.mock intercepts these static imports).
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
  },
}));

// fs exports are non-configurable ESM namespace bindings, so vi.spyOn can't
// wrap them. Mock the module instead: delegate to the real fs, but let a test
// force renameSync to fail N times (simulating a Windows share-mode lock) and
// record the writeFileSync options (to assert no `mode` is passed).
const control = {
  renameFailCode: null as string | null,
  renameFailTimes: 0,
  lastWriteOpts: undefined as unknown,
};
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    writeFileSync: (p: any, data: any, opts?: any) => {
      control.lastWriteOpts = opts;
      return actual.writeFileSync(p, data, opts);
    },
    renameSync: (from: any, to: any) => {
      if (control.renameFailTimes > 0) {
        control.renameFailTimes -= 1;
        const err: any = new Error(`${control.renameFailCode}: forced by test`);
        err.code = control.renameFailCode;
        throw err;
      }
      return actual.renameSync(from, to);
    },
  };
});

// Point the config home at a temp dir and stub the install check, so the
// writeMindsKeyToEnvAndRestart test can exercise the non-fatal .env path without
// touching the real home or the server. (The writeEnvFileAtomic tests pass
// explicit paths and don't hit these.)
// Hoisted: token-store reads coworkHome() at module load, before a plain const
// would initialize, so the holder must exist during the mock-hoist phase.
const homeHolder = vi.hoisted(() => ({ home: '', env: '', state: '', antonInstalled: false }));
vi.mock('./cowork-home', () => ({
  coworkHome: () => homeHolder.home,
  coworkEnvPath: () => homeHolder.env,
  coworkStatePath: () => homeHolder.state,
  readEnvFile: () => ({}),
  // Other consumers (server-process, minds-urls) read the build kind at load.
  buildKind: () => 'prod',
  buildKindStrict: () => 'prod',
  migrateLegacyHome: () => {},
}));
vi.mock('./installer', () => ({
  checkInstallStatus: async () => ({ antonInstalled: homeHolder.antonInstalled }),
}));
// Stub the server lifecycle so the installed-path test can run past the early
// return without touching a real server. isServerRunning=false short-circuits
// the DB-sync block, so those tests need no network mock. Mutable, because the
// account-switch restart is a decision worth asserting rather than a branch no
// test can reach: with a fixed isServerRunning=false, inverting its condition
// leaves the whole suite green.
const serverState = vi.hoisted(() => ({
  running: false,
  onCurrentRoot: true,
  stops: 0,
  starts: 0,
}));
vi.mock('./server-process', () => ({
  stopServer: async () => { serverState.stops += 1; },
  startServer: async () => { serverState.starts += 1; },
  isServerRunning: () => serverState.running,
  isServerStarting: () => false,
  getServerPort: () => 26866,
  sidecarIsOnCurrentAccountRoot: () => serverState.onCurrentRoot,
}));

// Regression coverage for ENG-1209 (Windows EPERM saving MindsHub creds):
// writeEnvFileAtomic must write atomically (never truncate the user's other
// creds) and ride out a transient lock on the rename instead of throwing.
import { writeEnvFileAtomic, commitMindsSignIn } from './minds-auth';
import { saveTokens, clearTokens } from './token-store';
import { observePreExistingData } from './account-data';

let dir: string;
let target: string;

beforeEach(() => {
  control.renameFailCode = null;
  control.renameFailTimes = 0;
  control.lastWriteOpts = undefined;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minds-env-'));
  target = path.join(dir, '.env');
  homeHolder.home = dir;
  homeHolder.env = target;
  homeHolder.state = path.join(dir, 'state.json');
  homeHolder.antonInstalled = false;
  serverState.running = false;
  serverState.onCurrentRoot = true;
  serverState.stops = 0;
  serverState.starts = 0;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeEnvFileAtomic', () => {
  it('writes content to a fresh path and leaves no temp file behind', async () => {
    await writeEnvFileAtomic(target, 'ANTON_MINDS_API_KEY=mdb_abc\n');
    expect(fs.readFileSync(target, 'utf-8')).toBe('ANTON_MINDS_API_KEY=mdb_abc\n');
    // temp sibling cleaned up (renamed away)
    expect(fs.readdirSync(dir)).toEqual(['.env']);
  });

  it('overwrites an existing file atomically', async () => {
    fs.writeFileSync(target, 'OLD=1\n');
    await writeEnvFileAtomic(target, 'NEW=2\n');
    expect(fs.readFileSync(target, 'utf-8')).toBe('NEW=2\n');
    expect(fs.readdirSync(dir)).toEqual(['.env']);
  });

  it('creates the temp file owner-only (0o600) — the secret must never be world-readable', async () => {
    await writeEnvFileAtomic(target, 'X=1\n');
    // The temp holds the full plaintext key through every retry / crash window,
    // so it must be 0o600 from creation, not only after the final chmod (ENG-1209).
    expect((control.lastWriteOpts as any)?.mode).toBe(0o600);
  });

  it('retries the rename through a transient EPERM and then succeeds', async () => {
    control.renameFailCode = 'EPERM';
    control.renameFailTimes = 2;
    await writeEnvFileAtomic(target, 'K=v\n', { baseDelayMs: 0 });
    expect(control.renameFailTimes).toBe(0); // both forced failures consumed
    expect(fs.readFileSync(target, 'utf-8')).toBe('K=v\n');
  });

  it('gives up after exhausting attempts and cleans up the temp file', async () => {
    control.renameFailCode = 'EBUSY';
    control.renameFailTimes = Infinity;
    await expect(
      writeEnvFileAtomic(target, 'K=v\n', { attempts: 3, baseDelayMs: 0 }),
    ).rejects.toThrow(/EBUSY/);
    // No temp turd left in the config home after we give up.
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('does not retry a non-lock error (e.g. ENOENT) — fails fast', async () => {
    control.renameFailCode = 'ENOENT';
    control.renameFailTimes = 5;
    await expect(
      writeEnvFileAtomic(target, 'K=v\n', { baseDelayMs: 0 }),
    ).rejects.toThrow(/ENOENT/);
    // Only one attempt consumed — a non-retriable code must not loop.
    expect(control.renameFailTimes).toBe(4);
  });

  it('sweeps a STALE orphaned .env.tmp-* but spares a fresh sibling', async () => {
    // A hard kill between writeFileSync and rename can leave a temp holding the
    // full plaintext key; a stale one must be cleaned, but a concurrent writer's
    // fresh temp must survive (the age threshold is what lets the sweep and the
    // random suffix coexist).
    const stale = path.join(dir, '.env.tmp-9999-deadbeef');
    fs.writeFileSync(stale, 'ANTON_MINDS_API_KEY=leaked\n');
    fs.utimesSync(stale, new Date(0), new Date(0)); // backdate → stale
    const fresh = path.join(dir, '.env.tmp-1234-cafebabe');
    fs.writeFileSync(fresh, 'ANTON_MINDS_API_KEY=inflight\n'); // mtime ~now

    await writeEnvFileAtomic(target, 'K=v\n');

    expect(fs.existsSync(stale)).toBe(false); // stale orphan swept
    expect(fs.existsSync(fresh)).toBe(true);  // live sibling spared
    expect(fs.readFileSync(target, 'utf-8')).toBe('K=v\n');
  });
});

describe('commitMindsSignIn — .env failure handling', () => {
  it('is non-fatal on the installed path (the settings sync carries the config)', async () => {
    // The wedge: a locked .env aborted the whole sign-in. With the
    // server installed, the settings PUTs re-establish everything this file
    // holds, so an exhausted-retry write must not propagate.
    homeHolder.antonInstalled = true;
    control.renameFailCode = 'EPERM';
    control.renameFailTimes = Infinity;
    await expect(commitMindsSignIn()).resolves.toBeUndefined();
  }, 15000);

  it('is FATAL on the pre-install path (nothing else has recorded the sign-in yet)', async () => {
    // No server yet → early-return with no settings sync, so a failed write
    // must surface rather than report a sign-in nothing recorded.
    homeHolder.antonInstalled = false;
    control.renameFailCode = 'EPERM';
    control.renameFailTimes = Infinity;
    await expect(commitMindsSignIn()).rejects.toThrow(/EPERM/);
  }, 15000);
});

// The account has to be recorded and the root claimed BEFORE anything starts
// the sidecar, including the pre-install path where setup starts it later.
// The restart decision itself is `resolveAccountRoot`, covered directly in
// account-data.test.ts.
describe('commitMindsSignIn — the account data root', () => {
  const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
  const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

  const asAccount = (sub: string) => {
    const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
    saveTokens(`header.${payload}.signature`, 3600, '');
  };
  const readJson = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as { accountId: string | null };
  // Boot records this before anything can create a database. Without it the
  // unrecorded answer is "had data", which correctly refuses the claim — so a
  // test that skips it is testing the upgrade path, not a fresh install.
  const asFreshInstall = () => observePreExistingData(dir);

  afterEach(() => {
    clearTokens();
  });

  it('records the signed-in account and claims the default root', async () => {
    homeHolder.antonInstalled = false;
    asFreshInstall();
    asAccount(ACCOUNT_A);

    await expect(commitMindsSignIn()).resolves.toBeUndefined();

    expect(readJson('active-account.json').accountId).toBe(ACCOUNT_A);
    expect(readJson('.account').accountId).toBe(ACCOUNT_A);
  });

  it('records a second account without letting it take the first account root', async () => {
    homeHolder.antonInstalled = false;
    asFreshInstall();
    asAccount(ACCOUNT_A);
    await commitMindsSignIn();

    asAccount(ACCOUNT_B);
    await commitMindsSignIn();

    expect(readJson('active-account.json').accountId).toBe(ACCOUNT_B);
    // The claim still names A, so B is resolved onto its own root instead.
    expect(readJson('.account').accountId).toBe(ACCOUNT_A);
  });

  it('does not let a sign-in claim a root that already held data', async () => {
    // The upgrade path: no observation of a fresh install, so the recorded
    // answer is "had data" and the claim is refused. Only the dialog can hand
    // that root over.
    homeHolder.antonInstalled = false;
    fs.writeFileSync(path.join(dir, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(dir);
    asAccount(ACCOUNT_A);

    await commitMindsSignIn();

    expect(readJson('active-account.json').accountId).toBe(ACCOUNT_A);
    expect(fs.existsSync(path.join(dir, '.account'))).toBe(false);
  });

  it('leaves the records alone when the token carries no account', async () => {
    homeHolder.antonInstalled = false;
    // No saveTokens call: nothing to derive a root from, so nothing is written
    // and the sidecar keeps whatever root it already had.
    await expect(commitMindsSignIn()).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'active-account.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.account'))).toBe(false);
  });
});


describe('commitMindsSignIn — the account-switch restart', () => {
  const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';

  const asAccount = (sub: string) => {
    const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
    saveTokens(`header.${payload}.signature`, 3600, '');
  };

  afterEach(() => {
    clearTokens();
  });

  it('restarts the sidecar when it is serving a different account root', async () => {
    // The store paths are process environment, so a running sidecar cannot be
    // moved onto this account's database any other way.
    homeHolder.antonInstalled = true;
    serverState.running = true;
    serverState.onCurrentRoot = false;
    asAccount(ACCOUNT_A);

    await commitMindsSignIn();

    expect(serverState.stops).toBe(1);
    expect(serverState.starts).toBe(1);
  });

  it('leaves a running sidecar alone when it is already on the right root', async () => {
    // An ordinary sign-in must not kill a running turn.
    homeHolder.antonInstalled = true;
    serverState.running = true;
    serverState.onCurrentRoot = true;
    asAccount(ACCOUNT_A);

    await commitMindsSignIn();

    expect(serverState.stops).toBe(0);
    expect(serverState.starts).toBe(0);
  });
});

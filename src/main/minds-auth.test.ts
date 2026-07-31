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

// Regression coverage for ENG-1209 (Windows EPERM saving MindsHub creds):
// writeEnvFileAtomic must write atomically (never truncate the user's other
// creds) and ride out a transient lock on the rename instead of throwing.
import { writeEnvFileAtomic, writeMindsKeyToEnvAndRestart } from './minds-auth';

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

  it('sweeps an orphaned .env.tmp-* from a prior crash before writing', async () => {
    // A hard kill between writeFileSync and rename can leave a temp holding the
    // full plaintext key; it must not linger in the config home.
    const orphan = path.join(dir, '.env.tmp-9999-deadbeef');
    fs.writeFileSync(orphan, 'ANTON_MINDS_API_KEY=leaked\n');
    await writeEnvFileAtomic(target, 'K=v\n');
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(['.env']);
  });
});

describe('writeMindsKeyToEnvAndRestart — .env failure is non-fatal', () => {
  it('does not throw (or surface the finalize error) when the .env write fails', async () => {
    // The wedge (ENG-1209): a locked .env made this abort before the
    // authoritative DB sync, stranding the user with an already-revoked key.
    // Server not installed here, so it early-returns after the .env attempt —
    // the point is that an exhausted-retry write no longer propagates.
    control.renameFailCode = 'EPERM';
    control.renameFailTimes = Infinity;
    await expect(writeMindsKeyToEnvAndRestart('mdb_newkey')).resolves.toBeUndefined();
  }, 15000);
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Stub Electron before token-store/cowork-home read app during module initialization.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
  },
}));

// Mock the fs module because ESM exports cannot be spied on; delegate real I/O while controlling
// rename locks and recording write options.
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

// Use a temporary config home and stub installation to avoid the real profile/server.
// Hoist the holder because token-store reads coworkHome during module initialization.
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
// Stub server lifecycle; isServerRunning=false bypasses DB sync and network access.
vi.mock('./server-process', () => ({
  stopServer: async () => {},
  startServer: async () => {},
  isServerRunning: () => false,
  isServerStarting: () => false,
  getServerPort: () => 26866,
}));

// Atomic writes must preserve unrelated credentials and retry transient Windows rename locks.
import { writeEnvFileAtomic, commitMindsSignIn } from './minds-auth';

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

  it('sweeps a STALE orphaned .env.tmp-* but spares a fresh sibling', async () => {
    // Delete abandoned plaintext temp files without removing a concurrent writer's fresh temp; age
    // distinguishes them.
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
    // With the server installed, settings PUTs recover credentials even if .env retries are
    // exhausted; sign-in must continue.
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { importChromeHistory } from './chrome-import';
import type { ChromeImportDeps, ExecFileLike } from './chrome-import';

// Real tmp FS (profile roots + cache), but sqlite3 is faked via the injected
// execFile — tests must never read the developer's real Chrome profile.

const BASE = `${process.env.TMPDIR || '/tmp'}/chrome-import-test-${process.pid}`;
const HOME = path.join(BASE, 'home');
const TMP = path.join(BASE, 'tmp');
const CACHE = path.join(BASE, 'cache', 'chrome-import.json');

const CHROME_HISTORY = path.join(
  HOME, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'History',
);

function fakeSqlite(rows: unknown, err: Error | null = null): ExecFileLike {
  return (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (e: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb(err, err ? '' : JSON.stringify(rows), '');
  };
}

function makeProfile(): void {
  fs.mkdirSync(path.dirname(CHROME_HISTORY), { recursive: true });
  fs.writeFileSync(CHROME_HISTORY, 'fake sqlite bytes');
  fs.writeFileSync(`${CHROME_HISTORY}-wal`, 'fake wal');
}

function deps(overrides: Partial<ChromeImportDeps> = {}): ChromeImportDeps {
  return { platform: 'darwin', homeDir: HOME, tmpDir: TMP, ...overrides };
}

beforeEach(() => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(HOME, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
});

describe('importChromeHistory', () => {
  it('queries a COPY of each profile History and caches the result', async () => {
    makeProfile();
    const exec = vi.fn(
      fakeSqlite([
        { url: 'https://a.com/', title: 'A', visit_count: 10 },
        { url: 'chrome://settings', title: 'S', visit_count: 99 }, // filtered out
      ]),
    );
    const result = await importChromeHistory(CACHE, {}, deps({ execFileImpl: exec }));
    expect(result.error).toBeUndefined();
    expect(result.profiles).toEqual(['Chrome/Default']);
    expect(result.imported).toBe(1);
    expect(result.sites).toEqual([{ url: 'https://a.com/', title: 'A', visits: 10, source: 'chrome' }]);
    // sqlite3 CLI pointed at a tmp copy, never the live profile.
    const args = exec.mock.calls[0][1] as string[];
    expect(args[0]).toBe('-json');
    expect(args[1]).not.toBe(CHROME_HISTORY);
    expect(args[1]).toContain('cowork-chrome-');
    // Cache written.
    expect(fs.existsSync(CACHE)).toBe(true);
    // Live profile untouched.
    expect(fs.readFileSync(CHROME_HISTORY, 'utf-8')).toBe('fake sqlite bytes');
  });

  it('serves the 24h cache without re-running sqlite3', async () => {
    makeProfile();
    const exec = vi.fn(fakeSqlite([{ url: 'https://a.com', title: 'A', visit_count: 1 }]));
    const first = await importChromeHistory(CACHE, {}, deps({ execFileImpl: exec }));
    expect(exec).toHaveBeenCalledTimes(1);
    const second = await importChromeHistory(CACHE, {}, deps({ execFileImpl: exec }));
    expect(exec).toHaveBeenCalledTimes(1); // cache hit
    expect(second.imported).toBe(first.imported);
    expect(second.sites).toEqual(first.sites);
  });

  it('force bypasses the cache, and an expired cache re-imports', async () => {
    makeProfile();
    const exec = vi.fn(fakeSqlite([{ url: 'https://a.com', title: 'A', visit_count: 1 }]));
    await importChromeHistory(CACHE, {}, deps({ execFileImpl: exec }));
    await importChromeHistory(CACHE, { force: true }, deps({ execFileImpl: exec }));
    expect(exec).toHaveBeenCalledTimes(2);

    // Age the cache past 24h via the injected clock.
    let now = Date.now();
    const clock = () => now;
    await importChromeHistory(CACHE, { force: true }, deps({ execFileImpl: exec, now: clock }));
    now += 25 * 60 * 60 * 1000;
    await importChromeHistory(CACHE, {}, deps({ execFileImpl: exec, now: clock }));
    expect(exec).toHaveBeenCalledTimes(4);
  });

  it('degrades gracefully when no browser is installed', async () => {
    const exec = vi.fn(fakeSqlite([]));
    const result = await importChromeHistory(CACHE, {}, deps({ execFileImpl: exec }));
    expect(result).toMatchObject({ imported: 0, profiles: [], sites: [] });
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports sqlite3 failures without throwing', async () => {
    makeProfile();
    const result = await importChromeHistory(
      CACHE,
      {},
      deps({ execFileImpl: fakeSqlite([], new Error('sqlite3 exploded')) }),
    );
    expect(result.imported).toBe(0);
    expect(result.profiles).toEqual([]);
    expect(result.error).toBe('sqlite3 exploded');
  });

  it('keeps partial results when one profile fails but another succeeds', async () => {
    // Two profiles: Default (sqlite fails) and Profile 1 (succeeds).
    makeProfile();
    const p1 = path.join(
      HOME, 'Library', 'Application Support', 'Google', 'Chrome', 'Profile 1', 'History',
    );
    fs.mkdirSync(path.dirname(p1), { recursive: true });
    fs.writeFileSync(p1, 'db');
    let call = 0;
    const exec: ExecFileLike = (_cmd, _args, _opts, cb) => {
      call += 1;
      if (call === 1) cb(new Error('locked'), '', '');
      else cb(null, JSON.stringify([{ url: 'https://b.com', title: 'B', visit_count: 3 }]), '');
    };
    const result = await importChromeHistory(CACHE, {}, deps({ execFileImpl: exec }));
    // readdir order isn't guaranteed — whichever profile failed, the other
    // one succeeded and the import as a whole is not an error.
    expect(result.imported).toBe(1);
    expect(result.sites).toEqual([{ url: 'https://b.com', title: 'B', visits: 3, source: 'chrome' }]);
    expect(result.profiles).toHaveLength(1);
    expect(result.error).toBeUndefined(); // partial success is not an error
  });

  it('is a no-op off macOS', async () => {
    const result = await importChromeHistory(CACHE, {}, deps({ platform: 'win32' }));
    expect(result).toMatchObject({ imported: 0, profiles: [], sites: [] });
    expect(result.error).toContain('unsupported platform');
  });

  it('treats a corrupt cache file as a miss', async () => {
    makeProfile();
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, 'not json');
    const exec = vi.fn(fakeSqlite([{ url: 'https://a.com', title: 'A', visit_count: 1 }]));
    const result = await importChromeHistory(CACHE, {}, deps({ execFileImpl: exec }));
    expect(exec).toHaveBeenCalledTimes(1);
    expect(result.imported).toBe(1);
  });
});

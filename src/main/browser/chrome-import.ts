// Chrome/Chromium/Edge history import for the start page's Top Sites
// macOS-focused and strictly read-only: the History SQLite DB
// (+ its -wal) is COPIED to a tmp dir and queried there via the sqlite3 CLI —
// the live profile is never opened for write, never locked by us, and a
// missing browser/sqlite3 degrades to {imported: 0, error} instead of throwing.
//
// Results cache in browserDir()/chrome-import.json for 24 h; a forced import
// (BROWSER_IMPORT_CHROME) bypasses the cache.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChromeImportResult, TopSite } from '../../shared/browser-types';
import { parseChromeHistoryRows } from './browser-logic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SQLITE_TIMEOUT_MS = 10_000;
// 3000, not 500: the parser caps at 10 rows per domain, so a larger window
// keeps one chatty origin from crowding every other domain out of the feed.
const HISTORY_SQL =
  'SELECT url, title, visit_count FROM urls WHERE url LIKE \'http%\' ORDER BY visit_count DESC LIMIT 3000';

// Injectable for tests — the production defaults hit the real FS/CLI.
export type ExecFileLike = (
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number },
  cb: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

export interface ChromeImportDeps {
  platform?: string;
  homeDir?: string;
  tmpDir?: string;
  now?: () => number;
  execFileImpl?: ExecFileLike;
}

interface ChromeRoot {
  label: string;
  dir: string;
}

function profileRoots(homeDir: string): ChromeRoot[] {
  const appSupport = path.join(homeDir, 'Library', 'Application Support');
  return [
    { label: 'Chrome', dir: path.join(appSupport, 'Google', 'Chrome') },
    { label: 'Chromium', dir: path.join(appSupport, 'Chromium') },
    { label: 'Edge', dir: path.join(appSupport, 'Microsoft Edge') },
  ];
}

function listProfiles(root: ChromeRoot): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root.dir, { withFileTypes: true });
  } catch {
    return []; // browser not installed
  }
  return entries
    .filter((e) => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile ')))
    .map((e) => path.join(root.dir, e.name));
}

interface CacheFile {
  at: number;
  sites: TopSite[];
}

function readCache(cachePath: string, now: number): TopSite[] | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as CacheFile;
    if (!raw || typeof raw.at !== 'number' || !Array.isArray(raw.sites)) return null;
    if (now - raw.at >= CACHE_TTL_MS) return null;
    return raw.sites;
  } catch {
    return null;
  }
}

function writeCache(cachePath: string, sites: TopSite[], now: number): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.tmp-${process.pid}`;
    // 0600 like the other browserDir stores (browsing history is private).
    fs.writeFileSync(tmp, JSON.stringify({ at: now, sites } satisfies CacheFile), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    fs.renameSync(tmp, cachePath);
  } catch {
    // Cache is an optimization — a failed write must not fail the import.
  }
}

function runSqlite(
  exec: ExecFileLike,
  dbCopy: string,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    exec(
      '/usr/bin/sqlite3',
      ['-json', dbCopy, HISTORY_SQL],
      // 8 MB headroom: 500 rows × long urls/titles stays well under this,
      // but the default 1 MB maxBuffer is within reach on chatty profiles.
      { timeout: SQLITE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true, stdout: stdout ?? '' });
      },
    );
  });
}

export interface ChromeImportOutcome extends ChromeImportResult {
  sites: TopSite[];
}

/** Import top sites from local Chrome-family profiles. Cached for 24 h unless
 *  `force`. All failures are reported in the result, never thrown. */
export async function importChromeHistory(
  cachePath: string,
  opts: { force?: boolean } = {},
  deps: ChromeImportDeps = {},
): Promise<ChromeImportOutcome> {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? (() => Date.now());
  const exec = deps.execFileImpl ?? (execFile as unknown as ExecFileLike);

  if (!opts.force) {
    const cached = readCache(cachePath, now());
    if (cached) return { imported: cached.length, profiles: [], sites: cached };
  }

  if (platform !== 'darwin') {
    return { imported: 0, profiles: [], sites: [], error: `unsupported platform: ${platform}` };
  }

  const homeDir = deps.homeDir ?? os.homedir();
  const tmpBase = deps.tmpDir ?? os.tmpdir();
  const sites: TopSite[] = [];
  const profiles: string[] = [];
  let firstError: string | undefined;

  for (const root of profileRoots(homeDir)) {
    for (const profileDir of listProfiles(root)) {
      const historyPath = path.join(profileDir, 'History');
      if (!fs.existsSync(historyPath)) continue;
      const profileName = `${root.label}/${path.basename(profileDir)}`;
      let tmpDir: string | null = null;
      try {
        // Chrome holds the live DB open with WAL; query a private copy so we
        // never touch (or lock) the profile itself. Copy the WAL FIRST: the
        // db copy must be at least as old as its WAL, or recent commits
        // replayed from the WAL can reference pages the db doesn't have yet.
        tmpDir = fs.mkdtempSync(path.join(tmpBase, 'cowork-chrome-'));
        const dbCopy = path.join(tmpDir, 'History');
        const walPath = `${historyPath}-wal`;
        if (fs.existsSync(walPath)) await fs.promises.cp(walPath, `${dbCopy}-wal`);
        await fs.promises.cp(historyPath, dbCopy);
        const result = await runSqlite(exec, dbCopy);
        if (!result.ok) {
          firstError = firstError ?? result.error;
          continue;
        }
        const rows = parseChromeHistoryRows(result.stdout);
        sites.push(...rows);
        profiles.push(profileName);
      } catch (err) {
        firstError = firstError ?? (err instanceof Error ? err.message : String(err));
      } finally {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }

  // Skip caching a total failure — an empty result WITH an error is not a
  // valid 24h answer, it's a retry-later state.
  if (!(sites.length === 0 && firstError)) writeCache(cachePath, sites, now());
  const outcome: ChromeImportOutcome = { imported: sites.length, profiles, sites };
  if (firstError && sites.length === 0) outcome.error = firstError;
  return outcome;
}

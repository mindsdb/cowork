import { describe, it, expect, beforeEach } from 'vitest';
import {
  chromeCandidates,
  resolveChromePath,
  debugUserDataDir,
  debugPort,
  launchArgs,
  devToolsHttpBase,
  DEFAULT_DEBUG_PORT,
} from './chrome-discovery';

describe('chrome-discovery — per-OS binary candidates', () => {
  it('lists the Chrome.app path on macOS', () => {
    const c = chromeCandidates('darwin');
    expect(c[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('lists Program Files chrome.exe on Windows', () => {
    const c = chromeCandidates('win32');
    expect(c.some((p) => p.toLowerCase().includes('chrome.exe'))).toBe(true);
  });
});

describe('chrome-discovery — resolveChromePath', () => {
  it('env override wins over discovery', () => {
    const resolved = resolveChromePath(() => true, 'darwin', {
      COWORK_BROWSER_CHROME_PATH: '/custom/chrome',
    });
    expect(resolved).toBe('/custom/chrome');
  });

  it('returns the first existing candidate', () => {
    const target = chromeCandidates('darwin')[1];
    const resolved = resolveChromePath((p) => p === target, 'darwin', {});
    expect(resolved).toBe(target);
  });

  it('returns null when nothing is found', () => {
    expect(resolveChromePath(() => false, 'darwin', {})).toBeNull();
  });
});

describe('chrome-discovery — debug profile + port + args', () => {
  // coworkHome() resolves the build kind from env when app.isPackaged is
  // unavailable (test/node env has no Electron `app`); pin it deterministically.
  beforeEach(() => {
    process.env.COWORK_BUILD_KIND = 'dev';
  });

  it('debug profile dir is non-default (isolated from the user profile)', () => {
    const dir = debugUserDataDir();
    expect(dir).toContain('chrome-debug-profile');
    // never the OS default profile
    expect(dir).not.toMatch(/Default$/);
  });

  it('debugPort defaults, honours a valid override, ignores garbage', () => {
    expect(debugPort({})).toBe(DEFAULT_DEBUG_PORT);
    expect(debugPort({ COWORK_BROWSER_DEBUG_PORT: '9444' })).toBe(9444);
    expect(debugPort({ COWORK_BROWSER_DEBUG_PORT: 'nope' })).toBe(DEFAULT_DEBUG_PORT);
    expect(debugPort({ COWORK_BROWSER_DEBUG_PORT: '0' })).toBe(DEFAULT_DEBUG_PORT);
  });

  it('launchArgs binds loopback + a dedicated user-data-dir + the port', () => {
    const args = launchArgs(9333, '/tmp/profile');
    expect(args).toContain('--remote-debugging-port=9333');
    expect(args).toContain('--remote-debugging-address=127.0.0.1');
    expect(args).toContain('--user-data-dir=/tmp/profile');
  });

  it('devToolsHttpBase is loopback', () => {
    expect(devToolsHttpBase(9333)).toBe('http://127.0.0.1:9333');
  });
});

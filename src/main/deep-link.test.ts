import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { BUILD_KINDS } from './channels';
import { schemeForKind, isAuthCallbackUrl, protocolClientArgs, authReturnUrl, claimSingleInstance } from './deep-link';

// A scheme is a machine-wide claim. QA runs a staging build beside prod, so a
// shared name would send a staging sign-in to whichever build installed last.
describe('schemeForKind', () => {
  it('keeps the unsuffixed scheme for prod', () => {
    expect(schemeForKind('prod')).toBe('mindshub-cowork');
  });

  it('labels stable "staging", matching the deb package name', () => {
    expect(schemeForKind('stable')).toBe('mindshub-cowork-staging');
  });

  it('gives every build kind a distinct scheme', () => {
    const schemes = BUILD_KINDS.map(schemeForKind);
    expect(new Set(schemes).size).toBe(BUILD_KINDS.length);
  });
});

describe('isAuthCallbackUrl', () => {
  it('matches its own channel callback URL', () => {
    expect(isAuthCallbackUrl('mindshub-cowork://auth-done', 'prod')).toBe(true);
    expect(isAuthCallbackUrl('mindshub-cowork-staging://auth-done', 'stable')).toBe(true);
  });

  it('does not answer for a sibling channel', () => {
    expect(isAuthCallbackUrl('mindshub-cowork://auth-done', 'stable')).toBe(false);
    expect(isAuthCallbackUrl('mindshub-cowork-staging://auth-done', 'prod')).toBe(false);
  });

  it('tolerates the trailing slash a browser may add', () => {
    expect(isAuthCallbackUrl('mindshub-cowork://auth-done/', 'prod')).toBe(true);
  });

  it('rejects a look-alike host rather than prefix-matching it', () => {
    expect(isAuthCallbackUrl('mindshub-cowork://auth-done.example.com', 'prod')).toBe(false);
    expect(isAuthCallbackUrl('mindshub-cowork://auth-done-evil', 'prod')).toBe(false);
  });

  it('rejects a foreign scheme carrying our host', () => {
    expect(isAuthCallbackUrl('other-app://auth-done', 'prod')).toBe(false);
    expect(isAuthCallbackUrl('https://auth-done', 'prod')).toBe(false);
  });

  it('returns false for input that is not a URL at all', () => {
    expect(isAuthCallbackUrl('', 'prod')).toBe(false);
    expect(isAuthCallbackUrl('not a url', 'prod')).toBe(false);
  });
});

describe('protocolClientArgs', () => {
  it('registers the script path when unpackaged, so Windows relaunches the app and not bare electron', () => {
    expect(protocolClientArgs('/usr/bin/electron', ['/usr/bin/electron', 'out/main.js'], false)).toEqual({
      execPath: '/usr/bin/electron',
      args: [path.resolve('out/main.js')],
    });
  });

  it('registers nothing extra when packaged', () => {
    expect(protocolClientArgs('/Applications/App.app/Contents/MacOS/App', ['/Applications/App.app/Contents/MacOS/App'], true)).toEqual({});
  });

  it('degrades to no override when argv carries no script', () => {
    expect(protocolClientArgs('/usr/bin/electron', ['/usr/bin/electron'], false)).toEqual({});
  });
});

// macOS regains focus today. Sending it to the scheme as well would add an
// "Open MindsHub Cowork?" prompt on the one platform with no bug.
describe('authReturnUrl', () => {
  it('returns this build\'s callback URL on Windows', () => {
    expect(authReturnUrl('prod', 'win32')).toBe('mindshub-cowork://auth-done');
    expect(authReturnUrl('stable', 'win32')).toBe('mindshub-cowork-staging://auth-done');
  });

  it('sends darwin nowhere, so the working platform gains no prompt', () => {
    expect(authReturnUrl('prod', 'darwin')).toBeNull();
  });

  it('sends linux nowhere either', () => {
    expect(authReturnUrl('prod', 'linux')).toBeNull();
  });

  it('round-trips through the matcher the app checks incoming URLs with', () => {
    const url = authReturnUrl('preview', 'win32');
    expect(url).not.toBeNull();
    expect(isAuthCallbackUrl(url as string, 'preview')).toBe(true);
    expect(isAuthCallbackUrl(url as string, 'prod')).toBe(false);
  });
});

// The loser must never reach before-quit: that drain ends in
// killProcessOnPort, which matches on the port and would reap the running
// instance's sidecar rather than anything this process owns.
describe('claimSingleInstance', () => {
  function fakeApp(gotLock: boolean) {
    return {
      requestSingleInstanceLock: vi.fn(() => gotLock),
      exit: vi.fn(),
      quit: vi.fn(),
    };
  }

  it('carries on and touches neither exit nor quit when it owns the lock', () => {
    const app = fakeApp(true);
    expect(claimSingleInstance(app)).toBe(true);
    expect(app.exit).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('stands down through exit, never quit, when another instance holds it', () => {
    const app = fakeApp(false);
    expect(claimSingleInstance(app)).toBe(false);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.quit).not.toHaveBeenCalled();
  });
});

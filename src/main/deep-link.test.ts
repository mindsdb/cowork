import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { BUILD_KINDS } from './channels';
import { schemeForKind, protocolClientArgs, authReturnUrl, wireSingleInstance } from './deep-link';

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

  it('skips switches the dev launcher puts ahead of the script', () => {
    // package.json's dev:electron passes --ozone-platform=x11 on Linux.
    expect(protocolClientArgs(
      '/usr/bin/electron',
      ['/usr/bin/electron', '--ozone-platform=x11', 'dist/main/main/index.js'],
      false,
    )).toEqual({ execPath: '/usr/bin/electron', args: [path.resolve('dist/main/main/index.js')] });
  });

  it('degrades to no override when argv carries no script', () => {
    expect(protocolClientArgs('/usr/bin/electron', ['/usr/bin/electron'], false)).toEqual({});
    expect(protocolClientArgs('/usr/bin/electron', ['/usr/bin/electron', '--only-a-switch'], false)).toEqual({});
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

});

// The loser must never reach before-quit: that drain ends in
// killProcessOnPort, which matches on the port and would reap the running
// instance's sidecar rather than anything this process owns.
describe('wireSingleInstance', () => {
  function fakeApp(gotLock: boolean) {
    const listeners: Array<() => void> = [];
    return {
      listeners,
      requestSingleInstanceLock: vi.fn(() => gotLock),
      exit: vi.fn(),
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: () => void) => {
        listeners.push(listener);
        return undefined;
      }),
    };
  }

  it('wires the activation handler when it owns the lock', () => {
    const app = fakeApp(true);
    const onActivate = vi.fn();
    expect(wireSingleInstance(app, onActivate)).toBe(true);
    expect(app.exit).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.listeners).toHaveLength(1);

    app.listeners[0]();
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('stands down through exit, never quit, when another instance holds it', () => {
    const app = fakeApp(false);
    expect(wireSingleInstance(app, vi.fn())).toBe(false);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('registers nothing it is about to abandon', () => {
    const app = fakeApp(false);
    wireSingleInstance(app, vi.fn());
    expect(app.on).not.toHaveBeenCalled();
  });
});

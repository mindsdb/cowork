import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import {
  installHideOnClose,
  shouldHideOnClose,
  shouldQuitWhenAllWindowsClosed,
} from './window-close';

function fakeWindow({ fullScreen = false } = {}) {
  const emitter = new EventEmitter();
  const win = {
    on: (event: string, listener: (...args: any[]) => void) => emitter.on(event, listener),
    once: (event: string, listener: (...args: any[]) => void) => emitter.once(event, listener),
    isFullScreen: () => fullScreen,
    setFullScreen: vi.fn((flag: boolean) => {
      fullScreen = flag;
    }),
    hide: vi.fn(),
    show: vi.fn(),
  };
  const close = () => {
    const event = { preventDefault: vi.fn() };
    emitter.emit('close', event);
    return event;
  };
  // Electron finishes leaving full screen asynchronously, after the animation.
  const finishLeavingFullScreen = () => emitter.emit('leave-full-screen');
  return { win, close, finishLeavingFullScreen };
}

describe('shouldHideOnClose', () => {
  it('hides on macOS unless the app is quitting', () => {
    expect(shouldHideOnClose('darwin', false)).toBe(true);
    expect(shouldHideOnClose('darwin', true)).toBe(false);
  });

  it.each(['win32', 'linux'] as const)('never hides on %s', (platform) => {
    expect(shouldHideOnClose(platform, false)).toBe(false);
  });
});

describe('shouldQuitWhenAllWindowsClosed', () => {
  // Regression: macOS quit the whole app, sidecar included, when its window closed.
  it('keeps the app running on macOS', () => {
    expect(shouldQuitWhenAllWindowsClosed('darwin')).toBe(false);
  });

  it.each(['win32', 'linux'] as const)('quits on %s', (platform) => {
    expect(shouldQuitWhenAllWindowsClosed(platform)).toBe(true);
  });
});

describe('installHideOnClose', () => {
  it('hides the window instead of closing it on macOS', () => {
    const { win, close } = fakeWindow();
    installHideOnClose(win, 'darwin', () => false);

    const event = close();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it('lets the window close once the app is quitting', () => {
    let quitting = false;
    const { win, close } = fakeWindow();
    installHideOnClose(win, 'darwin', () => quitting);

    quitting = true;
    const event = close();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('leaves full screen before hiding', () => {
    const { win, close, finishLeavingFullScreen } = fakeWindow({ fullScreen: true });
    installHideOnClose(win, 'darwin', () => false);

    close();

    expect(win.setFullScreen).toHaveBeenCalledWith(false);
    expect(win.hide).not.toHaveBeenCalled();
    finishLeavingFullScreen();
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it('stays open when reopened before leaving full screen finishes', () => {
    const { win, close, finishLeavingFullScreen } = fakeWindow({ fullScreen: true });
    const { reopen } = installHideOnClose(win, 'darwin', () => false);

    close();
    expect(reopen()).toBe(true);
    finishLeavingFullScreen();

    expect(win.hide).not.toHaveBeenCalled();
    expect(reopen()).toBe(false);
  });

  it('lets the window close on Windows', () => {
    const { win, close } = fakeWindow();
    installHideOnClose(win, 'win32', () => false);

    const event = close();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('reopens a window that a close hid, once', () => {
    const { win, close } = fakeWindow();
    const { reopen } = installHideOnClose(win, 'darwin', () => false);

    close();

    expect(reopen()).toBe(true);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(reopen()).toBe(false);
  });

  // The Dock's activate event can fire during launch, before the first show.
  it('does not show a window that no close has hidden', () => {
    const { win } = fakeWindow();
    const { reopen } = installHideOnClose(win, 'darwin', () => false);

    expect(reopen()).toBe(false);
    expect(win.show).not.toHaveBeenCalled();
  });
});

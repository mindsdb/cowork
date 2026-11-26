import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_SHELL_VERSION,
  applyMobileShellDocument,
  detectMobileShell,
  isMobileShell,
  mobileShell,
  parseMobileShellUserAgent,
  shellNeedsUpdate,
  visualViewportStyle,
  withViewportFitCover,
} from './mobileShell';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

describe('parseMobileShellUserAgent', () => {
  it('reads the iOS shell marker and version', () => {
    expect(parseMobileShellUserAgent(`${SAFARI} MindsHubCowork-iOS/1.2.3`)).toEqual({ platform: 'ios', version: '1.2.3' });
  });

  it('reads the Android shell marker and version', () => {
    expect(parseMobileShellUserAgent(`${CHROME} MindsHubCowork-Android/2.0`)).toEqual({ platform: 'android', version: '2.0' });
  });

  it('finds the marker wherever the shell put it', () => {
    expect(parseMobileShellUserAgent(`MindsHubCowork-iOS/1.0.0 ${SAFARI}`)).toEqual({ platform: 'ios', version: '1.0.0' });
  });

  it('is null in a plain mobile browser, on desktop, and for missing input', () => {
    expect(parseMobileShellUserAgent(SAFARI)).toBeNull();
    expect(parseMobileShellUserAgent(CHROME)).toBeNull();
    expect(parseMobileShellUserAgent('Mozilla/5.0 (Macintosh) Electron/39.0.0')).toBeNull();
    expect(parseMobileShellUserAgent('')).toBeNull();
    expect(parseMobileShellUserAgent(undefined)).toBeNull();
    expect(parseMobileShellUserAgent(null)).toBeNull();
  });

  it('rejects look-alikes: other platforms, a missing version, a prefixed name', () => {
    expect(parseMobileShellUserAgent('MindsHubCowork-Windows/1.0.0')).toBeNull();
    expect(parseMobileShellUserAgent('MindsHubCowork-iOS/')).toBeNull();
    expect(parseMobileShellUserAgent('MindsHubCowork-ios/1.0.0')).toBeNull();
    expect(parseMobileShellUserAgent('NotMindsHubCowork-iOS/1.0.0')).toBeNull();
  });
});

describe('detectMobileShell', () => {
  it('reads the given navigator', () => {
    expect(detectMobileShell({ userAgent: `${SAFARI} MindsHubCowork-iOS/1.0.0` })).toEqual({ platform: 'ios', version: '1.0.0' });
    expect(detectMobileShell({ userAgent: SAFARI })).toBeNull();
    expect(detectMobileShell(undefined)).toBeNull();
  });

  it('is off in the test browser, which is not the app', () => {
    expect(mobileShell).toBeNull();
    expect(isMobileShell).toBe(false);
  });
});

describe('shellNeedsUpdate', () => {
  it('starts the minimum at 1.0.0', () => {
    expect(MIN_SHELL_VERSION).toBe('1.0.0');
  });

  it.each([
    ['0.9.9', '1.0.0', true],
    ['1.0.0', '1.0.0', false],
    ['1.0.1', '1.0.0', false],
    ['1.2', '1.2.0', false],
    ['1.2', '1.2.1', true],
    ['1.10.0', '1.9.0', false],
    ['2', '1.99.99', false],
    ['1.0.0.1', '1.0.0', false],
  ])('shell %s against minimum %s → %s', (shell, min, expected) => {
    expect(shellNeedsUpdate(shell, min)).toBe(expected);
  });

  it('asks an unreadable shell version to update', () => {
    expect(shellNeedsUpdate('', '1.0.0')).toBe(true);
    expect(shellNeedsUpdate('beta', '1.0.0')).toBe(true);
  });

  it('never locks anyone out over an unreadable minimum', () => {
    expect(shellNeedsUpdate('0.0.1', '')).toBe(false);
    expect(shellNeedsUpdate('0.0.1', 'one')).toBe(false);
  });
});

describe('withViewportFitCover', () => {
  it('adds viewport-fit=cover once', () => {
    expect(withViewportFitCover('width=device-width, initial-scale=1.0')).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
    expect(withViewportFitCover('width=device-width, viewport-fit=cover')).toBe('width=device-width, viewport-fit=cover');
    expect(withViewportFitCover('width=device-width,')).toBe('width=device-width, viewport-fit=cover');
    expect(withViewportFitCover('')).toBe('viewport-fit=cover');
  });
});

describe('applyMobileShellDocument', () => {
  afterEach(() => {
    delete document.documentElement.dataset.shell;
    delete document.documentElement.dataset.keyboard;
    document.documentElement.removeAttribute('style');
    document.head.querySelectorAll('meta[name="viewport"]').forEach((meta) => meta.remove());
  });

  it('marks <html> with the platform and covers the viewport', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0');
    document.head.appendChild(meta);

    applyMobileShellDocument({ platform: 'android', version: '1.0.0' });

    expect(document.documentElement.dataset.shell).toBe('android');
    expect(meta.getAttribute('content')).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
  });

  it('still marks <html> on a page without a viewport meta', () => {
    applyMobileShellDocument({ platform: 'ios', version: '1.0.0' });
    expect(document.documentElement.dataset.shell).toBe('ios');
  });
});

describe('visualViewportStyle', () => {
  it('fills the screen with no keyboard', () => {
    expect(visualViewportStyle({ height: 874, offsetTop: 0 }, 874)).toEqual({ height: '874px', top: '0px', keyboard: false });
  });

  it('shrinks to the visible box and follows the pan when the keyboard opens', () => {
    expect(visualViewportStyle({ height: 470.4, offsetTop: 120.6 }, 874)).toEqual({ height: '470px', top: '121px', keyboard: true });
  });

  it('ignores small height changes', () => {
    expect(visualViewportStyle({ height: 830, offsetTop: 0 }, 874).keyboard).toBe(false);
  });
});

describe('applyMobileShellDocument visual viewport', () => {
  afterEach(() => {
    delete document.documentElement.dataset.shell;
    delete document.documentElement.dataset.keyboard;
    document.documentElement.removeAttribute('style');
    delete (window as { visualViewport?: unknown }).visualViewport;
    delete (document.documentElement as { clientHeight?: number }).clientHeight;
    vi.restoreAllMocks();
  });

  it('keeps the shell variables in step with the keyboard', () => {
    const viewport = Object.assign(new EventTarget(), { height: 874, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 874 });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const root = document.documentElement;

    applyMobileShellDocument({ platform: 'ios', version: '1.0.0' });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue('--shell-viewport-height')).toBe('874px');
    expect(root.dataset.keyboard).toBeUndefined();

    viewport.height = 470;
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--shell-viewport-height')).toBe('470px');
    expect(root.style.getPropertyValue('--shell-viewport-top')).toBe('120px');
    expect(root.dataset.keyboard).toBe('open');
    // The page is panned back so nothing shows past its end.
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    viewport.height = 874;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    expect(root.dataset.keyboard).toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import {
  MIN_SHELL_VERSION,
  applyMobileShellDocument,
  detectMobileShell,
  isMobileShell,
  mobileShell,
  parseMobileShellUserAgent,
  shellNeedsUpdate,
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

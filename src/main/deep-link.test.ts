import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { APP_SCHEME, AUTH_CALLBACK_URL, isAuthCallbackUrl, protocolClientArgs, findDeepLink } from './deep-link';

// The callback page hands this URL to the browser, and the second instance
// hands it back on argv. Both halves have to agree or the handoff silently
// does nothing and the user is left on the "you're authorized" tab.
describe('isAuthCallbackUrl', () => {
  it('matches the URL the callback page actually emits', () => {
    expect(isAuthCallbackUrl(AUTH_CALLBACK_URL)).toBe(true);
  });

  it('tolerates the trailing slash a browser may add', () => {
    expect(isAuthCallbackUrl(`${APP_SCHEME}://auth-done/`)).toBe(true);
  });

  it('rejects a look-alike host rather than prefix-matching it', () => {
    expect(isAuthCallbackUrl(`${APP_SCHEME}://auth-done.example.com`)).toBe(false);
    expect(isAuthCallbackUrl(`${APP_SCHEME}://auth-done-evil`)).toBe(false);
  });

  it('rejects another application scheme carrying our host', () => {
    expect(isAuthCallbackUrl('other-app://auth-done')).toBe(false);
    expect(isAuthCallbackUrl('https://auth-done')).toBe(false);
  });

  it('returns false for input that is not a URL at all', () => {
    expect(isAuthCallbackUrl('')).toBe(false);
    expect(isAuthCallbackUrl('not a url')).toBe(false);
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

describe('findDeepLink', () => {
  it('finds the deep link among the argv Windows passes to the second instance', () => {
    expect(findDeepLink(['C:\\app.exe', '--flag', AUTH_CALLBACK_URL])).toBe(AUTH_CALLBACK_URL);
  });

  it('returns null for an ordinary launch', () => {
    expect(findDeepLink(['C:\\app.exe', '--flag'])).toBeNull();
  });

  it('ignores a foreign scheme in argv', () => {
    expect(findDeepLink(['C:\\app.exe', 'other-app://auth-done'])).toBeNull();
  });
});

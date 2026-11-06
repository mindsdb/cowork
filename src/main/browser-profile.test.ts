import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  browserProfilePath,
  browserUserAgent,
  browserViewPreferences,
  configureBrowserSession,
  ensureProfileDir,
  guardNavigation,
  PAGE_REQUEST_FILTER_URLS,
  isLinkLocalHost,
  isMindsHubHost,
  refusedDestination,
  navigationAllowed,
  reachesProtectedPort,
} from './browser-profile';

const dns: Record<string, string> = {
  '169.254.169.254.nip.io': '169.254.169.254',
  'instance-data.ec2.internal': '169.254.169.254',
  'mapped.test': '::ffff:169.254.169.254',
  'printer.lan': 'fe80::1',
  'loop.test': '127.0.0.1',
};

function fakeSession() {
  const handlers: Record<string, (...args: never[]) => unknown> = {};
  const events: Record<string, (...args: never[]) => unknown> = {};
  let requestFilter: { urls: string[] } | null = null;
  let requestListener: ((details: { url: string }, cb: (r: { cancel?: boolean }) => void) => void) | null = null;
  let userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) anton/2.0.7 Chrome/142.0.7444.59 Electron/39.8.10 Safari/537.36';
  const ses = {
    setPermissionRequestHandler: (h: never) => { handlers.request = h; },
    setPermissionCheckHandler: (h: never) => { handlers.check = h; },
    setDevicePermissionHandler: (h: never) => { handlers.device = h; },
    setDisplayMediaRequestHandler: (h: never) => { handlers.display = h; },
    on: (name: string, h: never) => { events[name] = h; },
    webRequest: {
      onBeforeRequest: (filter: { urls: string[] }, listener: typeof requestListener) => {
        requestFilter = filter;
        requestListener = listener;
      },
    },
    getUserAgent: () => userAgent,
    setUserAgent: (ua: string) => { userAgent = ua; },
    // Names a test points at an address; everything else answers a public one.
    resolveHost: vi.fn(async (host: string) => ({ endpoints: [{ address: dns[host] ?? '93.184.216.34', family: 'ipv4' }] })),
  };
  return {
    ses: ses as unknown as Session,
    handlers,
    events,
    filter: () => requestFilter,
    /* What the request listener decided, once it calls back: at once for a
       refused address, after a resolve for a name. */
    cancelled: (url: string) => new Promise<boolean>((resolve) => {
      requestListener!({ url }, (r) => resolve(r.cancel === true));
    }),
    userAgent: () => userAgent,
  };
}

describe('the profile folder', () => {
  it('sits under the account root and is owner-only, whatever the umask', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profile-'));
    const previous = process.umask(0o022);
    try {
      const dir = browserProfilePath(root);
      expect(dir).toBe(path.join(root, 'browser'));
      ensureProfileDir(dir);
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      fs.chmodSync(dir, 0o755);
      ensureProfileDir(dir);
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    } finally {
      process.umask(previous);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('view preferences', () => {
  it('are exactly the locked-down set, on the profile session', () => {
    const ses = {} as Session;
    expect(browserViewPreferences(ses)).toEqual({
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
      disableBlinkFeatures: 'AutomationControlled',
      backgroundThrottling: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: false,
    });
    expect(browserViewPreferences(ses)).not.toHaveProperty('preload');
  });
});

describe('the session lockdown', () => {
  const setup = () => {
    const fake = fakeSession();
    configureBrowserSession(fake.ses, { protectedPorts: () => [26866, 51234] });
    return fake;
  };

  it.each(['notifications', 'media', 'geolocation', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'openExternal'])('denies %s', (permission) => {
    const { handlers } = setup();
    const callback = vi.fn();
    (handlers.request as (...a: unknown[]) => void)({}, permission, callback, {});
    expect(callback).toHaveBeenCalledWith(false);
    expect((handlers.check as (...a: unknown[]) => boolean)({}, permission, 'https://a.test', {})).toBe(false);
  });

  it('denies devices and screen capture', () => {
    const { handlers, events } = setup();
    expect((handlers.device as (...a: unknown[]) => boolean)({ deviceType: 'usb' })).toBe(false);
    const display = vi.fn();
    (handlers.display as (...a: unknown[]) => void)({}, display);
    expect(display).toHaveBeenCalledWith({});
    const preventDefault = vi.fn();
    const pick = vi.fn();
    (events['select-hid-device'] as (...a: unknown[]) => void)({ preventDefault }, {}, pick);
    expect(preventDefault).toHaveBeenCalled();
    expect(pick).toHaveBeenCalledWith();
  });

  it('cancels page requests to the local server and the bridge, on any loopback name', async () => {
    const { cancelled, filter } = setup();
    expect(filter()!.urls).toEqual(PAGE_REQUEST_FILTER_URLS);
    for (const url of [
      'http://127.0.0.1:26866/api/v1/settings',
      'http://localhost:26866/',
      'http://app.localhost:51234/sessions',
      'ws://127.0.0.1:26866/ws',
      'http://[::1]:51234/healthz',
      'http://0.0.0.0:26866/',
      'http://localhost.:26866/',
      'http://x.localhost.:51234/',
      'http://[::ffff:127.0.0.1]:26866/',
      'http://127.1.2.3:26866/',
      'http://[::]:26866/',
    ]) {
      expect(await cancelled(url), url).toBe(true);
    }
    expect(await cancelled('http://127.0.0.1:3000/')).toBe(false);
  });

  it("cancels every request to MindsHub's own hosts, and leaves the apex, docs and look-alikes alone", async () => {
    const { cancelled } = setup();
    for (const url of [
      'https://cowork.mindshub.ai/',
      'https://console.mindshub.ai/keys',
      'https://app.staging.mindshub.ai/',
      'https://CONSOLE.MindsHub.AI./x',
      'wss://cowork.mindshub.ai/browser/x',
      'https://mdb.ai/',
      'https://llm.mdb.ai/v1',
      'https://4nton.ai/',
      'https://cw-123.4nton.ai/',
      'https://x.docs.mindshub.ai/',
      'https://api.mindshub.ai../',
    ]) {
      expect(await cancelled(url), url).toBe(true);
    }
    for (const url of ['https://mindshub.ai/', 'https://docs.mindshub.ai/guide', 'https://mindshub.ai.evil.com/', 'https://mindshub.co/a', 'https://mindsdb.com/', 'https://notmdb.ai/']) {
      expect(await cancelled(url), url).toBe(false);
    }
    expect(refusedDestination('https://cowork.mindshub.ai/')).toBe("MindsDB's sign-in and app hosts are blocked in this browser");
    expect(isMindsHubHost('Cowork.MindsHub.ai.')).toBe(true);
  });

  it('cancels link-local metadata addresses in every form, and keeps private ranges reachable', async () => {
    const { cancelled } = setup();
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://2852039166/',
      'http://0xa9fea9fe/',
      'http://[::ffff:169.254.169.254]/',
      'http://[fe80::1]/',
      'http://[febf::1]/',
      'http://metadata.google.internal/computeMetadata/v1/',
    ]) {
      expect(await cancelled(url), url).toBe(true);
    }
    for (const url of ['http://192.168.1.1/', 'http://10.0.0.8/', 'http://172.16.4.2/', 'http://[fd00::1]/', 'http://[fec0::1]/', 'http://169.255.0.1/', 'http://printer.local/']) {
      expect(await cancelled(url), url).toBe(false);
    }
    expect(isLinkLocalHost('[::ffff:a9fe:1]')).toBe(true);
    expect(isLinkLocalHost('[::ffff:a9ff:1]')).toBe(false);
    expect(refusedDestination('not a url')).toBe('that is not a valid address');
  });

  it('cancels a name that resolves to a link-local address, and lets a public one through', async () => {
    const { cancelled, ses } = setup();
    for (const url of ['http://169.254.169.254.nip.io/latest/meta-data/', 'http://instance-data.ec2.internal/', 'http://mapped.test/']) {
      expect(await cancelled(url), url).toBe(true);
    }
    expect(await cancelled('https://example.test/')).toBe(false);
    // A LAN name answering a link-local IPv6 address stays reachable.
    expect(await cancelled('http://printer.lan/')).toBe(false);
    // A name answering loopback is refused only on a protected port.
    expect(await cancelled('http://loop.test:26866/api/v1/settings')).toBe(true);
    expect(await cancelled('http://loop.test:3000/')).toBe(false);
    expect(await cancelled('http://192.168.1.1/')).toBe(false);
    expect((ses.resolveHost as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(([h]) => h === '192.168.1.1')).toBe(false);
  });

  it('leaves the LAN and other hosts alone', () => {
    expect(reachesProtectedPort('http://192.168.1.10:26866/', [26866])).toBe(false);
    expect(reachesProtectedPort('https://example.test:26866/', [26866])).toBe(false);
    expect(reachesProtectedPort('not a url', [26866])).toBe(false);
  });

  it('drops the app and Electron tokens from the user agent', () => {
    const { userAgent } = setup();
    expect(userAgent()).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36');
    expect(browserUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) MindsHubCowork/2.0.7 Chrome/142.0.0.0 Electron/39.8.10 Safari/537.36'))
      .not.toMatch(/Electron|MindsHub|Cowork/);
  });
});

describe('navigation', () => {
  it.each([
    ['https://example.test/', true],
    ['http://192.168.1.10:8080/', true],
    ['about:blank', true],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['chrome://settings', false],
    ['devtools://devtools/bundled/inspector.html', false],
  ])('%s is %s at the top level', (address, allowed) => {
    expect(navigationAllowed(address)).toBe(allowed);
  });

  it('stops a refused navigation and a refused main-frame redirect', () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    guardNavigation({ on: (name: string, h: (...args: unknown[]) => void) => { handlers[name] = h; } } as unknown as WebContents);
    const navigate = { preventDefault: vi.fn() };
    handlers['will-navigate'](navigate, 'file:///etc/passwd');
    expect(navigate.preventDefault).toHaveBeenCalled();
    const fine = { preventDefault: vi.fn() };
    handlers['will-navigate'](fine, 'https://example.test/');
    expect(fine.preventDefault).not.toHaveBeenCalled();
    const redirect = { preventDefault: vi.fn(), isMainFrame: true, url: 'chrome://settings' };
    handlers['will-redirect'](redirect);
    expect(redirect.preventDefault).toHaveBeenCalled();
    const webview = { preventDefault: vi.fn() };
    handlers['will-attach-webview'](webview);
    expect(webview.preventDefault).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// host.ts resolves `window.antontron` into module-level constants at IMPORT
// time (bridge/isElectron/isWeb), so every test must (1) set up or remove the
// bridge, (2) vi.resetModules(), (3) dynamically import a fresh copy.
async function importHost() {
  vi.resetModules();
  return await import('./host');
}

function setUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).antontron;
});

afterEach(() => {
  setUrl('http://localhost:3000/');
});

describe('web mode (no bridge)', () => {
  it('reports isWeb, platform "web", ui version "web"', async () => {
    const host = await importHost();
    expect(host.isElectron).toBe(false);
    expect(host.isWeb).toBe(true);
    expect(host.getPlatform()).toBe('web');
    expect(host.isMac()).toBe(false);
    await expect(host.getUIVersion()).resolves.toBe('web');
  });

  it('getApiOrigin is the page origin; localhost counts as local', async () => {
    const host = await importHost();
    expect(host.getApiOrigin()).toBe('http://localhost:3000');
    expect(host.isLocalApiOrigin()).toBe(true);
  });

  it('a non-loopback web origin is NOT local (server paths must not be shell-opened)', async () => {
    setUrl('https://cowork.example.com/app');
    const host = await importHost();
    expect(host.getApiOrigin()).toBe('https://cowork.example.com');
    expect(host.isLocalApiOrigin()).toBe(false);
  });

  it('OAuth uses the server-side redirect URL, not the IPC flow', async () => {
    const host = await importHost();
    expect(host.getOAuthRedirectUri('gmail')).toBe(
      'http://localhost:3000/api/v1/oauth/callback/gmail',
    );
    await expect(host.oauthConnect({} as never)).resolves.toMatchObject({ ok: false });
  });

  it('OS-level affordances return the documented unsupported shape', async () => {
    const host = await importHost();
    await expect(host.serverStart()).resolves.toEqual({ ok: false, reason: 'unsupported' });
    await expect(host.serverStop()).resolves.toEqual({ ok: false, reason: 'unsupported' });
    await expect(host.openPath('/tmp/x')).resolves.toEqual({ ok: false, reason: 'unsupported' });
    await expect(host.showItemInFolder('/tmp/x')).resolves.toEqual({ ok: false, reason: 'unsupported' });
    expect(host.getPathForFile(new File([], 'x.txt'))).toBeNull();
  });

  it('serverInfo reports the live origin as running (web host IS the server)', async () => {
    const host = await importHost();
    await expect(host.serverInfo()).resolves.toEqual({
      running: true,
      starting: false,
      port: 3000,
      origin: 'http://localhost:3000',
    });
  });

  it('openExternal falls back to window.open with noopener', async () => {
    const host = await importHost();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await host.openExternal('https://example.com');
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });

  it('MindsHub PKCE bridges refuse with a reason (web uses Keycloak redirect)', async () => {
    const host = await importHost();
    await expect(host.mindshubLogin()).resolves.toMatchObject({ ok: false });
    await expect(host.mindshubRefresh()).resolves.toMatchObject({ ok: false });
    await expect(host.mindshubFinalize()).resolves.toMatchObject({ ok: false });
  });
});

describe('electron mode (bridge present)', () => {
  it('detects the bridge and reports its platform', async () => {
    (window as unknown as Record<string, unknown>).antontron = { getPlatform: () => 'darwin' };
    const host = await importHost();
    expect(host.isElectron).toBe(true);
    expect(host.isWeb).toBe(false);
    expect(host.getPlatform()).toBe('darwin');
    expect(host.isMac()).toBe(true);
  });

  it('getApiOrigin under file:// uses the preload-supplied port, falling back to 26866', async () => {
    (window as unknown as Record<string, unknown>).antontron = { serverPort: 12345 };
    setUrl('file:///Applications/app/index.html');
    let host = await importHost();
    expect(host.getApiOrigin()).toBe('http://127.0.0.1:12345');

    (window as unknown as Record<string, unknown>).antontron = {}; // bridge without serverPort
    host = await importHost();
    expect(host.getApiOrigin()).toBe('http://127.0.0.1:26866');
    expect(host.isLocalApiOrigin()).toBe(true); // loopback → shell-openable
  });

  it('IPC flows are used: getOAuthRedirectUri is null, calls delegate to the bridge', async () => {
    const serverStart = vi.fn(async () => ({ ok: true }));
    const oauthConnect = vi.fn(async () => ({ ok: true, access_token: 't' }));
    (window as unknown as Record<string, unknown>).antontron = { serverStart, oauthConnect };
    const host = await importHost();

    expect(host.getOAuthRedirectUri('gmail')).toBeNull();
    await expect(host.serverStart()).resolves.toEqual({ ok: true });
    expect(serverStart).toHaveBeenCalledOnce();
    await expect(host.oauthConnect({ authUrl: 'a' } as never)).resolves.toMatchObject({ ok: true });
    expect(oauthConnect).toHaveBeenCalledWith({ authUrl: 'a' });
  });

  it('a partial bridge (method missing) falls back to the web stub, never throws', async () => {
    // OTA-updated renderers can be newer than the installed main process —
    // a bridge method added in a new UI must degrade, not crash.
    (window as unknown as Record<string, unknown>).antontron = {};
    const host = await importHost();
    expect(host.getPlatform()).toBe('web');
    await expect(host.serverStart()).resolves.toEqual({ ok: false, reason: 'unsupported' });
    await expect(host.getKeychainPref()).resolves.toBe(false);
    await expect(host.mindshubGetCachedToken()).resolves.toBeNull();
  });

  it('getUIVersion unwraps both string and {ui, app} object shapes', async () => {
    (window as unknown as Record<string, unknown>).antontron = { getUIVersion: async () => '1.2.3' };
    let host = await importHost();
    await expect(host.getUIVersion()).resolves.toBe('1.2.3');

    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ ui: '2.0.0', app: '1.0.0' }),
    };
    host = await importHost();
    await expect(host.getUIVersion()).resolves.toBe('2.0.0');
  });
});

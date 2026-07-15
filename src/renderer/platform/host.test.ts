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

  it('Browser Control degrades gracefully (no desktop bridge on web)', async () => {
    const host = await importHost();
    // status: unavailable + disconnected, never throws.
    await expect(host.browserControlStatus()).resolves.toEqual({
      available: false,
      state: 'disconnected',
    });
    // listTabs: empty + reason.
    await expect(host.browserControlListTabs()).resolves.toMatchObject({
      ok: false,
      tabs: [],
    });
    // attach/approve/cancel/revoke/takeOver: { ok:false, reason }.
    await expect(host.browserControlAttach('T1')).resolves.toMatchObject({ ok: false });
    await expect(host.browserControlApprove()).resolves.toMatchObject({ ok: false });
    await expect(host.browserControlCancelAttach()).resolves.toMatchObject({ ok: false });
    await expect(host.browserControlRevoke()).resolves.toMatchObject({ ok: false });
    await expect(host.browserControlTakeOver()).resolves.toMatchObject({ ok: false });
    await expect(host.browserControlSetConversation('C1')).resolves.toMatchObject({ ok: false });
    await expect(host.browserControlStop()).resolves.toMatchObject({ ok: false });
    // onBrowserControlState: no-op unsubscribe fn.
    const unsub = host.onBrowserControlState(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('getInstallationId returns null on web (no device id off-desktop)', async () => {
    const host = await importHost();
    await expect(host.getInstallationId()).resolves.toBeNull();
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

  it('Browser Control proxies to the bridge and onBrowserControlState delegates', async () => {
    const browserControlStatus = vi.fn(async () => ({
      available: true,
      state: 'connected',
      domain: 'example.com',
    }));
    const browserControlAttach = vi.fn(async () => ({ ok: true, state: 'awaiting-approval' }));
    const browserControlRevoke = vi.fn(async () => ({ ok: true }));
    const unsub = vi.fn();
    const onBrowserState = vi.fn(() => unsub);
    (window as unknown as Record<string, unknown>).antontron = {
      browserControlStatus,
      browserControlAttach,
      browserControlRevoke,
      onBrowserState,
    };
    const host = await importHost();

    await expect(host.browserControlStatus()).resolves.toMatchObject({
      available: true,
      state: 'connected',
    });
    await expect(host.browserControlAttach('T9')).resolves.toMatchObject({ ok: true });
    expect(browserControlAttach).toHaveBeenCalledWith('T9');
    await expect(host.browserControlRevoke()).resolves.toEqual({ ok: true });

    const cb = () => {};
    expect(host.onBrowserControlState(cb)).toBe(unsub);
    expect(onBrowserState).toHaveBeenCalledWith(cb);
  });

  it('getInstallationId proxies the bridge and coerces missing to null', async () => {
    (window as unknown as Record<string, unknown>).antontron = {
      getInstallationId: async () => 'aabbccddeeff0011',
    };
    let host = await importHost();
    await expect(host.getInstallationId()).resolves.toBe('aabbccddeeff0011');

    // Bridge present but the id is unavailable → null (never undefined).
    (window as unknown as Record<string, unknown>).antontron = {
      getInstallationId: async () => undefined,
    };
    host = await importHost();
    await expect(host.getInstallationId()).resolves.toBeNull();
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

  it('pickDriveFiles delegates to the bridge and returns its result', async () => {
    const oauthPickDriveFiles = vi.fn(async () => ({ ok: true, files: [], newFiles: [] }));
    (window as unknown as Record<string, unknown>).antontron = { oauthPickDriveFiles };
    const host = await importHost();

    const result = await host.pickDriveFiles('google_drive', 'my-conn', 'me@example.com', ['id1'], 'proj-1');
    expect(oauthPickDriveFiles).toHaveBeenCalledWith({
      engine: 'google_drive',
      name: 'my-conn',
      accountEmail: 'me@example.com',
      fileIds: ['id1'],
      projectName: 'proj-1',
    });
    expect(result).toEqual({ ok: true, files: [], newFiles: [] });
  });

  it('pickDriveFiles and cancelDrivePicker fall back to unsupported/no-op on web or a partial bridge', async () => {
    let host = await importHost(); // no bridge at all → web mode
    await expect(host.pickDriveFiles('google_drive', 'c', 'e@x.com')).resolves.toEqual({
      ok: false,
      reason: 'Google Picker is Electron-only for now.',
    });
    await expect(host.cancelDrivePicker()).resolves.toBeUndefined();

    (window as unknown as Record<string, unknown>).antontron = {}; // bridge present, method missing
    host = await importHost();
    await expect(host.pickDriveFiles('google_drive', 'c', 'e@x.com')).resolves.toMatchObject({ ok: false });
    await expect(host.cancelDrivePicker()).resolves.toBeUndefined();
  });

  it('cancelDrivePicker calls the bridge when present', async () => {
    const oauthCancelPicker = vi.fn(async () => {});
    (window as unknown as Record<string, unknown>).antontron = { oauthCancelPicker };
    const host = await importHost();

    await host.cancelDrivePicker();
    expect(oauthCancelPicker).toHaveBeenCalledOnce();
  });
  
  it('getVersionInfo reports app/ui/source distinctly (OTA never masks the shell)', async () => {
    // OTA active: ui is the cached bundle, app is the installed shell — kept
    // separate so the App row can't drift to the OTA version (ENG-213 / G1).
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.6.1', ui: '2.26.7.13.1', source: 'ota' }),
    };
    let host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({
      app: '2.26.7.6.1', ui: '2.26.7.13.1', source: 'ota',
    });

    // Bundled: no OTA cache → ui null, source 'bundled'.
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.6.1', ui: null, source: 'bundled' }),
    };
    host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({
      app: '2.26.7.6.1', ui: null, source: 'bundled',
    });
  });

  it('getVersionInfo degrades to web facts when the bridge lacks the method', async () => {
    (window as unknown as Record<string, unknown>).antontron = {}; // partial bridge
    const host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({ app: '', ui: null, source: 'web' });
  });

  it('getVersionInfo normalizes legacy shells that omit `source`', async () => {
    // Old bundled shape: `ui: 'bundled'` sentinel, no `source`. The sentinel is
    // not a version → ui null, source bundled (not the literal "bundled").
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.6.1', ui: 'bundled' }),
    };
    let host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({
      app: '2.26.7.6.1', ui: null, source: 'bundled',
    });

    // Old OTA shape: a real `ui` version but no `source` → infer OTA.
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.6.1', ui: '2.26.7.13.1' }),
    };
    host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({
      app: '2.26.7.6.1', ui: '2.26.7.13.1', source: 'ota',
    });
  });
});

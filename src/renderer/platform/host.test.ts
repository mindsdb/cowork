import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UpdateCoordinatorState } from '../../shared/update-coordinator';

// host.ts resolves `window.antontron` into module-level constants at IMPORT
// time (bridge/isElectron/isWeb), so every test must (1) set up or remove the
// bridge, (2) vi.resetModules(), (3) dynamically import a fresh copy.
/** The update state as a watcher sees it right now (null on web), read
 *  through the one public subscription. */
function stateNow(host: { watchUpdateState: (cb: (state: UpdateCoordinatorState) => void) => () => void }): UpdateCoordinatorState | null {
  let last: UpdateCoordinatorState | null = null;
  const off = host.watchUpdateState((state) => { last = state; });
  off();
  return last;
}

async function importHost() {
  vi.resetModules();
  return await import('./host');
}

// The web branches of logout()/getAccessToken() dynamically import
// ../lib/keycloak; mock it so tests never construct a real keycloak-js client
// (its module ctor touches window). getAccessToken returns null, matching real
// keycloak when unauthenticated — the state every test here runs under.
const keycloakMock = vi.hoisted(() => ({
  logout: vi.fn(async () => {}),
  getAccessToken: vi.fn(async () => null),
  listWebOrganizations: vi.fn(),
  switchWebOrganization: vi.fn(),
}));
vi.mock('../lib/keycloak', () => keycloakMock);

function setUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).antontron;
  keycloakMock.listWebOrganizations.mockReset();
  keycloakMock.switchWebOrganization.mockReset();
  keycloakMock.listWebOrganizations.mockResolvedValue({
    ok: true,
    orgs: [],
    activeOrgId: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUrl('http://localhost:3000/');
});

describe('logout()', () => {
  beforeEach(() => keycloakMock.logout.mockClear());

  it('ends the Keycloak session on web (no bridge)', async () => {
    const host = await importHost();
    await host.logout();
    expect(keycloakMock.logout).toHaveBeenCalledTimes(1);
  });

  it('uses the bridge on Electron and never touches Keycloak', async () => {
    const bridgeLogout = vi.fn(async () => {});
    (window as unknown as Record<string, unknown>).antontron = { logout: bridgeLogout };
    const host = await importHost();
    await host.logout();
    expect(bridgeLogout).toHaveBeenCalledTimes(1);
    expect(keycloakMock.logout).not.toHaveBeenCalled();
  });
});

describe('onMindsHubCredentialChanged()', () => {
  it('subscribes through preload and returns its cleanup', async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    (window as unknown as Record<string, unknown>).antontron = { onMindsHubCredentialChanged: subscribe };
    const host = await importHost();
    const listener = vi.fn();
    const cleanup = host.onMindsHubCredentialChanged(listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it.each(['web', 'older desktop'])('is safe on %s without the event bridge', async (shell) => {
    if (shell === 'older desktop') (window as unknown as Record<string, unknown>).antontron = {};
    const host = await importHost();
    const listener = vi.fn();
    host.onMindsHubCredentialChanged(listener)();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('MindsHub organizations', () => {
  const ORGS = [
    { id: 'org-acme', name: 'acme', displayName: 'Acme', isPersonal: false },
    { id: 'org-personal', name: 'personal_user-1', displayName: "user@example.com's organization", isPersonal: true },
  ];

  it('lists organizations through the browser Keycloak session on web', async () => {
    keycloakMock.listWebOrganizations.mockResolvedValue({
      ok: true,
      orgs: ORGS,
      activeOrgId: 'org-acme',
    });
    const host = await importHost();

    await expect(host.mindshubListOrgs()).resolves.toEqual({
      orgs: ORGS,
      activeOrgId: 'org-acme',
      reachable: true,
    });
    expect(keycloakMock.listWebOrganizations).toHaveBeenCalledOnce();
  });

  it('marks an unsettled web listing as unreachable so the hook can retry it', async () => {
    keycloakMock.listWebOrganizations.mockResolvedValue({ ok: false, reason: 'network down' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = await importHost();

    await expect(host.mindshubListOrgs()).resolves.toEqual({
      orgs: [],
      activeOrgId: null,
      reachable: false,
    });
  });

  it('switches on web and requires a reload after the tenant commits', async () => {
    keycloakMock.switchWebOrganization.mockResolvedValue({
      ok: true,
      activeOrgId: 'org-personal',
      reloadRequired: true,
      clearTenantState: true,
    });
    const host = await importHost();

    await expect(host.mindshubSwitchOrg('org-personal')).resolves.toEqual({
      ok: true,
      activeOrgId: 'org-personal',
      orgs: [],
      reloadRequired: true,
      clearTenantState: true,
    });
    expect(keycloakMock.switchWebOrganization).toHaveBeenCalledWith('org-personal');
  });

  it('keeps a definitive web refusal in place but reloads an indeterminate result', async () => {
    keycloakMock.switchWebOrganization
      .mockResolvedValueOnce({
        ok: false,
        reason: 'Not a member.',
        reloadRequired: false,
        clearTenantState: false,
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'Refresh failed.',
        reloadRequired: true,
        clearTenantState: true,
      });
    const host = await importHost();

    await expect(host.mindshubSwitchOrg('org-nope')).resolves.toMatchObject({
      ok: false,
      error: 'Not a member.',
      reloadRequired: false,
      clearTenantState: false,
    });
    await expect(host.mindshubSwitchOrg('org-personal')).resolves.toMatchObject({
      ok: false,
      error: 'Refresh failed.',
      reloadRequired: true,
      clearTenantState: true,
    });
  });

  it('uses the Electron bridge and never imports the web behavior', async () => {
    const mindshubListOrgs = vi.fn(async () => ({ orgs: ORGS, activeOrgId: 'org-acme' }));
    const mindshubSwitchOrg = vi.fn(async () => ({
      ok: true,
      orgs: ORGS,
      activeOrgId: 'org-personal',
    }));
    (window as unknown as Record<string, unknown>).antontron = {
      mindshubListOrgs,
      mindshubSwitchOrg,
    };
    const host = await importHost();

    await expect(host.mindshubListOrgs()).resolves.toEqual({ orgs: ORGS, activeOrgId: 'org-acme' });
    await expect(host.mindshubSwitchOrg('org-personal')).resolves.toMatchObject({
      ok: true,
      activeOrgId: 'org-personal',
    });
    expect(keycloakMock.listWebOrganizations).not.toHaveBeenCalled();
    expect(keycloakMock.switchWebOrganization).not.toHaveBeenCalled();
  });

  it('fails closed on an older Electron bridge instead of falling through to web', async () => {
    (window as unknown as Record<string, unknown>).antontron = {};
    const host = await importHost();

    await expect(host.mindshubListOrgs()).resolves.toEqual({ orgs: [], activeOrgId: null });
    await expect(host.mindshubSwitchOrg('org-personal')).resolves.toMatchObject({
      ok: false,
      error: 'Changing organization needs a newer desktop app.',
    });
    expect(keycloakMock.listWebOrganizations).not.toHaveBeenCalled();
    expect(keycloakMock.switchWebOrganization).not.toHaveBeenCalled();
  });
});

describe('mindshubFinalize() across shell versions', () => {
  // Renderer bundles update over the air while `src/main/**` only arrives when
  // the shell relaunches into a new build, so a newer renderer against an older
  // shell is routine (ENG-1047 bounds how much older, see getShellSupport). An
  // older shell's `mindshubFinalize` takes only `organizationId` and silently
  // drops a second argument, which is how an explicit pick would reach main
  // without the flag that protects it (ENG-2199).

  it('routes an explicit pick through the method that proves the shell carries it', async () => {
    const finalize = vi.fn(async () => ({ ok: true }));
    const finalizeChosen = vi.fn(async () => ({ ok: true }));
    (window as unknown as Record<string, unknown>).antontron = {
      mindshubFinalize: finalize,
      mindshubFinalizeChosen: finalizeChosen,
    };
    const host = await importHost();

    await host.mindshubFinalize('org-beta', true);

    expect(finalizeChosen).toHaveBeenCalledWith('org-beta');
    expect(finalize).not.toHaveBeenCalled();
    expect(host.canPickOrganization()).toBe(true);
  });

  it('reports an older shell as unable to take a pick', async () => {
    // The old bridge: `mindshubFinalize` present, the newer method absent.
    const finalize = vi.fn(async () => ({ ok: true }));
    (window as unknown as Record<string, unknown>).antontron = { mindshubFinalize: finalize };
    const host = await importHost();

    expect(host.canPickOrganization()).toBe(false);
  });

  it('still sends a no-pick finalize through the original method', async () => {
    const finalize = vi.fn(async () => ({ ok: true }));
    const finalizeChosen = vi.fn(async () => ({ ok: true }));
    (window as unknown as Record<string, unknown>).antontron = {
      mindshubFinalize: finalize,
      mindshubFinalizeChosen: finalizeChosen,
    };
    const host = await importHost();

    await host.mindshubFinalize();

    expect(finalize).toHaveBeenCalledWith(undefined, undefined);
    expect(finalizeChosen).not.toHaveBeenCalled();
  });
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

  it('codeModeAvailable is always false on web — no desktop capability bridge exists', async () => {
    const host = await importHost();
    expect(host.codeModeAvailable).toBe(false);
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
    await expect(host.serverStart()).resolves.toEqual({ running: false, error: 'unsupported' });
    await expect(host.serverStop()).resolves.toEqual({ running: false, error: 'unsupported' });
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
    await expect(host.mindshubSignup()).resolves.toMatchObject({ ok: false });
    await expect(host.mindshubRefresh()).resolves.toMatchObject({ ok: false });
    await expect(host.mindshubFinalize()).resolves.toMatchObject({ ok: false });
  });

  it('awaitBootReady is an immediate no-op without a bridge (ENG-749)', async () => {
    const host = await importHost();
    await expect(host.awaitBootReady()).resolves.toBeUndefined();
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

  it('codeModeAvailable mirrors the bridge value exactly — only literal true counts', async () => {
    (window as unknown as Record<string, unknown>).antontron = { codeModeAvailable: true };
    let host = await importHost();
    expect(host.codeModeAvailable).toBe(true);

    (window as unknown as Record<string, unknown>).antontron = { codeModeAvailable: false };
    host = await importHost();
    expect(host.codeModeAvailable).toBe(false);

    // Missing field (older/partial bridge) defaults to off, same as web.
    (window as unknown as Record<string, unknown>).antontron = {};
    host = await importHost();
    expect(host.codeModeAvailable).toBe(false);
  });

  it('getApiOrigin under file:// uses the preload-supplied port, falling back to 26866', async () => {
    (window as unknown as Record<string, unknown>).antontron = { serverPort: 12345 };
    setUrl('file:///Applications/app/index.html');
    let host = await importHost();
    expect(host.getApiOrigin()).toBe('http://127.0.0.1:12345');
    expect(host.getCodeControlPlaneOrigin()).toBe('http://127.0.0.1:12345');

    (window as unknown as Record<string, unknown>).antontron = {}; // bridge without serverPort
    host = await importHost();
    expect(host.getApiOrigin()).toBe('http://127.0.0.1:26866');
    expect(host.isLocalApiOrigin()).toBe(true); // loopback → shell-openable
  });

  it('uses a validated reachable control-plane origin for outbound Code runtimes', async () => {
    (window as unknown as Record<string, unknown>).antontron = {
      serverPort: 12345,
      codeControlPlaneOrigin: 'https://code.example.test',
    };
    setUrl('file:///Applications/app/index.html');
    const host = await importHost();
    expect(host.getCodeControlPlaneOrigin()).toBe('https://code.example.test');
  });

  it('rejects control-plane URLs with credentials or non-origin paths', async () => {
    (window as unknown as Record<string, unknown>).antontron = {
      serverPort: 12345,
      codeControlPlaneOrigin: 'https://user:secret@code.example.test/runtime',
    };
    setUrl('file:///Applications/app/index.html');
    const host = await importHost();
    expect(host.getCodeControlPlaneOrigin()).toBe('http://127.0.0.1:12345');
  });

  it('IPC flows are used: getOAuthRedirectUri is null, calls delegate to the bridge', async () => {
    const serverStart = vi.fn(async () => ({ running: true }));
    const oauthConnect = vi.fn(async () => ({ ok: true, access_token: 't' }));
    (window as unknown as Record<string, unknown>).antontron = { serverStart, oauthConnect };
    const host = await importHost();

    expect(host.getOAuthRedirectUri('gmail')).toBeNull();
    await expect(host.serverStart()).resolves.toEqual({ running: true });
    expect(serverStart).toHaveBeenCalledOnce();
    await expect(host.oauthConnect({ authUrl: 'a' } as never)).resolves.toMatchObject({ ok: true });
    expect(oauthConnect).toHaveBeenCalledWith({ authUrl: 'a' });
  });

  it('pickCodeFolder delegates to the desktop bridge and partial shells fail closed', async () => {
    const pickCodeFolder = vi.fn(async () => ({ ok: true, path: 'C:\\work\\repo' }));
    (window as unknown as Record<string, unknown>).antontron = { pickCodeFolder };
    let host = await importHost();
    await expect(host.pickCodeFolder()).resolves.toEqual({ ok: true, path: 'C:\\work\\repo' });
    expect(pickCodeFolder).toHaveBeenCalledOnce();

    (window as unknown as Record<string, unknown>).antontron = {};
    host = await importHost();
    await expect(host.pickCodeFolder()).resolves.toMatchObject({ ok: false });
  });

  it('a partial bridge (method missing) falls back to the web stub, never throws', async () => {
    // OTA-updated renderers can be newer than the installed main process —
    // a bridge method added in a new UI must degrade, not crash.
    (window as unknown as Record<string, unknown>).antontron = {};
    const host = await importHost();
    expect(host.getPlatform()).toBe('web');
    await expect(host.serverStart()).resolves.toEqual({ running: false, error: 'unsupported' });
    await expect(host.getKeychainPref()).resolves.toBe(false);
    await expect(host.mindshubGetCachedToken()).resolves.toBeNull();
  });

  it('awaitBootReady delegates to the bridge and resolves (ENG-749)', async () => {
    const awaitBootReady = vi.fn(async () => ({ ready: true }));
    (window as unknown as Record<string, unknown>).antontron = { awaitBootReady };
    const host = await importHost();
    await expect(host.awaitBootReady()).resolves.toBeUndefined();
    expect(awaitBootReady).toHaveBeenCalledOnce();
  });

  it('awaitBootReady stays gated while the bridge is pending — no renderer-side fail-open (ENG-749)', async () => {
    // The authoritative budget lives in main (boot-gate.ts). The renderer must
    // NOT race a shorter timeout, or a legitimately slow reinstall would release
    // the loading screen while the sidecar is still down. Advancing well past the
    // old 45s cap must not resolve the wait.
    vi.useFakeTimers();
    try {
      (window as unknown as Record<string, unknown>).antontron = {
        awaitBootReady: () => new Promise(() => {}),
      };
      const host = await importHost();
      let resolved = false;
      void host.awaitBootReady().then(() => { resolved = true; });
      // Well past the old 45s cap and the removed 780s main-side budget: the
      // renderer must stay gated for however long main's bounded poll takes.
      await vi.advanceTimersByTimeAsync(900_000);
      expect(resolved).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('the one update state (ENG-2296)', () => {
    const shell = (phase: string, over: Record<string, unknown> = {}) => ({ phase, mode: 'auto', channel: 'prod', currentVersion: '1.0.0', ...over });
    type Fn = ReturnType<typeof vi.fn>;
    const setBridge = (bridge: Record<string, unknown>) => {
      (window as unknown as Record<string, unknown>).antontron = bridge;
      return bridge as Record<string, Fn>;
    };
    /** A shell with UPDATE_STATE; `push` delivers a state from main. */
    const newerShell = (over: Record<string, unknown> = {}) => {
      const ctl = { push: (_s: unknown) => {}, off: vi.fn() };
      const bridge = setBridge({
        getUpdateState: vi.fn(async () => ({ action: null })),
        onUpdateState: vi.fn((cb: (s: unknown) => void) => { ctl.push = cb; return ctl.off; }),
        onUpdateStatus: vi.fn(),
        onShellAutoUpdate: vi.fn(),
        ...over,
      });
      return { ...ctl, bridge, push: (s: unknown) => ctl.push(s) };
    };
    /** A shell that predates UPDATE_STATE: the renderer composes the state from
     *  its OTA status and shell snapshot channels. */
    const olderShell = (over: Record<string, unknown> = {}) => {
      const cb: { ota: (s: unknown) => void; shell: (s: unknown) => void } = { ota: () => {}, shell: () => {} };
      const offs = { ota: vi.fn(), shell: vi.fn() };
      const bridge = setBridge({
        onUpdateStatus: vi.fn((fn: (s: unknown) => void) => { cb.ota = fn; return offs.ota; }),
        onShellAutoUpdate: vi.fn((fn: (s: unknown) => void) => { cb.shell = fn; return offs.shell; }),
        getShellAutoUpdate: vi.fn(async () => shell('idle')),
        getShellUpdate: vi.fn(async () => null),
        ...over,
      });
      return { bridge, offs, ota: (s: unknown) => cb.ota(s), shell: (s: unknown) => cb.shell(s) };
    };

    it('shares one bridge subscription across watchers on a newer shell, and tears it down with the last', async () => {
      const main = newerShell({ getUpdateState: vi.fn(async () => ({ action: 'relaunch' })), applyUpdates: vi.fn(async () => true) });
      const host = await importHost();
      const first = vi.fn();
      const second = vi.fn();
      const offFirst = host.watchUpdateState(first);
      const offSecond = host.watchUpdateState(second);
      await vi.waitFor(() => expect(first).toHaveBeenCalledWith({ action: 'relaunch' }));
      expect(second).toHaveBeenCalledWith({ action: 'relaunch' });
      expect(main.bridge.getUpdateState).toHaveBeenCalledTimes(1);
      expect(main.bridge.onUpdateState).toHaveBeenCalledTimes(1);
      expect(main.bridge.onUpdateStatus).not.toHaveBeenCalled();
      expect(main.bridge.onShellAutoUpdate).not.toHaveBeenCalled();
      offFirst();
      main.push({ action: 'reload' });
      expect(first).not.toHaveBeenLastCalledWith({ action: 'reload' });
      expect(second).toHaveBeenLastCalledWith({ action: 'reload' });
      offSecond();
      expect(main.off).toHaveBeenCalledOnce();
      host.watchUpdateState(vi.fn());
      expect(main.bridge.onUpdateState).toHaveBeenCalledTimes(2);
    });

    it.each<[string, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]>([
      ['revisions order them', { action: null, applying: 'downloading', revision: 5 }, { action: 'reload', applying: null, revision: 4 }, { action: null, applying: 'downloading', revision: 5 }],
      ['without revisions the push that landed first wins', { action: 'relaunch' }, { action: 'reload' }, { action: 'relaunch' }],
    ])('a mount-time pull that resolves after a push does not replace it: %s', async (_name, pushed, pulled, expected) => {
      let resolvePull!: (s: unknown) => void;
      const main = newerShell({ getUpdateState: vi.fn(() => new Promise((r) => { resolvePull = r; })) });
      const host = await importHost();
      const seen = vi.fn();
      host.watchUpdateState(seen);
      main.push(pushed);
      resolvePull(pulled);
      await new Promise((r) => setTimeout(r, 0));
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen).toHaveBeenLastCalledWith(expected);
      if (typeof pushed.revision === 'number') {
        main.push({ action: 'reload', revision: 3 });
        expect(seen).toHaveBeenCalledTimes(1);
        main.push({ action: 'reload', revision: 6 });
        expect(seen).toHaveBeenLastCalledWith({ action: 'reload', revision: 6 });
      }
    });

    it('sends the clicked action to main and passes a stale answer through', async () => {
      const main = newerShell({ applyUpdates: vi.fn(async () => 'stale') });
      const host = await importHost();
      expect(await host.applyUpdates({ action: 'download' })).toBe('stale');
      expect(main.bridge.applyUpdates).toHaveBeenCalledWith({ action: 'download' });
      expect(main.bridge.applyUpdates).toHaveBeenCalledTimes(1);
    });

    it('composes the same state on an older shell, registering its legacy listeners once and removing them with the last watcher', async () => {
      const old = olderShell({ applyUpdate: vi.fn(async () => true), installShellAutoUpdate: vi.fn(async () => true) });
      const host = await importHost();
      const seen = vi.fn();
      const offFirst = host.watchUpdateState(seen);
      const offSecond = host.watchUpdateState(vi.fn());
      expect(old.bridge.onUpdateStatus).toHaveBeenCalledTimes(1);
      expect(old.bridge.onShellAutoUpdate).toHaveBeenCalledTimes(1);
      expect(old.bridge.getShellAutoUpdate).toHaveBeenCalledTimes(1);
      expect(old.bridge.getShellUpdate).toHaveBeenCalledTimes(1);
      expect(seen.mock.calls[0][0]).toMatchObject({ action: null, applying: null });
      old.ota({ phase: 'available', version: '2.26.10.7.1' });
      expect(seen.mock.lastCall![0]).toMatchObject({ action: 'reload', ui: { status: 'ready', version: '2.26.10.7.1' } });
      old.shell(shell('ready-to-install', { targetVersion: '2.26.10.9.1' }));
      expect(seen.mock.lastCall![0]).toMatchObject({ action: 'relaunch', ui: { status: 'ready' } });
      await host.applyUpdates();
      expect(old.bridge.installShellAutoUpdate).toHaveBeenCalledWith({});
      expect(old.bridge.applyUpdate).not.toHaveBeenCalled();
      old.ota({ phase: 'shell-available', version: '2.26.10.9.1', downloadUrl: 'https://x/y.pkg' });
      expect(stateNow(host)!.shell.manual).toBe(false);
      old.shell(shell('idle'));
      expect(stateNow(host)!).toMatchObject({ action: 'open-download-page', shell: { manual: true, manualDownloadUrl: 'https://x/y.pkg' } });
      offFirst();
      expect(old.offs.ota).not.toHaveBeenCalled();
      offSecond();
      expect(old.offs.ota).toHaveBeenCalledOnce();
      expect(old.offs.shell).toHaveBeenCalledOnce();
    });

    it('on an older shell a reload shows progress and reports a failure from the composed state', async () => {
      const old = olderShell({ applyUpdate: vi.fn(async () => false) });
      const host = await importHost();
      const seen = vi.fn();
      host.watchUpdateState(seen);
      old.ota({ phase: 'available', version: 'ui-1' });
      expect(await host.applyUpdates()).toBe(false);
      expect(old.bridge.applyUpdate).toHaveBeenCalledOnce();
      expect(seen.mock.calls.map((c) => (c[0] as { ui: { status: string } }).ui.status)).toContain('applying');
      expect(seen.mock.lastCall![0]).toMatchObject({ action: 'reload', ui: { status: 'failed' } });
    });

    it('on an older shell the reload behind an installer notice runs only when named', async () => {
      const old = olderShell({ getShellAutoUpdate: vi.fn(async () => shell('disabled')), applyUpdate: vi.fn(async () => true) });
      const host = await importHost();
      host.watchUpdateState(vi.fn());
      old.ota({ phase: 'available', version: 'ui-1' });
      old.ota({ phase: 'shell-available', version: 'sh-2', downloadUrl: 'https://x/y.pkg' });
      expect(await host.applyUpdates()).toBe(false);
      expect(old.bridge.applyUpdate).not.toHaveBeenCalled();
      expect(await host.applyUpdates({ action: 'reload' })).toBe(true);
      expect(old.bridge.applyUpdate).toHaveBeenCalledOnce();
    });

    it('on an older shell a Download click the state no longer offers runs nothing', async () => {
      const old = olderShell({ installShellAutoUpdate: vi.fn(async () => true), downloadShellAutoUpdate: vi.fn(async () => shell('downloading')) });
      const host = await importHost();
      host.watchUpdateState(vi.fn());
      old.shell(shell('available', { mode: 'manual', targetVersion: 'v' }));
      old.shell(shell('ready-to-install', { mode: 'manual', targetVersion: 'v' }));
      expect(await host.applyUpdates({ action: 'download' })).toBe('stale');
      expect(old.bridge.installShellAutoUpdate).not.toHaveBeenCalled();
      expect(old.bridge.downloadShellAutoUpdate).not.toHaveBeenCalled();
      expect(await host.applyUpdates({ action: 'relaunch' })).toBe(true);
      expect(old.bridge.installShellAutoUpdate).toHaveBeenCalledOnce();
    });

    it('on an older shell a manual check feeds the offer, but never turns an auto-updater download into a stale notice', async () => {
      const summary = (over: Record<string, unknown>) => ({ ok: true, offline: false, updateAvailable: true, uiUpdateAvailable: false, serverUpdateAvailable: false, shellUpdateAvailable: false, ...over });
      const old = olderShell({ checkForUpdate: vi.fn(async () => ({ updateAvailable: true, newVersion: '2.26.10.7.1' })) });
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
      const host = await importHost();
      host.watchUpdateState(vi.fn());
      // A shell old enough to answer with the UI-only reply.
      await host.checkForUpdates();
      expect(stateNow(host)!).toMatchObject({ action: 'reload', ui: { status: 'ready', version: '2.26.10.7.1' } });
      // The summary flags the shell update the auto-updater is downloading.
      old.bridge.checkForUpdate.mockResolvedValue(summary({ shellUpdateAvailable: true, shellVersion: '2.26.10.9.1' }));
      old.shell(shell('downloading', { targetVersion: '2.26.10.9.1' }));
      await host.checkForUpdates();
      expect(stateNow(host)!.shell.manual).toBe(false);
      old.shell(shell('failed', { recoverable: true, errorCode: 'check-stalled' }));
      expect(stateNow(host)!.shell.manual).toBe(false);
      // With the auto-updater out of the picture the summary is the notice, and a no clears it.
      old.shell(shell('disabled'));
      await host.checkForUpdates();
      expect(stateNow(host)!).toMatchObject({ shell: { manual: true } });
      old.bridge.checkForUpdate.mockResolvedValue(summary({ updateAvailable: false }));
      await host.checkForUpdates();
      expect(stateNow(host)!.shell.manual).toBe(false);
    });

    it('publishes nothing on web', async () => {
      const host = await importHost();
      const seen = vi.fn();
      host.watchUpdateState(seen)();
      expect(seen).not.toHaveBeenCalled();
      expect(stateNow(host)).toBeNull();
      expect(await host.applyUpdates()).toBe(false);
    });
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

  it('cancelDrivePicker calls the bridge when present', async () => {
    const oauthCancelPicker = vi.fn(async () => {});
    (window as unknown as Record<string, unknown>).antontron = { oauthCancelPicker };
    const host = await importHost();

    await host.cancelDrivePicker();
    expect(oauthCancelPicker).toHaveBeenCalledOnce();
  });

  // ---- web Drive Picker (in-page overlay) --------------------------------
  //
  // The web flow renders Google's Picker inside the SPA's own already-
  // authenticated document. There is no second window anywhere in it, which
  // is what removed the whole class of popup-blocked / expired-click-
  // activation / header-less-navigation failures the previous design had.

  /** Installs a fake Google Picker SDK the way a real page load leaves it:
   *  the api.js <script> already in the document and `window.gapi` present,
   *  so host.ts takes its "already loaded" branch synchronously. Returns the
   *  hooks a test needs to drive the widget. */
  function installFakeGooglePicker() {
    const script = document.createElement('script');
    // Non-JS type so happy-dom's script loader ignores the src (it refuses
    // real network loads and would log a DOMException per test); host.ts
    // finds it by the src attribute either way.
    script.type = 'text/plain';
    script.setAttribute('src', 'https://apis.google.com/js/api.js');
    document.head.appendChild(script);

    const built: { callback?: (data: unknown) => void; visible: boolean[] } = { visible: [] };
    const builder: Record<string, unknown> = {};
    for (const method of ['setOAuthToken', 'setDeveloperKey', 'setAppId', 'setTitle', 'enableFeature', 'addView']) {
      builder[method] = vi.fn(() => builder);
    }
    builder.setCallback = vi.fn((cb: (data: unknown) => void) => { built.callback = cb; return builder; });
    builder.build = vi.fn(() => ({ setVisible: (v: boolean) => built.visible.push(v) }));

    class FakeDocsView {
      setFileIds() { return this; }
      setOwnedByMe() { return this; }
      setEnableDrives() { return this; }
    }

    (window as unknown as Record<string, unknown>).gapi = {
      load: (_name: string, opts: { callback: () => void }) => opts.callback(),
    };
    (window as unknown as Record<string, unknown>).google = {
      picker: {
        PickerBuilder: function PickerBuilder() { return builder; },
        DocsView: FakeDocsView,
        ViewId: { DOCS: 'docs' },
        Feature: { MULTISELECT_ENABLED: 'multi', SUPPORT_DRIVES: 'drives' },
        Action: { PICKED: 'picked', CANCEL: 'cancel', ERROR: 'error' },
      },
    };
    return { built, builder, cleanup: () => script.remove() };
  }

  /** fetch double: the token mint, then the picked-files PATCH. */
  function stubPickerFetch(patchImpl?: () => unknown) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/picker/token')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'live-token', api_key: 'picker-key',
            app_id: 'app-1', account_email: 'me@example.com',
          }),
        };
      }
      if (url.includes('/picked-files')) {
        if (patchImpl) return patchImpl();
        return { ok: true, json: async () => ({ ok: true, files: [{ id: 'f1', name: 'doc.pdf' }] }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    return calls;
  }

  it('pickDriveFiles on web renders the picker in-page and never opens a window', async () => {
    const { built, builder, cleanup } = installFakeGooglePicker();
    stubPickerFetch();
    const open = vi.spyOn(window, 'open');
    open.mockClear();
    const host = await importHost();

    const result = host.pickDriveFiles('google_drive', 'conn', 'me@example.com', undefined, 'proj-1');
    await vi.waitFor(() => expect(built.callback).toBeTypeOf('function'));

    // The whole point of this design: no popup, ever.
    expect(open).not.toHaveBeenCalled();
    expect(built.visible).toEqual([true]);
    expect(builder.setOAuthToken).toHaveBeenCalledWith('live-token');
    expect(builder.setDeveloperKey).toHaveBeenCalledWith('picker-key');
    expect(builder.setAppId).toHaveBeenCalledWith('app-1');

    built.callback!({ action: 'picked', docs: [{ id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf' }] });
    await expect(result).resolves.toMatchObject({
      ok: true,
      newFiles: [expect.objectContaining({ id: 'f1', name: 'doc.pdf' })],
    });
    cleanup();
  });

  it('a picked file is persisted to the connection before the pick reports success', async () => {
    const { built, cleanup } = installFakeGooglePicker();
    const calls = stubPickerFetch();
    const host = await importHost();

    const result = host.pickDriveFiles('google_drive', 'conn', 'me@example.com', undefined, 'proj-1');
    await vi.waitFor(() => expect(built.callback).toBeTypeOf('function'));
    built.callback!({ action: 'picked', docs: [{ id: 'f1', name: 'doc.pdf' }] });
    await result;

    // drive.file only covers files this app created, so the grant has to be
    // recorded server-side or the agent never learns the file exists.
    const patch = calls.find((c) => c.url.includes('/picked-files'));
    expect(patch?.init?.method).toBe('PATCH');
    expect(JSON.parse(patch!.init!.body as string)).toEqual({
      files: [expect.objectContaining({ id: 'f1', projects: ['proj-1'] })],
    });
  });

  it('a failed persist fails the whole pick — the UI must not show ungranted files as granted', async () => {
    const { built, cleanup } = installFakeGooglePicker();
    stubPickerFetch(() => ({ ok: false, status: 500, json: async () => ({ detail: 'nope' }) }));
    const host = await importHost();

    const result = host.pickDriveFiles('google_drive', 'conn', 'me@example.com');
    await vi.waitFor(() => expect(built.callback).toBeTypeOf('function'));
    built.callback!({ action: 'picked', docs: [{ id: 'f1', name: 'doc.pdf' }] });

    await expect(result).resolves.toMatchObject({ ok: false });
    cleanup();
  });

  it('a Cancel click resolves as a successful empty pick (matching Electron), and persists nothing', async () => {
    const { built, cleanup } = installFakeGooglePicker();
    const calls = stubPickerFetch();
    const host = await importHost();

    const result = host.pickDriveFiles('google_drive', 'conn', 'me@example.com');
    await vi.waitFor(() => expect(built.callback).toBeTypeOf('function'));
    built.callback!({ action: 'cancel' });

    await expect(result).resolves.toEqual({ ok: true, files: [], newFiles: [] });
    expect(calls.some((c) => c.url.includes('/picked-files'))).toBe(false);
    cleanup();
  });

  it('an in-widget ERROR resolves the pick instead of hanging it forever', async () => {
    // Without an Action.ERROR branch nothing settles the promise and the
    // caller waits forever. The common trigger is an active-account
    // mismatch: the widget renders under whichever Google account is
    // ambient in the browser, not the one the token is scoped to.
    const { built, cleanup } = installFakeGooglePicker();
    stubPickerFetch();
    const host = await importHost();

    const result = host.pickDriveFiles('google_drive', 'conn', 'me@example.com');
    await vi.waitFor(() => expect(built.callback).toBeTypeOf('function'));
    built.callback!({ action: 'error' });

    await expect(result).resolves.toMatchObject({ ok: false });
    expect((await result).reason).toMatch(/active Google account/);
    cleanup();
  });

  it('a picker that never reports anything is settled by the stuck backstop, not left hanging', async () => {
    // The failure the callback cannot see: a static Google 403 inside the
    // widget's iframe runs no picker JS, so PICKED/CANCEL/ERROR never fire.
    // The popup flow this replaced survived it because the user could close
    // the window; in-page there is nothing to close.
    vi.useFakeTimers();
    try {
      const { built, cleanup } = installFakeGooglePicker();
      stubPickerFetch();
      const host = await importHost();

      const result = host.pickDriveFiles('google_drive', 'conn', 'me@example.com');
      await vi.waitFor(() => expect(built.callback).toBeTypeOf('function'));
      // Nothing is ever reported by the widget.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      await expect(result).resolves.toMatchObject({ ok: false });
      expect((await result).reason).toMatch(/active Google account/);
      // The stuck widget is dismissed rather than left on screen.
      expect(built.visible).toEqual([true, false]);
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed drive file ids before minting a token, matching Electron', async () => {
    const { cleanup } = installFakeGooglePicker();
    const calls = stubPickerFetch();
    const host = await importHost();

    await expect(
      host.pickDriveFiles('google_drive', 'conn', 'me@example.com', ['../etc/passwd']),
    ).resolves.toMatchObject({ ok: false });
    // Rejected before any network call — same gate drive-picker-service.ts runs.
    expect(calls).toHaveLength(0);
    cleanup();
  });

  it('a failed token mint reports the failure and never loads the picker', async () => {
    const { built, cleanup } = installFakeGooglePicker();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 503, json: async () => ({ detail: 'Picker is not configured.' }),
    })));
    const host = await importHost();

    await expect(host.pickDriveFiles('google_drive', 'conn', 'me@example.com'))
      .resolves.toMatchObject({ ok: false, reason: 'Picker is not configured.' });
    expect(built.callback).toBeUndefined();
    cleanup();
  });

  it('cancelDrivePicker resolves an open in-page pick as cancelled', async () => {
    const { built, cleanup } = installFakeGooglePicker();
    stubPickerFetch();
    const host = await importHost();

    const result = host.pickDriveFiles('google_drive', 'conn', 'me@example.com');
    await vi.waitFor(() => expect(built.callback).toBeTypeOf('function'));

    await host.cancelDrivePicker();
    await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' });
    cleanup();
  });

  it('getVersionInfo reports app/ui/source distinctly (OTA never masks the shell)', async () => {
    // OTA active: ui is the cached bundle, app is the installed shell — kept
    // separate so the App row can't drift to the OTA version (ENG-213 / G1).
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.6.1', ui: '2.26.7.13.1', source: 'ota' }),
    };
    let host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({
      app: '2.26.7.6.1', ui: '2.26.7.13.1', source: 'ota', buildKind: null,
    });

    // Bundled: no OTA cache → ui null, source 'bundled'.
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.6.1', ui: null, source: 'bundled' }),
    };
    host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({
      app: '2.26.7.6.1', ui: null, source: 'bundled', buildKind: null,
    });
  });

  it('getShellUpdate maps the cached main status to the renderer shape when a reinstall is pending', async () => {
    (window as unknown as Record<string, unknown>).antontron = {
      getShellUpdate: async () => ({
        available: true, currentVersion: '2.26.7.13.1', latestVersion: '2.26.7.20.1', downloadUrl: 'https://x/y.pkg',
      }),
    };
    const host = await importHost();
    await expect(host.getShellUpdate()).resolves.toEqual({
      version: '2.26.7.20.1', currentVersion: '2.26.7.13.1', downloadUrl: 'https://x/y.pkg',
    });
  });

  it('getShellUpdate returns null when a new shell reports nothing pending', async () => {
    (window as unknown as Record<string, unknown>).antontron = { getShellUpdate: async () => ({ available: false }) };
    const host = await importHost();
    await expect(host.getShellUpdate()).resolves.toBeNull();
  });

  it('exposes getShellUpdate on the curated `host` object, not just as a named export', async () => {
    // App.jsx calls host.getShellUpdate() through the bundled `host` object; a
    // method present only as a named export would be a runtime TypeError there.
    (window as unknown as Record<string, unknown>).antontron = { getShellUpdate: async () => ({ available: false }) };
    const mod = await importHost();
    expect(typeof mod.host.getShellUpdate).toBe('function');
    await expect(mod.host.getShellUpdate()).resolves.toBeNull();
  });

  it('checkForUpdates normalizes the legacy UI-only reply from an older shell', async () => {
    // OTA renderers can be newer than main/preload. Older shells return the
    // original checkForUIUpdate shape, which has no `ok` discriminator.
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.20.1', ui: null, source: 'bundled' }),
      checkForUpdate: async () => ({
        updateAvailable: true,
        applied: false,
        newVersion: '2.26.7.20.1',
      }),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ shellVersion: '2.26.7.20.1' }),
    })));
    const host = await importHost();
    await expect(host.checkForUpdates()).resolves.toEqual({
      ok: true,
      offline: false,
      updateAvailable: true,
      uiUpdateAvailable: true,
      serverUpdateAvailable: false,
      shellUpdateAvailable: false,
      uiVersion: '2.26.7.20.1',
    });
  });

  it('falls back to a renderer-side manifest check on a shell too old for the bridge (ENG-1103)', async () => {
    // Old shell: a real bridge, but no getShellUpdate handler. This is the
    // cohort that would otherwise never be told a newer app version exists.
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.10.1', ui: null, source: 'bundled' }),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '2.26.7.10.1', url: 'u', sha256: 's', shellVersion: '2.26.7.20.1' }),
    })));
    const host = await importHost();
    await expect(host.getShellUpdate()).resolves.toEqual({ version: '2.26.7.20.1', currentVersion: '2.26.7.10.1' });
  });

  it('the renderer-side fallback fails closed: not-newer, missing shellVersion, or a bad fetch → null', async () => {
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.20.1', ui: null, source: 'bundled' }),
    };
    // Published shell equals installed → not strictly newer.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ shellVersion: '2.26.7.20.1' }) })));
    let host = await importHost();
    await expect(host.getShellUpdate()).resolves.toBeNull();
    // Manifest carries no shellVersion (a UI-only publish).
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: '2.26.7.30.1' }) })));
    host = await importHost();
    await expect(host.getShellUpdate()).resolves.toBeNull();
    // The fetch itself fails.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    host = await importHost();
    await expect(host.getShellUpdate()).resolves.toBeNull();
  });

  it('a new shell (bridge has getShellUpdate) never hits the network fallback', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ shellVersion: '9.26.9.9.9' }) }));
    vi.stubGlobal('fetch', fetchSpy);
    (window as unknown as Record<string, unknown>).antontron = { getShellUpdate: async () => ({ available: false }) };
    const host = await importHost();
    await expect(host.getShellUpdate()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a manual legacy check keeps a renderer-detected shell update in the unified result', async () => {
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.10.1', ui: null, source: 'bundled' }),
      checkForUpdate: async () => ({
        updateAvailable: false,
        applied: false,
      }),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ shellVersion: '2.26.7.20.1' }),
    })));
    const host = await importHost();
    await expect(host.checkForUpdates()).resolves.toEqual({
      ok: true,
      offline: false,
      updateAvailable: true,
      uiUpdateAvailable: false,
      serverUpdateAvailable: false,
      shellUpdateAvailable: true,
      shellVersion: '2.26.7.20.1',
    });
  });

  it('bridges the authoritative shell auto-update snapshot and commands', async () => {
    const snapshot = {
      phase: 'ready-to-install' as const,
      mode: 'auto' as const,
      channel: 'prod' as const,
      currentVersion: '2.260713.1',
      targetVersion: '2.260720.1',
    };
    const installShellAutoUpdate = vi.fn(async () => true);
    (window as unknown as Record<string, unknown>).antontron = {
      getShellAutoUpdate: async () => snapshot,
      installShellAutoUpdate,
    };
    const mod = await importHost();
    await expect(mod.host.getShellAutoUpdate()).resolves.toEqual(snapshot);
    await expect(mod.host.installShellAutoUpdate()).resolves.toBe(true);
    expect(installShellAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it('getVersionInfo degrades to web facts when the bridge lacks the method', async () => {
    (window as unknown as Record<string, unknown>).antontron = {}; // partial bridge
    const host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({ app: '', ui: null, source: 'web', buildKind: null });
  });

  it('getVersionInfo normalizes legacy shells that omit `source`', async () => {
    // Old bundled shape: `ui: 'bundled'` sentinel, no `source`. The sentinel is
    // not a version → ui null, source bundled (not the literal "bundled").
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.6.1', ui: 'bundled' }),
    };
    let host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({
      app: '2.26.7.6.1', ui: null, source: 'bundled', buildKind: null,
    });

    // Old OTA shape: a real `ui` version but no `source` → infer OTA.
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.7.6.1', ui: '2.26.7.13.1' }),
    };
    host = await importHost();
    await expect(host.getVersionInfo()).resolves.toEqual({
      app: '2.26.7.6.1', ui: '2.26.7.13.1', source: 'ota', buildKind: null,
    });
  });

  it('getVersionInfo passes through a known buildKind and nulls an unrecognized one', async () => {
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: 'x.y.z', ui: null, source: 'bundled', buildKind: 'stable' }),
    };
    let host = await importHost();
    await expect(host.getVersionInfo()).resolves.toMatchObject({ buildKind: 'stable' });

    // A kind this renderer doesn't know (newer shell) must not leak through
    // untyped — the UI treats unknown as absent.
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: 'x.y.z', ui: null, source: 'bundled', buildKind: 'canary' }),
    };
    host = await importHost();
    await expect(host.getVersionInfo()).resolves.toMatchObject({ buildKind: null });
  });
});

describe('web settings access — loopback-gated /raw (ENG-817)', () => {
  // In the console-hosted web build the browser reaches cowork-server from the
  // docker bridge, not loopback, so /settings/raw 403s. The .env is legacy and
  // the DB is authoritative, so these reads/writes must degrade, not throw —
  // otherwise boot/onboarding aborts (ENG-817).
  function stubStatus(status: number, detail = 'err') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status, json: async () => ({ detail }) })),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('readSettings degrades to {} on the expected loopback 403', async () => {
    stubStatus(403, 'local requests only');
    const host = await importHost();
    await expect(host.readSettings()).resolves.toEqual({});
  });

  it('saveSettings returns false (does not throw) on the expected loopback 403', async () => {
    stubStatus(403, 'local requests only');
    const host = await importHost();
    await expect(host.saveSettings('ANTON_TERMS_CONSENT=true')).resolves.toBe(false);
  });

  // Org mode's tenancy gate returns 501 and runs before the loopback check, so
  // hosted /raw answers 501, never 403. Degrading only 403 stranded every hosted
  // user on the auth screen (resolveBootTarget → 'auth' if a boot probe rejects).
  it('readSettings degrades to {} on the org-mode tenancy 501', async () => {
    stubStatus(501, 'not available in org deployments');
    const host = await importHost();
    await expect(host.readSettings()).resolves.toEqual({});
  });

  it('saveSettings returns false (does not throw) on the org-mode tenancy 501', async () => {
    stubStatus(501, 'not available in org deployments');
    const host = await importHost();
    await expect(host.saveSettings('ANTON_TERMS_CONSENT=true')).resolves.toBe(false);
  });

  // Only 403/501 degrade; real failures must stay observable so onboarding can't
  // report success over a failed write / read stale-empty.
  it('readSettings REJECTS on a non-403 failure (e.g. 500) — not silently empty', async () => {
    stubStatus(500);
    const host = await importHost();
    await expect(host.readSettings()).rejects.toThrow();
  });

  it('saveSettings REJECTS on a non-403 failure (e.g. 500) — not silently false', async () => {
    stubStatus(500);
    const host = await importHost();
    await expect(host.saveSettings('ANTON_X=1')).rejects.toThrow();
  });

  it('saveSettings REJECTS on a network error (fetch throws) — not silently false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    const host = await importHost();
    await expect(host.saveSettings('ANTON_X=1')).rejects.toThrow();
  });
});

describe('getShellSupport() — the supported desktop window (ENG-1047)', () => {
  // The UI bundle hot-updates while the shell waits for a relaunch, so this
  // check runs in the renderer and reads the installed shell over the bridge
  // and the newest published shell from the live manifest. It must show
  // nothing on web, on stable/preview, and whenever a version it needs cannot
  // be read — only a prod shell below the window gets a verdict of `too-old`.
  const manifest = (shellVersion: unknown) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ shellVersion }) }));

  it('judges a prod shell below the floor as too old', async () => {
    vi.stubGlobal('fetch', manifest('2.26.10.4.1'));
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.9.1.3', ui: '2.26.10.4.1', source: 'ota', buildKind: 'prod' }),
    };
    const host = await importHost();
    await expect(host.getShellSupport()).resolves.toMatchObject({
      status: 'too-old', reason: 'below-floor', shellVersion: '2.26.9.1.3', latestShellVersion: '2.26.10.4.1',
    });
  });

  it('judges the floor shell and the newest shell as supported, whatever the UI version', async () => {
    vi.stubGlobal('fetch', manifest('2.26.10.4.1'));
    (window as unknown as Record<string, unknown>).antontron = {
      // A legacy shell: no buildKind on the bridge reply.
      getUIVersion: async () => ({ app: '2.26.9.21.1', ui: '2.26.11.20.1', source: 'ota' }),
    };
    let host = await importHost();
    await expect(host.getShellSupport()).resolves.toMatchObject({ status: 'supported' });

    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.10.4.1', ui: null, source: 'bundled', buildKind: 'prod' }),
    };
    host = await importHost();
    await expect(host.getShellSupport()).resolves.toMatchObject({ status: 'supported', daysBehind: 0 });
  });

  it('never judges a stable or preview shell', async () => {
    vi.stubGlobal('fetch', manifest('2.26.10.4.1'));
    for (const buildKind of ['stable', 'preview']) {
      (window as unknown as Record<string, unknown>).antontron = {
        getUIVersion: async () => ({ app: '2.26.8.1.1-597-g0f28d663', ui: null, source: 'bundled', buildKind }),
      };
      const host = await importHost();
      await expect(host.getShellSupport()).resolves.toMatchObject({ status: 'not-applicable', reason: 'non-prod' });
    }
    // A stable shell too old to report its build kind still carries the
    // git-describe distance that a shipped prod shell never has.
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.8.1.1-597-g0f28d663', ui: null, source: 'bundled' }),
    };
    const host = await importHost();
    await expect(host.getShellSupport()).resolves.toMatchObject({ status: 'not-applicable', reason: 'untagged-shell' });
  });

  it('shows nothing when the installed version does not parse', async () => {
    vi.stubGlobal('fetch', manifest('2.26.10.4.1'));
    (window as unknown as Record<string, unknown>).antontron = {
      // The package.json fallback a never-stamped build reports (ENG-2988).
      getUIVersion: async () => ({ app: '2.0.7', ui: null, source: 'bundled' }),
    };
    const host = await importHost();
    await expect(host.getShellSupport()).resolves.toMatchObject({ status: 'not-applicable', reason: 'unparseable-shell' });
  });

  it('shows nothing when the manifest cannot be read or has no shellVersion', async () => {
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.9.1.3', ui: null, source: 'bundled', buildKind: 'prod' }),
    };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    let host = await importHost();
    await expect(host.getShellSupport()).resolves.toBeNull();

    vi.stubGlobal('fetch', manifest(undefined));
    host = await importHost();
    await expect(host.getShellSupport()).resolves.toBeNull();
  });

  it('is null on web, where there is no shell', async () => {
    vi.stubGlobal('fetch', manifest('2.26.10.4.1'));
    const host = await importHost();
    await expect(host.getShellSupport()).resolves.toBeNull();
  });

  it('fetches the manifest once per renderer for both the reinstall notice and the window check', async () => {
    const fetchMock = manifest('2.26.10.4.1');
    vi.stubGlobal('fetch', fetchMock);
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.9.1.3', ui: null, source: 'bundled', buildKind: 'prod' }),
    };
    const host = await importHost();
    await expect(host.getShellUpdate()).resolves.toMatchObject({ version: '2.26.10.4.1' });
    await expect(host.getShellSupport()).resolves.toMatchObject({ status: 'too-old' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-reads the manifest for an explicit check, so a shell published after launch is reported', async () => {
    // Legacy shells (no getShellUpdate bridge) reach the manifest through
    // Settings' Check for updates. The launch-time callers share one read, but
    // an explicit check must not be stuck on it.
    let shellVersion = '2.26.10.4.1';
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ shellVersion }) }));
    vi.stubGlobal('fetch', fetchMock);
    (window as unknown as Record<string, unknown>).antontron = {
      getUIVersion: async () => ({ app: '2.26.9.1.3', ui: null, source: 'bundled', buildKind: 'prod' }),
    };
    const host = await importHost();
    await expect(host.getShellUpdate()).resolves.toMatchObject({ version: '2.26.10.4.1' });
    await expect(host.getShellSupport()).resolves.toMatchObject({ latestShellVersion: '2.26.10.4.1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    shellVersion = '2.26.10.7.1';
    await expect(host.checkForUpdates()).resolves.toMatchObject({
      shellUpdateAvailable: true, shellVersion: '2.26.10.7.1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The fresh read becomes the shared one; a later mount-time read reuses it.
    await expect(host.getShellUpdate()).resolves.toMatchObject({ version: '2.26.10.7.1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is on the curated `host` object, which App.tsx and Settings call through', async () => {
    const mod = await importHost();
    expect(typeof mod.host.getShellSupport).toBe('function');
  });
});

import { describe, it, expect } from 'vitest';
import { resolveBootTarget, resolveRegistrationConsent, type BootHost } from './bootTarget';

const CONFIGURED = { configured: true, provider: 'minds_cloud' };
const INSTALLED = { antonInstalled: true, serverDepsReady: true };

function makeHost(over: Partial<BootHost> = {}): BootHost {
  return {
    readSettings: async () => ({}),
    checkConfigured: async () => CONFIGURED,
    checkInstall: async () => INSTALLED,
    awaitBootReady: async () => {},
    ...over,
  };
}

describe('resolveBootTarget', () => {
  // Hosted readSettings falls back to {} when its loopback-only endpoint is forbidden; local
  // consent plus configuration must still permit app boot.
  it('boots a configured instance to terminal when server settings are empty but local consent is set', async () => {
    const host = makeHost({ readSettings: async () => ({}) });
    expect((await resolveBootTarget(host, /* hasLocalConsent */ true)).target).toBe('terminal');
  });

  it('honors server-side consent when present (no local flag)', async () => {
    const host = makeHost({
      readSettings: async () => ({ ANTON_TERMS_CONSENT: 'true' }),
    });
    expect((await resolveBootTarget(host, /* hasLocalConsent */ false)).target).toBe('terminal');
  });

  // Hosted registration consent must survive a new browser/profile where neither server consent nor
  // localStorage is available.
  it('honors registration consent when server settings are empty and there is no local flag', async () => {
    const host = makeHost({ readSettings: async () => ({}) });
    expect(
      (await resolveBootTarget(host, /* hasLocalConsent */ false, /* hasRegistrationConsent */ true)).target,
    ).toBe('terminal');
  });

  it('still requires config_ready — an unconfigured instance goes to auth despite consent', async () => {
    const host = makeHost({
      checkConfigured: async () => ({ configured: false, provider: '' }),
    });
    expect((await resolveBootTarget(host, true)).target).toBe('auth');
  });

  it('routes to auth when not consented (no server flag, no local flag)', async () => {
    const host = makeHost({ readSettings: async () => ({}) });
    expect((await resolveBootTarget(host, false)).target).toBe('auth');
  });

  it('routes to setup when consented + configured but deps are not ready', async () => {
    const host = makeHost({
      readSettings: async () => ({ ANTON_TERMS_CONSENT: 'true' }),
      checkInstall: async () => ({ antonInstalled: false, serverDepsReady: false }),
    });
    expect((await resolveBootTarget(host, false)).target).toBe('setup');
  });

  // Keep the terminal route gated until boot-time server updates and restarts finish.
  it('holds the terminal route until awaitBootReady resolves', async () => {
    let released = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const host = makeHost({
      awaitBootReady: async () => { await gate; released = true; },
    });
    let settled = false;
    const routing = resolveBootTarget(host, true).then((t) => { settled = true; return t; });
    // Let the configured/installed checks flush; routing must still be pending
    // because the gate hasn't been released.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await routing).target).toBe('terminal');
    expect(released).toBe(true);
  });

  // The gate is only consulted on the terminal route: setup/auth must not pay it.
  it('does not await the boot gate on the setup route', async () => {
    let gateAwaited = false;
    const host = makeHost({
      readSettings: async () => ({ ANTON_TERMS_CONSENT: 'true' }),
      checkInstall: async () => ({ antonInstalled: false, serverDepsReady: false }),
      awaitBootReady: async () => { gateAwaited = true; },
    });
    expect((await resolveBootTarget(host, false)).target).toBe('setup');
    expect(gateAwaited).toBe(false);
  });

  // Real IPC/server failures route to auth; only host.ts degrades expected web loopback refusals.
  it('routes to auth when readSettings throws (e.g. Electron bridge failure)', async () => {
    const host = makeHost({
      readSettings: async () => {
        throw new Error('bridge failure');
      },
    });
    expect((await resolveBootTarget(host, true)).target).toBe('auth');
  });

  it('routes to auth when checkConfigured throws (server unreachable)', async () => {
    const host = makeHost({
      checkConfigured: async () => {
        throw new Error('network');
      },
    });
    expect((await resolveBootTarget(host, true)).target).toBe('auth');
  });

  // Cover both concurrent checks failing, independently of the single-failure cases.
  it('routes to auth when both readSettings and checkConfigured reject', async () => {
    const host = makeHost({
      readSettings: async () => {
        throw new Error('network');
      },
      checkConfigured: async () => {
        throw new Error('network');
      },
    });
    expect((await resolveBootTarget(host, true)).target).toBe('auth');
  });

  // Cross-awaited start barriers deadlock if readSettings and checkConfigured become serial,
  // proving they must overlap.
  it('runs readSettings and checkConfigured concurrently, not serially', async () => {
    let markSettingsStarted!: () => void;
    let markConfiguredStarted!: () => void;
    const settingsStarted = new Promise<void>((r) => {
      markSettingsStarted = r;
    });
    const configuredStarted = new Promise<void>((r) => {
      markConfiguredStarted = r;
    });
    const host = makeHost({
      readSettings: async () => {
        markSettingsStarted();
        await configuredStarted;
        return { ANTON_TERMS_CONSENT: 'true' };
      },
      checkConfigured: async () => {
        markConfiguredStarted();
        await settingsStarted;
        return CONFIGURED;
      },
    });
    expect((await resolveBootTarget(host, false)).target).toBe('terminal');
  });

  // Keep checkInstall conditional despite concurrent configuration reads; auth routing does not
  // need its request.
  it('does not call checkInstall when the instance is not configured', async () => {
    let installChecked = false;
    const host = makeHost({
      checkConfigured: async () => ({ configured: false, provider: '' }),
      checkInstall: async () => {
        installChecked = true;
        return INSTALLED;
      },
    });
    expect((await resolveBootTarget(host, true)).target).toBe('auth');
    expect(installChecked).toBe(false);
  });
});

describe('resolveBootTarget orgMode', () => {
  it('reports orgMode from checkConfigured', async () => {
    const host = makeHost({
      readSettings: async () => ({ ANTON_TERMS_CONSENT: 'true' }),
      checkConfigured: async () => ({ ...CONFIGURED, orgMode: true }),
    });
    const res = await resolveBootTarget(host, true);
    expect(res.target).toBe('terminal');
    expect(res.orgMode).toBe(true);
  });

  it('reports orgMode false when the deployment is standalone', async () => {
    const host = makeHost({ checkConfigured: async () => ({ ...CONFIGURED, orgMode: false }) });
    expect((await resolveBootTarget(host, true)).orgMode).toBe(false);
  });

  // A failed configuration check leaves mode unknown; treating it as standalone would expose
  // desktop actions in org mode.
  it('reports orgMode null when the health read failed', async () => {
    const host = makeHost({
      checkConfigured: async () => {
        throw new Error('offline');
      },
    });
    const res = await resolveBootTarget(host, true);
    expect(res.target).toBe('auth');
    expect(res.orgMode).toBe(null);
  });
});

describe('resolveRegistrationConsent', () => {
  // Assert the loader is untouched before the Electron early return; checking only the result would
  // allow keycloak-js to load unnecessarily.
  it('returns false on Electron without invoking the keycloak loader', async () => {
    let loaded = false;
    const load = async () => { loaded = true; return { keycloak: { authenticated: true } }; };

    expect(await resolveRegistrationConsent(/* isWeb */ false, load)).toBe(false);
    expect(loaded).toBe(false);
  });

  it('returns true on web when the keycloak session is authenticated', async () => {
    const load = async () => ({ keycloak: { authenticated: true } });
    expect(await resolveRegistrationConsent(true, load)).toBe(true);
  });

  it('returns false on web when there is no authenticated keycloak session', async () => {
    const load = async () => ({ keycloak: { authenticated: false } });
    expect(await resolveRegistrationConsent(true, load)).toBe(false);
  });

  // A chunk-load failure degrades to unconsented and routes to auth instead of escaping init and
  // stranding boot.
  it('returns false when the keycloak module fails to load', async () => {
    const load = async () => { throw new Error('chunk load failed'); };
    expect(await resolveRegistrationConsent(true, load)).toBe(false);
  });
});

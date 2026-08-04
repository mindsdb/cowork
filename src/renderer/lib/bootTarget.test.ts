import { describe, it, expect } from 'vitest';
import { resolveBootTarget, type BootHost } from './bootTarget';

const CONFIGURED = { configured: true, provider: 'minds_cloud' };
const INSTALLED = { antonInstalled: true, serverDepsReady: true };

function makeHost(over: Partial<BootHost> = {}): BootHost {
  return {
    readSettings: async () => ({}),
    checkConfigured: async () => CONFIGURED,
    checkInstall: async () => INSTALLED,
    ...over,
  };
}

describe('resolveBootTarget', () => {
  // ENG-817 regression: in the hosted web build /settings/raw is loopback-gated
  // and 403s, so host.readSettings degrades to {} (see host.ts). A configured
  // instance with local consent must still boot into the app — the empty server
  // settings must NOT strand it on the auth screen (the original inline logic
  // treated a readSettings failure as fatal → auth).
  it('boots a configured instance to terminal when server settings are empty but local consent is set', async () => {
    const host = makeHost({ readSettings: async () => ({}) });
    expect(await resolveBootTarget(host, /* hasLocalConsent */ true)).toBe('terminal');
  });

  it('honors server-side consent when present (no local flag)', async () => {
    const host = makeHost({
      readSettings: async () => ({ ANTON_TERMS_CONSENT: 'true' }),
    });
    expect(await resolveBootTarget(host, /* hasLocalConsent */ false)).toBe('terminal');
  });

  it('still requires config_ready — an unconfigured instance goes to auth despite consent', async () => {
    const host = makeHost({
      checkConfigured: async () => ({ configured: false, provider: '' }),
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
  });

  it('routes to auth when not consented (no server flag, no local flag)', async () => {
    const host = makeHost({ readSettings: async () => ({}) });
    expect(await resolveBootTarget(host, false)).toBe('auth');
  });

  it('routes to setup when consented + configured but deps are not ready', async () => {
    const host = makeHost({
      readSettings: async () => ({ ANTON_TERMS_CONSENT: 'true' }),
      checkInstall: async () => ({ antonInstalled: false, serverDepsReady: false }),
    });
    expect(await resolveBootTarget(host, false)).toBe('setup');
  });

  // A genuine failure (Electron IPC bridge error, or the server unreachable)
  // still routes to auth — only the web loopback-gated read is degraded, and
  // that happens in host.ts, not here.
  it('routes to auth when readSettings throws (e.g. Electron bridge failure)', async () => {
    const host = makeHost({
      readSettings: async () => {
        throw new Error('bridge failure');
      },
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
  });

  it('routes to auth when checkConfigured throws (server unreachable)', async () => {
    const host = makeHost({
      checkConfigured: async () => {
        throw new Error('network');
      },
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
  });

  // ENG-1232: when BOTH concurrent checks reject (server fully unreachable on
  // boot) we still route to auth — the single-rejection cases above don't cover
  // both failing at once.
  it('routes to auth when both readSettings and checkConfigured reject', async () => {
    const host = makeHost({
      readSettings: async () => {
        throw new Error('network');
      },
      checkConfigured: async () => {
        throw new Error('network');
      },
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
  });

  // ENG-1232: pin the parallelization — readSettings() and checkConfigured()
  // must be in flight at the same time. Each resolves only once BOTH have
  // started (via the cross-awaited "started" barriers), so a regression back to
  // serial awaits — where checkConfigured() isn't called until readSettings()
  // resolves — would deadlock and fail this test via timeout rather than pass
  // silently.
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
    expect(await resolveBootTarget(host, false)).toBe('terminal');
  });

  // ENG-1232: readSettings + checkConfigured now run concurrently to save an
  // ingress round-trip, but checkInstall stays conditional — the auth path (not
  // configured) must not pay an extra request for an install status it won't use.
  it('does not call checkInstall when the instance is not configured', async () => {
    let installChecked = false;
    const host = makeHost({
      checkConfigured: async () => ({ configured: false, provider: '' }),
      checkInstall: async () => {
        installChecked = true;
        return INSTALLED;
      },
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
    expect(installChecked).toBe(false);
  });
});

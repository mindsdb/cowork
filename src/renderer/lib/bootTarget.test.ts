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
  // ENG-817 regression: in the hosted web build readSettings() hits the
  // loopback-gated /settings/raw and 403s. That must NOT abort boot — a
  // configured instance with local consent still lands in the app, driven by
  // config_ready, not by the readSettings result.
  it('routes a configured instance to terminal even when readSettings() rejects (web /raw 403)', async () => {
    const host = makeHost({
      readSettings: async () => {
        throw new Error('HTTP 403');
      },
    });
    expect(await resolveBootTarget(host, /* hasLocalConsent */ true)).toBe('terminal');
  });

  it('still requires config_ready — an unconfigured instance goes to auth despite consent', async () => {
    const host = makeHost({
      readSettings: async () => {
        throw new Error('HTTP 403');
      },
      checkConfigured: async () => ({ configured: false, provider: '' }),
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
  });

  it('honors server-side consent when readSettings succeeds (no local flag)', async () => {
    const host = makeHost({
      readSettings: async () => ({ ANTON_TERMS_CONSENT: 'true' }),
    });
    expect(await resolveBootTarget(host, /* hasLocalConsent */ false)).toBe('terminal');
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

  it('routes to auth when the server is unreachable (checkConfigured throws)', async () => {
    const host = makeHost({
      checkConfigured: async () => {
        throw new Error('network');
      },
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
  });
});

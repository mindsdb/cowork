import { describe, it, expect } from 'vitest';
import { resolveBootTarget, type BootHost } from './bootTarget';

const CONFIGURED = { configured: true, provider: 'minds_cloud' };
const INSTALLED = { antonInstalled: true, serverDepsReady: true };

function makeHost(over: Partial<BootHost> = {}): BootHost {
  return {
    checkConfigured: async () => CONFIGURED,
    checkInstall: async () => INSTALLED,
    ...over,
  };
}

describe('resolveBootTarget', () => {
  // ENG-1127: consent comes only from the localStorage flag (no `.env`/
  // `/settings/raw` read). A configured instance with local consent boots into
  // the app.
  it('boots a configured instance to terminal when local consent is set', async () => {
    expect(await resolveBootTarget(makeHost(), /* hasLocalConsent */ true)).toBe('terminal');
  });

  it('still requires config_ready — an unconfigured instance goes to auth despite consent', async () => {
    const host = makeHost({
      checkConfigured: async () => ({ configured: false, provider: '' }),
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
  });

  it('routes to auth when not consented (no local flag), even if configured', async () => {
    expect(await resolveBootTarget(makeHost(), false)).toBe('auth');
  });

  it('routes to setup when consented + configured but deps are not ready', async () => {
    const host = makeHost({
      checkInstall: async () => ({ antonInstalled: false, serverDepsReady: false }),
    });
    expect(await resolveBootTarget(host, true)).toBe('setup');
  });

  it('routes to auth when checkConfigured throws (server unreachable)', async () => {
    const host = makeHost({
      checkConfigured: async () => {
        throw new Error('network');
      },
    });
    expect(await resolveBootTarget(host, true)).toBe('auth');
  });
});

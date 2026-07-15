// Boot-routing decision, extracted as a pure unit so it can be tested directly
// (see bootTarget.test.ts) — the ENG-817 regression lived in the inline version
// of this logic in App.tsx.

export type BootTarget = 'auth' | 'setup' | 'terminal';

// The minimal host surface the boot decision needs. Kept as its own interface
// so tests can pass a stub without the full platform bridge.
export interface BootHost {
  readSettings: () => Promise<Record<string, string>>;
  checkConfigured: () => Promise<{ configured: boolean; provider: string }>;
  checkInstall: () => Promise<{ antonInstalled: boolean; serverDepsReady: boolean }>;
}

/**
 * Decide the first screen after the welcome orb.
 *
 * `readSettings()` is **best-effort**: in the hosted web build it hits the
 * loopback-gated `/settings/raw` and 403s (ENG-817), because the browser's
 * request reaches cowork-server from the Docker bridge, not loopback. A failure
 * there must NOT abort the decision — `config_ready` (checkConfigured/health) is
 * the real readiness signal, and terms consent falls back to the client-side
 * flag. Only a failure of `checkConfigured`/`checkInstall` (server genuinely
 * unreachable) routes to `auth`.
 *
 * `hasLocalConsent` is the localStorage terms-consent flag, passed in so this
 * stays free of DOM/global access.
 */
export async function resolveBootTarget(
  host: BootHost,
  hasLocalConsent: boolean,
): Promise<BootTarget> {
  try {
    let serverConsent = false;
    try {
      const settings = await host.readSettings();
      serverConsent = settings.ANTON_TERMS_CONSENT === 'true';
    } catch {
      /* web: /settings/raw is loopback-gated (ENG-817); use the local flag */
    }
    const consented = serverConsent || hasLocalConsent;
    const { configured } = await host.checkConfigured();
    if (consented && configured) {
      const status = await host.checkInstall();
      return !status.antonInstalled || !status.serverDepsReady ? 'setup' : 'terminal';
    }
  } catch {
    return 'auth';
  }
  return 'auth';
}

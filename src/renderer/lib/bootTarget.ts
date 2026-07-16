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
 * Consent comes from server settings if present, else the client-side
 * localStorage flag (`hasLocalConsent`, passed in so this stays free of
 * DOM/global access). `config_ready` (checkConfigured/health) is the real
 * readiness signal.
 *
 * `host.readSettings()` is best-effort **at the host layer**: in the hosted web
 * build `/settings/raw` is loopback-gated and 403s (ENG-817), so host.ts
 * degrades it to `{}` rather than throwing — a gated read therefore can't strand
 * a configured instance on the auth screen. A genuine throw here (Electron IPC
 * bridge failure, or the server being unreachable) still routes to `auth`.
 */
export async function resolveBootTarget(
  host: BootHost,
  hasLocalConsent: boolean,
): Promise<BootTarget> {
  try {
    const settings = await host.readSettings();
    const consented = settings.ANTON_TERMS_CONSENT === 'true' || hasLocalConsent;
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

// Boot-routing decision, extracted as a pure unit so it can be tested directly
// (see bootTarget.test.ts) — the ENG-817 regression lived in the inline version
// of this logic in App.tsx.

export type BootTarget = 'auth' | 'setup' | 'terminal';

// The minimal host surface the boot decision needs. Kept as its own interface
// so tests can pass a stub without the full platform bridge.
export interface BootHost {
  checkConfigured: () => Promise<{ configured: boolean; provider: string }>;
  checkInstall: () => Promise<{ antonInstalled: boolean; serverDepsReady: boolean }>;
}

/**
 * Decide the first screen after the welcome orb.
 *
 * Consent comes only from the localStorage flag (`hasLocalConsent`, passed in
 * to stay free of DOM/global access) — ENG-1127 no longer reads it from
 * `.env`/`/settings/raw`. `config_ready` (checkConfigured/health) is the real
 * readiness signal; a genuine throw (IPC failure or unreachable server) routes
 * to `auth`.
 */
export async function resolveBootTarget(
  host: BootHost,
  hasLocalConsent: boolean,
): Promise<BootTarget> {
  try {
    const { configured } = await host.checkConfigured();
    if (hasLocalConsent && configured) {
      const status = await host.checkInstall();
      return !status.antonInstalled || !status.serverDepsReady ? 'setup' : 'terminal';
    }
  } catch {
    return 'auth';
  }
  return 'auth';
}

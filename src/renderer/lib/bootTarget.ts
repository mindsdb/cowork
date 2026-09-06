// Boot routing independent of the renderer.

export type BootTarget = 'auth' | 'setup' | 'terminal';

export interface BootDecision {
  target: BootTarget;
  /**
   * Null means health was unreadable; web callers must fail closed to org mode to avoid exposing
   * desktop-only actions.
   */
  orgMode: boolean | null;
}

// The minimal host surface the boot decision needs. Kept as its own interface
// so tests can pass a stub without the full platform bridge.
export interface BootHost {
  readSettings: () => Promise<Record<string, string>>;
  checkConfigured: () => Promise<{ configured: boolean; provider: string; orgMode?: boolean }>;
  checkInstall: () => Promise<{ antonInstalled: boolean; serverDepsReady: boolean }>;
  // Hold the loading screen through sidecar startup and the boot update poll before entering the
  // workspace.
  awaitBootReady: () => Promise<void>;
}

/**
 * Registration consent is web-only: short-circuit before loading Keycloak on Electron. Chunk-load
 * failures return false so boot can route to auth.
 */
export async function resolveRegistrationConsent(
  isWeb: boolean,
  loadKeycloak: () => Promise<{ keycloak: { authenticated?: boolean } }>,
): Promise<boolean> {
  if (!isWeb) return false;
  try {
    const { keycloak } = await loadKeycloak();
    return Boolean(keycloak.authenticated);
  } catch {
    return false;
  }
}

/**
 * Consent may come from settings, local storage or Keycloak registration; health config_ready
 * determines readiness. Hosted /settings/raw is loopback-gated and degrades to {} in host.ts, so
 * registration avoids per-browser consent repeats. Actual host-call failures route to auth.
 */
export async function resolveBootTarget(
  host: BootHost,
  hasLocalConsent: boolean,
  hasRegistrationConsent = false,
): Promise<BootDecision> {
  // Unknown until /health answers. Reported as null rather than false so the
  // caller can tell "standalone" apart from "could not find out".
  let orgMode: boolean | null = null;
  try {
    // Run independent host reads together; checkInstall stays conditional on readiness and consent.
    const [settings, configuredResult] = await Promise.all([
      host.readSettings(),
      host.checkConfigured(),
    ]);
    const { configured } = configuredResult;
    orgMode = Boolean(configuredResult.orgMode);
    const consented =
      settings.ANTON_TERMS_CONSENT === 'true' || hasLocalConsent || hasRegistrationConsent;
    if (consented && configured) {
      const status = await host.checkInstall();
      if (!status.antonInstalled || !status.serverDepsReady) return { target: 'setup', orgMode };
      // Wait through boot updates so the workspace cannot flash while its sidecar restarts.
      await host.awaitBootReady();
      return { target: 'terminal', orgMode };
    }
  } catch {
    return { target: 'auth', orgMode: null };
  }
  return { target: 'auth', orgMode };
}

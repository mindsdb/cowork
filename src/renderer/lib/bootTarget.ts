// Boot-routing decision, extracted as a pure unit so it can be tested directly
// (see bootTarget.test.ts) — the ENG-817 regression lived in the inline version
// of this logic in App.tsx.

export type BootTarget = 'auth' | 'setup' | 'terminal';

export interface BootDecision {
  target: BootTarget;
  /**
   * Whether the deployment is multi-tenant, or null when /health could not be
   * read. The caller decides the fail-safe for null: treating it as "standalone"
   * would render desktop-only artifact actions in an org deployment.
   */
  orgMode: boolean | null;
}

// The minimal host surface the boot decision needs. Kept as its own interface
// so tests can pass a stub without the full platform bridge.
export interface BootHost {
  readSettings: () => Promise<Record<string, string>>;
  checkConfigured: () => Promise<{ configured: boolean; provider: string; orgMode?: boolean }>;
  checkInstall: () => Promise<{ antonInstalled: boolean; serverDepsReady: boolean }>;
  // Resolves once the boot sequence (sidecar start + boot-time update poll) has
  // settled. Awaited only on the terminal route so the loading screen stays up
  // through a boot update instead of flashing the app (ENG-749).
  awaitBootReady: () => Promise<void>;
}

/**
 * Whether Keycloak registration already collected terms consent for this
 * session, for `resolveBootTarget`'s third consent source.
 *
 * `loadKeycloak` is injected rather than imported so this stays testable and,
 * more importantly, so the module is never pulled in on Electron: keycloak-js
 * is web-only, and every other call site imports it dynamically for the same
 * reason. The `isWeb` check must therefore short-circuit *before* the loader
 * is invoked.
 *
 * Never throws. A chunk-load failure degrades to "not consented", which routes
 * to auth rather than stranding the boot — same discipline as
 * `hasLocalTermsConsent` (ENG-848 review note).
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
 * Decide the first screen after the welcome orb.
 *
 * Consent comes from server settings if present, else the client-side
 * localStorage flag (`hasLocalConsent`), else registration
 * (`hasRegistrationConsent`). Both are passed in as plain booleans so this
 * stays free of DOM/global access. `config_ready` (checkConfigured/health) is
 * the real readiness signal.
 *
 * The third source exists because the first two cannot cover hosted web
 * (ENG-2167). `ANTON_TERMS_CONSENT` is written by the client and has no
 * server-side counterpart in cowork-server, and `/settings/raw` 403s there
 * anyway (see below), so `settings` is always `{}` — which leaves
 * localStorage as the only surviving source. That is per-browser, so the same
 * account on a second browser, a second device or a cleared profile was asked
 * to agree again. Keycloak registration already collects agreement to the same
 * Terms of Service and Privacy Policy that the in-app viewer renders, so it
 * counts here. Desktop and BYOK are unaffected: they pass `false` and keep
 * using the consent screen.
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
  hasRegistrationConsent = false,
): Promise<BootDecision> {
  // Unknown until /health answers. Reported as null rather than false so the
  // caller can tell "standalone" apart from "could not find out".
  let orgMode: boolean | null = null;
  try {
    // readSettings() and checkConfigured() are independent, so run them
    // concurrently — on web these are two ingress round-trips that used to be
    // serial, adding avoidable latency to every boot/refresh (ENG-1232). Routing
    // outcomes are unchanged: a rejection from either still rejects the
    // Promise.all and lands on 'auth' via the catch, exactly as the sequential
    // awaits did. Promise.all attaches a reject handler to both inputs, so even
    // when both reject (server fully unreachable) the sibling rejection is
    // handled — no unhandledrejection escapes. checkInstall() stays conditional
    // (only consulted once we know we're headed into the app) so the auth path
    // pays no extra request.
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
      // Headed into the app — but wait for the boot sequence to settle first, so
      // a pending boot-time update (which restarts the sidecar) doesn't flash the
      // chat UI in a server-down state before reloading (ENG-749). Fast when
      // nothing is pending.
      await host.awaitBootReady();
      return { target: 'terminal', orgMode };
    }
  } catch {
    return { target: 'auth', orgMode: null };
  }
  return { target: 'auth', orgMode };
}

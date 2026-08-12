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
    const consented = settings.ANTON_TERMS_CONSENT === 'true' || hasLocalConsent;
    if (consented && configured) {
      const status = await host.checkInstall();
      if (!status.antonInstalled || !status.serverDepsReady) return { target: 'setup', orgMode };
      // Configured + installed → headed into the app. Wait for the boot sequence
      // to settle first: a pending boot-time server/UI update restarts the
      // sidecar and reloads the window, and routing to 'terminal' before that
      // would flash the chat UI in a server-down "Connect a provider" state
      // (ENG-749). Fast when nothing is pending; host.awaitBootReady is
      // bounded by its own timeout so this can't hang the loading screen.
      await host.awaitBootReady();
      return { target: 'terminal', orgMode };
    }
  } catch {
    return { target: 'auth', orgMode: null };
  }
  return { target: 'auth', orgMode };
}

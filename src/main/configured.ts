// The "is this install configured?" decision behind boot routing and the
// SETTINGS_CHECK_CONFIGURED IPC, extracted from index.ts so it is unit-testable
// (index.ts is the electron entry point and can't be imported under the test env).
//
// Consent is deliberately NOT considered here. Since ENG-1127 the client no
// longer writes ANTON_TERMS_CONSENT to ~/.anton/.env, and cowork-server does not
// export it, so gating configured-ness on that variable would strand a
// consented, fully-configured user on the next launch (they finish onboarding,
// relaunch, and get bounced back to auth). Consent is owned solely by the
// renderer boot layer — see bootTarget.resolveBootTarget, which reads the
// localStorage flag and combines it with this signal.

export interface ConfiguredResult {
  configured: boolean;
  provider: string;
}

// The .env credential fallback, used ONLY when the server is unreachable. Pure
// so it can be asserted directly. Provider strings mirror the server's
// config_status vocabulary so the IPC value isn't path-dependent.
export function configuredFromEnv(vars: Record<string, string | undefined>): ConfiguredResult {
  if (vars.ANTON_MINDS_API_KEY) return { configured: true, provider: 'minds_cloud' };
  if (vars.ANTON_ANTHROPIC_API_KEY) return { configured: true, provider: 'anthropic' };
  if (vars.ANTON_OPENAI_API_KEY) return { configured: true, provider: 'openai' };
  return { configured: false, provider: '' };
}

// config_ready from /health is authoritative and is the SAME signal the in-app
// chat gate uses, so routing and the chat gate can't disagree. Fall back to the
// .env heuristic only when the server genuinely can't be reached, so a
// configured user isn't needlessly bounced to onboarding. No consent gate (see
// the module header) — that lives in the renderer boot layer.
export async function resolveConfigured(
  serverConfigured: () => Promise<ConfiguredResult | null>,
  readEnv: () => Record<string, string | undefined>,
): Promise<ConfiguredResult> {
  const fromServer = await serverConfigured();
  if (fromServer) return fromServer;
  return configuredFromEnv(readEnv());
}

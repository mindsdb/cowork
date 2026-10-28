// The boot-routing readiness answer behind SETTINGS_CHECK_CONFIGURED, pulled
// out of app.ts so the decision can be tested. app.ts wires the real calls in.

import { diagnostic } from '../shared/diagnostics';

export interface ConfiguredAnswer {
  configured: boolean;
  provider: string;
}

export interface ServerAnswer extends ConfiguredAnswer {
  mindsRuntimeCredentialRequired: boolean | null;
}

/**
 * What the sidecar said about readiness.
 *
 * `unreachable` covers every state where no sidecar could answer for the
 * current account yet. `other-account` is kept apart: the running sidecar
 * serves another account's root and could not be moved, so it may still be
 * serving that account's data.
 */
export type ServerReadiness =
  | { kind: 'answered'; answer: ServerAnswer }
  | { kind: 'unreachable' }
  | { kind: 'other-account' };

export interface SidecarProbe {
  isRunning: () => boolean;
  isStarting: () => boolean;
  isOnCurrentStores: () => boolean;
  /** `ensureSidecarOnCurrentAccountRoot`: restart onto the current root. */
  moveToCurrentRoot: () => Promise<boolean>;
  /** Read `/health`; null when it fails or has no `config_ready`. */
  readHealth: () => Promise<ServerAnswer | null>;
}

/**
 * Ask the sidecar for readiness, classifying why it could not answer.
 *
 * Inputs: the sidecar probe. Output: the readiness. Side effect: a sidecar on
 * another account's root is restarted onto the current one.
 */
export async function probeServerReadiness(probe: SidecarProbe): Promise<ServerReadiness> {
  if (!probe.isRunning() || probe.isStarting()) return { kind: 'unreachable' };
  // Never read readiness off a sidecar serving another account's database. The
  // account is recorded at the auth choke point, long before a sign-in reaches
  // commitMindsSignIn — and some never reach it — so without this a reload in
  // that window routes straight into the previous account's data.
  if (!probe.isOnCurrentStores()) {
    let moved = false;
    try {
      moved = await probe.moveToCurrentRoot();
    } catch (err) {
      diagnostic("main.boot-configured", "WARNING", "boot_configured_could_not_move_the_sidecar_onto_this_account_root", '[checkConfigured] could not move the sidecar onto this account root', err);
    }
    if (!moved) return { kind: 'other-account' };
  }
  const answer = await probe.readHealth();
  return answer ? { kind: 'answered', answer } : { kind: 'unreachable' };
}

export interface ConfiguredInputs {
  env: Record<string, string | undefined>;
  signOutRoutingActive: () => boolean;
  readServer: () => Promise<ServerReadiness>;
}

/**
 * Decide whether boot routing may enter the app.
 *
 * Inputs: the `.env` vars, the sign-out latch, and a server read that runs only
 * when consent and the latch allow it. Output: `{ configured, provider }`.
 */
export async function decideConfigured(inputs: ConfiguredInputs): Promise<ConfiguredAnswer> {
  const { env } = inputs;
  if (env.ANTON_TERMS_CONSENT !== 'true') return { configured: false, provider: '' };
  /*
   * A sign-out in flight is a definite answer, and it comes before both reads
   * below. Sign-out now replies and reloads while its sidecar restart is still
   * running, so the reloaded page can reach a sidecar that has not stopped yet
   * and hear `config_ready: true` from it — which would route the person who
   * just signed out straight back into the app.
   */
  if (inputs.signOutRoutingActive()) return { configured: false, provider: '' };
  // config_ready from /health is authoritative and is the SAME signal the
  // in-app chat gate uses — defer to it so routing and the chat gate can't
  // disagree. (The old .env any-key check could pass here while config_ready
  // was false, stranding the user on "Connect a provider" with no recovery.)
  const server = await inputs.readServer();
  if (server.kind === 'answered') return server.answer;
  // Server genuinely unreachable: fall back to the .env heuristic so a
  // configured user isn't needlessly bounced to onboarding. Provider strings
  // mirror the server's config_status vocabulary so the IPC value isn't
  // path-dependent.
  if (env.ANTON_MINDS_API_KEY) return { configured: true, provider: 'minds_cloud' };
  if (env.ANTON_ANTHROPIC_API_KEY) return { configured: true, provider: 'anthropic' };
  if (env.ANTON_OPENAI_API_KEY) return { configured: true, provider: 'openai' };
  return { configured: false, provider: '' };
}

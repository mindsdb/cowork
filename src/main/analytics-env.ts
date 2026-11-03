// Where the anton inside the spawned cowork-server sends its analytics, and how
// it labels them. Pure, so the rule is tested per build kind without a spawn.
import type { BuildKind } from './channels';

// The non-production PostHog project. A project token can only write events
// and ships in every page that loads PostHog, so it is not a secret.
export const NON_PROD_POSTHOG_KEY = 'phc_zBzpZzh8kCPVpKeVyRRLNSfyTisRfLCq8SPhtiTHZway';

// What anton stamps on each event as `environment`. `stable` is the staging
// ring, so it says so.
const DEPLOYMENT_LABEL: Record<BuildKind, string> = {
  dev: 'dev',
  preview: 'preview',
  stable: 'staging',
  prod: 'prod',
};

/** Only prod builds count as real users' turns: every other kind sends to the
 *  non-production project instead of anton's built-in production one. A value
 *  already in `env` is left alone, so a developer can still point a run
 *  elsewhere. */
export function analyticsEnv(kind: BuildKind, env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  if (kind !== 'prod' && !env.ANTON_POSTHOG_KEY) out.ANTON_POSTHOG_KEY = NON_PROD_POSTHOG_KEY;
  if (!env.ANTON_DEPLOYMENT_ENV) out.ANTON_DEPLOYMENT_ENV = DEPLOYMENT_LABEL[kind];
  return out;
}

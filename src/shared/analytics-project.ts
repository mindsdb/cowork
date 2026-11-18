// Which PostHog project a desktop build reports to. One rule for both streams
// that leave a desktop install: the app's own events (renderer) and the turn
// events of the anton it spawns (main, analytics-env.ts).

// The non-production project. A project token can only write events and ships
// in every page that loads PostHog, so it is not a secret.
export const NON_PROD_POSTHOG_KEY = 'phc_zBzpZzh8kCPVpKeVyRRLNSfyTisRfLCq8SPhtiTHZway';

/** Only prod builds count as real users: any other build kind reports to the
 *  non-production project. An unknown kind (web, or a shell too old to report
 *  one) keeps `prodKey`, so nothing a production install sends moves. */
export function posthogKeyForBuildKind(kind: string | null | undefined, prodKey: string): string {
  if (!kind || kind === 'prod') return prodKey;
  return NON_PROD_POSTHOG_KEY;
}

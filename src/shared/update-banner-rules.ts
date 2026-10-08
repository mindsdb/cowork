// The two shell-first rules both the coordinator and the banner read, kept in
// a leaf module so neither has to import the other.

/** Shell auto-updater phases that can own the update slot. Passive phases
 *  (disabled/idle/checking/complete) surface nothing. `failed` is conditional:
 *  it owns the slot only with a known target (see shellAutoIsPending). */
export const SHELL_AUTO_BANNER_PHASES = [
  'available',
  'downloading',
  'ready-to-install',
  'installing',
  'failed',
] as const;

/** Shell failure codes that describe a check which produced no answer: the
 *  updater stalled, and no update was found or lost. They exist so the next
 *  scheduled check can run; there is nothing for the user to retry, so they
 *  raise no banner. */
export const CHECK_ONLY_FAILURE_CODES = ['check-stalled'] as const;

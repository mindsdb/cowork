// A leaf module so the coordinator and the banner need not import each other.

/** `failed` owns the slot only with a known target (see shellAutoIsPending). */
export const SHELL_AUTO_BANNER_PHASES = [
  'available',
  'downloading',
  'ready-to-install',
  'installing',
  'failed',
] as const;

/** A check that produced no answer: nothing to retry, so no banner. */
export const CHECK_ONLY_FAILURE_CODES = ['check-stalled'] as const;

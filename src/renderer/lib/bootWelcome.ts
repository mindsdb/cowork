// Keep a minimum welcome-orb duration on cold boots, but skip it on returning web visits so refresh
// adds no artificial delay.

const BOOTED_KEY = 'anton.booted';

// Storage-denied contexts retain the first-boot delay instead of aborting initialization.
export function hasBootedBefore(): boolean {
  try {
    return typeof window !== 'undefined'
      && window.localStorage.getItem(BOOTED_KEY) === 'true';
  } catch {
    return false;
  }
}

// Record that the boot sequence has completed once in this browser. Best-effort:
// a storage failure just means the next refresh keeps the (harmless) floor.
export function rememberBooted(): void {
  try { window.localStorage.setItem(BOOTED_KEY, 'true'); } catch {}
}

/**
 * Remaining welcome delay: zero for returning web visits; otherwise hold only until the minimum
 * duration.
 */
export function welcomeFloorMs(opts: {
  isWeb: boolean;
  bootedBefore: boolean;
  elapsedMs: number;
  minMs: number;
}): number {
  if (opts.isWeb && opts.bootedBefore) return 0;
  return Math.max(0, opts.minMs - opts.elapsedMs);
}

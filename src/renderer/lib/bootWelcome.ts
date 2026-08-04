// Welcome-orb timing for the boot sequence, extracted as pure/isolated units so
// the decision is testable without rendering App (see bootWelcome.test.ts).
//
// The welcome orb has a minimum on-screen time (WELCOME_MIN_MS in App.tsx) whose
// only job is to avoid a jarring flash on a genuine cold start. Electron gates
// on isWeb below so it always keeps that floor (it rarely re-mounts anyway —
// only on things like a sign-out reload). On web the SPA re-mounts on every
// browser refresh, so that artificial floor was replaying in
// full on every reload — pure added latency on top of the boot health checks
// (ENG-1232). A refresh of an already-booted web session is not a cold start, so
// once this browser has booted once we skip the floor and let the orb show only
// as long as the real checks take.

const BOOTED_KEY = 'anton.booted';

// True once this browser has completed the boot sequence at least once. Wrapped
// in try/catch so a storage-denied context (private mode, disabled storage) just
// reports "not booted" and keeps the polished first-boot floor rather than
// throwing out of the init effect.
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
 * How long to keep the welcome orb up before routing onward, given how long the
 * boot checks already took.
 *
 * - Web, already booted once → 0: no artificial floor on a refresh; the orb was
 *   on screen for the duration of the checks and that's enough (ENG-1232).
 * - Otherwise (first web visit, or any Electron launch) → hold to the minimum so
 *   a fast boot doesn't flash the orb.
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

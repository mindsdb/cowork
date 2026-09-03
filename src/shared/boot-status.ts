// The progress line under the welcome orb while the loading screen is held open
// through a boot-time update (ENG-749). One pure derivation so the boot overlay
// stops being blind to the shell channel: it used to read only the OTA status
// (`UI_UPDATE_STATUS`) and could show the completion-ish "Almost ready…" while a
// shell update still needed a relaunch to take effect. Feeding the OTA phase,
// the shell-auto phase, and the manual shell-reinstall notice here keeps the
// overlay honest (ENG-2296), and is the first step toward one update coordinator
// all three surfaces read from.
//
// This is presentation only — it never decides *whether* to update, just what
// the loading screen says while one is in flight.

export interface BootStatusInput {
  /** OTA (UI + server) status pushed from main. Only `downloading`/`reloading`
   *  are in-flight boot phases; `available`/`error`/`shell-available` are
   *  banner concerns, not loading-screen ones. */
  ota?: { phase?: string | null } | null;
  /** electron-updater shell snapshot phase, or null when not packaged / web. */
  shell?: { phase?: string | null } | null;
  /** The manual shell-reinstall notice (ENG-849) — pushed as `shell-available`
   *  or recovered via `getShellUpdate()`. It's the fallback the main process
   *  emits only when shell auto-update is disabled or terminally failed, so the
   *  `shell` snapshot above then reads `disabled`/`failed` and misses it. A
   *  reinstall the loading screen isn't applying is still outstanding, so it
   *  counts as pending here and must not let the overlay claim completion. */
  manualShellPending?: boolean;
}

// Shell phases that mean "a shell update still needs a relaunch to finish", so
// the loading screen must not signal completion while one is pending. `failed`
// is excluded on purpose — a failed shell update must not hold the boot copy
// hostage — as are the passive `idle`/`checking`/`complete`/`disabled`.
const SHELL_PENDING = new Set(['available', 'downloading', 'ready-to-install', 'installing']);

const DOWNLOADING = 'Downloading the latest update…';
const ALMOST_READY = 'Almost ready…';
const FINISHING = 'Finishing update…';

/** The loading-screen status line, or null when nothing update-related is in
 *  flight (the welcome orb shows with no sub-line). */
export function deriveBootStatus(input: BootStatusInput): string | null {
  const ota = input.ota?.phase ?? null;
  const shell = input.shell?.phase ?? null;
  // A pending manual notice counts even though its snapshot phase (disabled/
  // failed) isn't in SHELL_PENDING — the reinstall is still outstanding.
  const shellPending = (shell != null && SHELL_PENDING.has(shell)) || !!input.manualShellPending;

  if (ota === 'downloading') return DOWNLOADING;
  if (ota === 'reloading') {
    // Only claim we're almost done when nothing else is pending. A pending
    // shell update still needs a restart the loading screen isn't applying, so
    // reflect ongoing work instead of completion (ENG-2296).
    if (!shellPending) return ALMOST_READY;
    return shell === 'downloading' ? DOWNLOADING : FINISHING;
  }
  // No OTA in flight, but the shell binary is downloading at boot — surface it
  // rather than a silent, stalled-looking welcome screen (ENG-749 spirit).
  if (shell === 'downloading') return DOWNLOADING;
  return null;
}

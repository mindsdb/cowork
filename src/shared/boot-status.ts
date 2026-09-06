// Loading-screen copy derived from OTA, shell auto-update and manual reinstall status. This is
// presentation only; update policy lives in the main process.

export interface BootStatusInput {
  /** Only downloading/reloading hold the boot screen; other OTA phases belong to banners. */
  ota?: { phase?: string | null } | null;
  /** electron-updater shell snapshot phase, or null when not packaged / web. */
  shell?: { phase?: string | null } | null;
  /**
   * Manual reinstall remains pending when shell auto-update is disabled or has failed; the overlay
   * must not imply it has been applied.
   */
  manualShellPending?: boolean;
}

// These phases still need a shell relaunch. Failed and passive phases must not hold the boot copy
// open.
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
    // A pending shell update needs a restart that this loading screen does not apply.
    if (!shellPending) return ALMOST_READY;
    return shell === 'downloading' ? DOWNLOADING : FINISHING;
  }
  // No OTA in flight, but the shell binary is downloading at boot — surface it
  // rather than a silent, stalled-looking welcome screen (ENG-749 spirit).
  if (shell === 'downloading') return DOWNLOADING;
  return null;
}

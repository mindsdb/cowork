// The progress line under the welcome orb while the loading screen is held open
// through a boot-time update (ENG-749). OTA-only (ENG-2764): a shell download is
// never applied by the boot gate, so naming it here announced an update the app
// then asked the user to apply by hand. The copy is never completion-shaped, so
// it can't contradict a pending shell update (ENG-2296).
//
// Presentation only — it never decides *whether* to update.

export interface BootStatusInput {
  /** OTA (UI + server) status pushed from main. Only `downloading`/`reloading`
   *  are in-flight boot phases; `available`/`error`/`shell-available` are
   *  banner concerns, not loading-screen ones. */
  ota?: { phase?: string | null } | null;
}

const DOWNLOADING = 'Downloading the latest update…';
const FINISHING = 'Finishing up…';

/** The loading-screen status line, or null when no boot-time OTA is in flight
 *  (the welcome orb shows with no sub-line). */
export function deriveBootStatus(input: BootStatusInput): string | null {
  switch (input.ota?.phase) {
    case 'downloading': return DOWNLOADING;
    case 'reloading': return FINISHING;
    default: return null;
  }
}

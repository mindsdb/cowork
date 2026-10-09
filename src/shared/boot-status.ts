// The progress line under the welcome orb while the loading screen is held open
// through a boot-time update. It names only what the boot gate itself applies:
// an OTA, or a shell update an earlier launch downloaded and this launch
// installs. The gate never applies a shell download in flight, so naming one
// here announced an update the app then asked the user to apply by hand. The
// copy is never completion-shaped.
//
// Presentation only — it never decides *whether* to update.

import type { UpdateCoordinatorState } from './update-coordinator';

const DOWNLOADING = 'Downloading the latest update…';
const FINISHING = 'Finishing up…';
const INSTALLING = 'Installing the update — Cowork will reopen…';

/** The loading-screen status line, or null when no boot-time update is in
 *  flight (the welcome orb shows with no sub-line). */
export function deriveBootStatus(state: Pick<UpdateCoordinatorState, 'applying'> | null | undefined): string | null {
  switch (state?.applying) {
    // The app is about to quit, so this outranks any OTA line.
    case 'installing': return INSTALLING;
    case 'downloading': return DOWNLOADING;
    case 'reloading': return FINISHING;
    default: return null;
  }
}

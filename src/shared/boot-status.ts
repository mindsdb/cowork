// The progress line under the welcome orb while the loading screen is held open
// through a boot-time update (ENG-749).
//
// This line describes ONLY what the boot gate is actually waiting on, which is
// the OTA (UI + server) apply and nothing else (ENG-2764). The gate is released
// by the updater's boot poll (`onBootPollComplete`); the shell auto-updater runs
// on its own timer and the gate never waits for it. Reporting the shell channel
// here — as this unit did between ENG-2296 and ENG-2764 — made the loading
// screen announce a download it could not finish, hand the user the app anyway,
// and then ask them to click Restart in a banner.
//
// ENG-2296's underlying concern still holds: the line must never claim the
// update is done while something is still pending. That is met by never saying
// anything completion-shaped, rather than by importing a phase boot cannot act
// on. A pending shell update is the sidebar banner's business, not this line's.
//
// This is presentation only — it never decides *whether* to update, just what
// the loading screen says while a boot-time OTA is in flight.

export interface BootStatusInput {
  /** OTA (UI + server) status pushed from main. Only `downloading`/`reloading`
   *  are in-flight boot phases; `available`/`error`/`shell-available` are
   *  banner concerns, not loading-screen ones. */
  ota?: { phase?: string | null } | null;
}

const DOWNLOADING = 'Downloading the latest update…';
// Deliberately not completion-shaped. The OTA reload is the last thing the gate
// waits for, but a shell update may still be pending behind it, so this reports
// ongoing work and lets the sidebar banner own whatever remains (ENG-2296).
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

// The progress line under the welcome orb while the loading screen is held open
// through a boot-time update. It names only what the boot gate itself applies:
// an OTA, or a shell update an earlier launch downloaded and this launch
// installs. The gate never applies a shell download in flight, so naming one
// here announced an update the app then asked the user to apply by hand. The copy is never completion-shaped, so it can't contradict a pending
// shell update.
//
// Presentation only — it never decides *whether* to update.

export interface BootStatusInput {
  /** OTA (UI + server) status pushed from main. Only `downloading`/`reloading`
   *  are in-flight boot phases; `available`/`error`/`shell-available` are
   *  banner concerns, not loading-screen ones. */
  ota?: { phase?: string | null } | null;
  /** electron-updater shell snapshot phase. Only `installing` reaches the
   *  loading screen: the boot install of a stranded update, which quits and
   *  reopens the app. */
  shell?: { phase?: string | null } | null;
}

import { sourceTranslator, type Translate } from './i18n/translate';
import appSource from './i18n/locales/en/app.json';

/* The copy lives in the `app` catalog under `bootStatus`. The renderer passes its
   `app` translator; without one the copy is English. */
const english: Translate = sourceTranslator(appSource);

/** The loading-screen status line, or null when no boot-time update is in
 *  flight (the welcome orb shows with no sub-line). */
export function deriveBootStatus(input: BootStatusInput, t: Translate = english): string | null {
  // The app is about to quit, so this outranks any OTA line.
  if (input.shell?.phase === 'installing') return t('bootStatus.installing');
  switch (input.ota?.phase) {
    case 'downloading': return t('bootStatus.downloading');
    case 'reloading': return t('bootStatus.finishing');
    default: return null;
  }
}

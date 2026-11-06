/*
 * What closing the main window means, per platform.
 *
 * On macOS, closing an app's window leaves the app running in the Dock, and
 * clicking the Dock icon brings it back. We hide the window instead of
 * destroying it, so it comes back exactly as it was: running tasks keep
 * streaming and Code Mode terminals keep running. Quitting (Cmd+Q, the Dock's
 * Quit, an update install) still closes it for real.
 *
 * On Windows and Linux, closing the last window quits the app, as before.
 */

type Platform = NodeJS.Platform;

/** Whether a close request should hide the window instead of closing it. */
export function shouldHideOnClose(platform: Platform, quitting: boolean): boolean {
  return platform === 'darwin' && !quitting;
}

/** Whether the app should quit once its last window has closed. */
export function shouldQuitWhenAllWindowsClosed(platform: Platform): boolean {
  return platform !== 'darwin';
}

/** The window surface installHideOnClose needs; a BrowserWindow satisfies it. */
export interface HideableWindow {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown;
  once(event: 'leave-full-screen', listener: () => void): unknown;
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
  hide(): void;
  show(): void;
}

/*
 * Turns a close request into a hide where shouldHideOnClose says so.
 * `isQuitting` is read at close time, because the quit flag is set after the
 * window exists.
 *
 * Returns `reopen`, which shows the window again only if a close hid it. The
 * Dock's activate event also fires while the app is still launching, before
 * the window's first show, and showing it then would flash an unpainted
 * window.
 */
export function installHideOnClose(
  win: HideableWindow,
  platform: Platform,
  isQuitting: () => boolean,
): { reopen(): boolean } {
  let hiddenByClose = false;
  win.on('close', (event) => {
    if (!shouldHideOnClose(platform, isQuitting())) return;
    event.preventDefault();
    hiddenByClose = true;
    // Hiding a full-screen window leaves an empty black Space behind, so
    // leave full screen first and hide once that has finished.
    if (win.isFullScreen()) {
      win.once('leave-full-screen', () => win.hide());
      win.setFullScreen(false);
    } else {
      win.hide();
    }
  });
  return {
    reopen() {
      if (!hiddenByClose) return false;
      hiddenByClose = false;
      win.show();
      return true;
    },
  };
}

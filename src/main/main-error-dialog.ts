// Electron shows a modal "A JavaScript error occurred in the main process" for
// every uncaught main-process exception. electron-updater's net.request leaves
// some response paths without an 'error' listener, so a request that is in
// flight when the network drops (wake from sleep, Wi-Fi switch) throws a
// Chromium `net::ERR_*` straight to that dialog. The update check retries on
// its own, so the dialog only alarms the user: log those and keep the dialog
// for everything else.
import { dialog } from 'electron';

export function isChromiumNetError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('net::ERR_');
}

export function installMainErrorDialog(showErrorBox = dialog.showErrorBox): void {
  process.on('uncaughtException', (err) => {
    if (isChromiumNetError(err)) {
      console.error('[main] uncaught network error (request retries on its own):', err);
      return;
    }
    // Any listener turns Electron's own dialog off, so show the same one here.
    showErrorBox(
      'A JavaScript error occurred in the main process',
      `Uncaught Exception:\n${err.stack ?? `${err.name}: ${err.message}`}`,
    );
  });
}

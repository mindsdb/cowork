import * as path from 'path';
import type { WebPreferences } from 'electron';

/*
 * The main window's webPreferences. The desktop document preview spec builds
 * its window from this same function, so its isolation checks run under the
 * settings the app ships with.
 */
export function mainWindowWebPreferences(serverPort: number): WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.js'),
    // Hand the resolved (per-OS-user) server port to the renderer
    // synchronously, so getApiOrigin() addresses our own sidecar instead of
    // a hardcoded 26866 that could belong to another OS user.
    additionalArguments: [`--cowork-server-port=${serverPort}`],
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false,
    // Disable Chromium's same-origin/mixed-content checks so the renderer
    // (loaded from file://) can fetch http://127.0.0.1:<antonPort>/v1/*.
    // Safe in this context: app is local, network calls only target the
    // loopback python server we spawn ourselves. CSP in index.html still
    // allowlists the exact origins for defense in depth.
    // codeql[js/electron-disable-websecurity]
    webSecurity: false,
  };
}

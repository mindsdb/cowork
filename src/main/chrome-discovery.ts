// Chrome discovery + launch-args for the Browser Control bridge (M1).
//
// Read-only bridge over CDP: we point at a Chrome started with
// `--remote-debugging-port` on loopback and speak CDP from the Electron main
// process. This module is pure per-OS path/argument computation — no sockets,
// no child_process — so it is trivially unit-testable and OS-parameterizable
// (macOS + Windows parity from the first PR, matching the process.platform
// idioms already used across src/main).
//
// Auth/cookies/session stay inside the user's own Chrome. We deliberately use
// a DEDICATED, non-default `--user-data-dir` debug profile: Chrome 136+ refuses
// to expose the DevTools debugging port on the default profile, and using a
// dedicated profile keeps the debug session isolated. Onboarding copy tells the
// user their logins live in that profile.

import * as path from 'path';
import { coworkHome } from './cowork-home';

// Default loopback debug port. Overridable via COWORK_BROWSER_DEBUG_PORT so a
// user whose 9333 is taken can move it. Bound to 127.0.0.1 only.
export const DEFAULT_DEBUG_PORT = 9333;

export type ChromePlatform = NodeJS.Platform;

// Candidate Chrome binary locations per OS. First existing wins (the caller
// does the fs check); an env override (COWORK_BROWSER_CHROME_PATH) short-
// circuits the list entirely.
export function chromeCandidates(platform: ChromePlatform = process.platform): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';
    const rel = path.join('Google', 'Chrome', 'Application', 'chrome.exe');
    const out = [path.join(programFiles, rel), path.join(programFilesX86, rel)];
    if (localAppData) out.push(path.join(localAppData, rel));
    return out;
  }
  // linux (not a shipping target for M1, but keeps discovery total for dev/CI)
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

// Resolve the Chrome binary path: env override wins, otherwise the first
// candidate for which `exists(candidate)` returns true. `exists` is injected
// so this stays pure/testable (no fs import at module scope in tests).
export function resolveChromePath(
  exists: (p: string) => boolean,
  platform: ChromePlatform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = env['COWORK_BROWSER_CHROME_PATH'];
  if (override && override.trim()) return override.trim();
  for (const candidate of chromeCandidates(platform)) {
    try {
      if (exists(candidate)) return candidate;
    } catch {
      // ignore and keep scanning
    }
  }
  return null;
}

// The dedicated debug-profile directory. Non-default on purpose (Chrome 136+
// blocks the default profile from exposing the debug port). Lives under the
// Cowork home so it survives restarts and is owned by this OS user.
export function debugUserDataDir(): string {
  return path.join(coworkHome(), 'browser-control', 'chrome-debug-profile');
}

// Loopback debug port, honouring the env override when it is a valid port.
export function debugPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['COWORK_BROWSER_DEBUG_PORT'];
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return DEFAULT_DEBUG_PORT;
}

// The full Chrome launch args for a read-only debug session on loopback.
// Kept as an array (never a shell string) so paths with spaces are safe when
// passed to child_process.spawn.
export function launchArgs(
  port: number = debugPort(),
  userDataDir: string = debugUserDataDir(),
): string[] {
  return [
    `--remote-debugging-port=${port}`,
    // Bind the debug endpoint to loopback only — never expose it on the LAN.
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    // Skip the first-run/what's-new interstitials so the picker sees real tabs.
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

// The loopback base URL of Chrome's DevTools HTTP endpoint (used for
// /json/list target discovery).
export function devToolsHttpBase(port: number = debugPort()): string {
  return `http://127.0.0.1:${port}`;
}

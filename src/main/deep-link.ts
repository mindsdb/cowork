// Custom-scheme handling for the browser-to-app handoff.
//
// Windows refuses a foreground request from a process that isn't already
// frontmost, so show()/focus()/app.focus() are all declined after a browser
// sign-in and the OS flashes the taskbar button instead. The way back is to
// let Windows hand the foreground over: a second launch through our scheme
// notifies the running instance via the process singleton, which does get
// foreground rights. Pure (no electron import) so it stays unit-testable;
// index.ts wires in the real app/argv.

import * as path from 'path';

export const APP_SCHEME = 'mindshub-cowork';

/** Where the OAuth callback page sends the browser to bring the app forward. */
export const AUTH_CALLBACK_URL = `${APP_SCHEME}://auth-done`;

const AUTH_CALLBACK_HOST = 'auth-done';

/** True only for our scheme's auth-callback URL. Host is compared exactly, so
 *  a look-alike like `mindshub-cowork://auth-done.example.com` does not match. */
export function isAuthCallbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === `${APP_SCHEME}:` && parsed.host === AUTH_CALLBACK_HOST;
}

/** Arguments for `app.setAsDefaultProtocolClient`. A packaged app registers its
 *  own executable, but an unpackaged one is launched as `electron <script>`, so
 *  the script path has to be registered alongside or Windows re-launches the
 *  bare electron binary with no app to run. */
export function protocolClientArgs(
  execPath: string,
  argv: readonly string[],
  isPackaged: boolean,
): { execPath?: string; args?: string[] } {
  if (isPackaged) return {};
  const script = argv[1];
  if (!script) return {};
  return { execPath, args: [path.resolve(script)] };
}

/** First argument that is one of our scheme URLs. Windows delivers the deep
 *  link as an argv entry on the second instance, not as an event payload. */
export function findDeepLink(argv: readonly string[]): string | null {
  return argv.find((arg) => isAuthCallbackUrl(arg)) ?? null;
}

// Custom-scheme handling for the browser-to-app handoff.
//
// Windows refuses a foreground request from a process that isn't already
// frontmost, so show()/focus()/app.focus() are all declined after a browser
// sign-in and the OS flashes the taskbar button instead. The way back is to let
// Windows hand the foreground over: a launch through our scheme notifies the
// running instance via the process singleton, which does get foreground rights.
// Pure (no electron import) so it stays unit-testable; index.ts wires in the
// real app/argv and resolves the build kind.

import * as path from 'path';
import type { BuildKind } from './channels';

const SCHEME_BASE = 'mindshub-cowork';
const AUTH_CALLBACK_HOST = 'auth-done';

// Per channel, for the same reason appId, productName, userData and the deb
// package name already are: a scheme is a machine-wide claim, so a single name
// would let whichever build installed last answer for all of them.
const SCHEME_SUFFIX: Record<BuildKind, string> = {
  prod: '',
  preview: '-preview',
  // "staging", not "stable" — mirrors linuxName in scripts/channel-identity.mjs.
  stable: '-staging',
  dev: '-dev',
};

export function schemeForKind(kind: BuildKind): string {
  return `${SCHEME_BASE}${SCHEME_SUFFIX[kind]}`;
}

/** True only for this build's own scheme and the auth-callback host. Host is
 *  compared exactly, so `…://auth-done.example.com` does not match, and a
 *  sibling channel's scheme does not match either. */
export function isAuthCallbackUrl(url: string, kind: BuildKind): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === `${schemeForKind(kind)}:` && parsed.host === AUTH_CALLBACK_HOST;
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

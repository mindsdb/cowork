import type { BeforeSendResponse } from 'electron';

import type { DocumentPreviewGuard, GuardedFrame } from './document-preview-guard';

/*
 * The listener that adds the server's bearer token to the renderer's loopback
 * requests. app.ts registers it as the session's one onBeforeSendHeaders
 * listener; Electron keeps only the last listener per webRequest event, so
 * every rule about the token lives in this one function.
 *
 * It reads two things at different times, on purpose:
 *
 * - It asks the guard about `details.frame` as soon as the request arrives,
 *   before the gate can hold it. Electron resolves `details.frame` when it is
 *   read, and a read after a wait can find the frame gone.
 * - It reads the token when the request goes out, after any wait. The token is
 *   cached until the server restarts, and a restart during the wait replaces it.
 */

/* The parts of Electron's onBeforeSendHeaders details the listener reads. */
export interface TokenRequestDetails {
  readonly url: string;
  readonly method: string;
  readonly frame?: GuardedFrame | null;
  readonly requestHeaders: Record<string, string>;
}

/* Called once by a gate that held a request: true sends it, false cancels it. */
export type SettleHeldRequest = (ready: boolean) => void;

export interface ServerTokenListenerDeps {
  /* Decides which frames' requests may carry the token. */
  readonly guard: DocumentPreviewGuard;
  /* The sidecar's port, read for each request. */
  readonly serverPort: () => number;
  /* The server's token, or null when the server runs without auth. */
  readonly token: () => string | null;
  /* Vite's port when the renderer is served from Vite, else null. */
  readonly viteDevPort: string | null;
  /* Returns false to let the request go now, or true after taking it to
     settle later. */
  readonly gate: (details: TokenRequestDetails, settle: SettleHeldRequest) => boolean;
}

export type ServerTokenListener = (
  details: TokenRequestDetails,
  callback: (response: BeforeSendResponse) => void,
) => void;

export function serverTokenListener(deps: ServerTokenListenerDeps): ServerTokenListener {
  return (details, callback) => {
    const tokenAllowed = deps.guard.mayCarryServerToken(details.frame);
    const forward = () => {
      const token = tokenAllowed ? deps.token() : null;
      if (token) {
        try {
          const url = new URL(details.url);
          const isDirectServerCall = url.port === String(deps.serverPort());
          /* In dev mode the renderer loads from Vite, so its API calls go to
             Vite's own port and Vite proxies them to the sidecar. This
             listener never sees the proxied request, so it adds the token to
             the call to Vite. Only /api/ paths, so Vite's static asset and
             module requests go without it. */
          const isViteProxiedApiCall =
            deps.viteDevPort !== null && url.port === deps.viteDevPort && url.pathname.startsWith('/api/');
          if (isDirectServerCall || isViteProxiedApiCall) {
            details.requestHeaders['Authorization'] = `Bearer ${token}`;
          }
        } catch {
          /* A malformed URL leaves the headers untouched. */
        }
      }
      callback({ requestHeaders: details.requestHeaders });
    };

    const held = deps.gate(details, (ready) => {
      if (!ready) {
        callback({ cancel: true });
        return;
      }
      forward();
    });
    if (!held) forward();
  };
}

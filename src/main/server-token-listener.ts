import type { BeforeSendResponse, OnBeforeSendHeadersListenerDetails } from 'electron';

import { WINDOW_PROOF_HEADER } from '../shared/server-launch';
import type { DocumentPreviewGuard, GuardedFrame } from './document-preview-guard';

/*
 * The listener that adds the server's bearer token and the window proof to the
 * renderer's loopback requests. app.ts registers it as the session's one
 * onBeforeSendHeaders listener; Electron keeps only the last listener per
 * webRequest event, so every rule about both headers lives in this one
 * function.
 *
 * The local server here means 127.0.0.1 at the server's port, or an /api/
 * path on Vite's port when the renderer is served from Vite. A request to
 * `localhost` at the server's port gets neither header.
 *
 * The bearer goes on every request to the local server from a frame the
 * document preview guard allows. The proof goes only on a fetch or
 * XMLHttpRequest (Electron's `xhr` resource type) from the main window's own
 * top-level frame, and the listener removes any proof header every other
 * request to the local server carries. A frame inside the window, an image, a
 * navigation, a download, another window and a request with no frame all go
 * without it. So does any request when a field the rule reads is missing or
 * unreadable, or when the main window is gone.
 *
 * It reads two things at different times, on purpose:
 *
 * - It asks the guard about `details.frame`, and checks whether the request
 *   comes from the main window's top-level frame, as soon as the request
 *   arrives, before the gate can hold it. Electron resolves `details.frame`
 *   when it is read, and a read after a wait can find the frame gone.
 * - It reads the token and the proof when the request goes out, after any
 *   wait. Both belong to one server launch, and a restart during the wait
 *   replaces them.
 */

/* The parts of Electron's onBeforeSendHeaders details the listener reads. */
export interface TokenRequestDetails {
  readonly url: string;
  readonly method: string;
  readonly frame?: GuardedFrame | null;
  readonly resourceType?: OnBeforeSendHeadersListenerDetails['resourceType'];
  readonly webContentsId?: number;
  readonly requestHeaders: Record<string, string>;
}

/* The parts of the main window's WebContents the listener reads. Electron's
   WebContents fits it. */
export interface MainWindowContents {
  readonly id: number;
  readonly mainFrame: { readonly frameTreeNodeId: number };
}

/* Called once by a gate that held a request: true sends it, false cancels it. */
export type SettleHeldRequest = (ready: boolean) => void;

export interface ServerTokenListenerDeps {
  /* Decides which frames' requests may carry the token. */
  readonly guard: DocumentPreviewGuard;
  /* The sidecar's port, read for each request. */
  readonly serverPort: () => number;
  /* The server launch's bearer token, or null when no server was launched. */
  readonly token: () => string | null;
  /* The server launch's window proof, or null when no server was launched. */
  readonly windowProof: () => string | null;
  /* The main window's contents, or null once the window is gone. */
  readonly mainWindow: () => MainWindowContents | null;
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

/* Whether the request is a fetch or XMLHttpRequest from the main window's own
   top-level frame. A field it can't read, or a window that is gone, counts as
   no: Electron throws when a property of a destroyed frame or contents is read. */
function isMainWindowFetch(details: TokenRequestDetails, mainWindow: () => MainWindowContents | null): boolean {
  if (details.resourceType !== 'xhr' || details.webContentsId === undefined) return false;
  try {
    const contents = mainWindow();
    const { frame } = details;
    return !!contents && !!frame
      && details.webContentsId === contents.id
      && frame.parent === null
      && frame.frameTreeNodeId === contents.mainFrame.frameTreeNodeId;
  } catch {
    return false;
  }
}

/* Whether the URL is the server's own address. The server binds 127.0.0.1
   only, and the window addresses it there (getApiOrigin in
   src/renderer/platform/host.ts). `localhost` can resolve to ::1, where
   another process can listen on the same port. */
function isServerAddress(url: URL, serverPort: number): boolean {
  return url.hostname === '127.0.0.1' && url.port === String(serverPort);
}

export type RequestGate = ServerTokenListenerDeps['gate'];

/* A gate that holds every request to the server's address while `untilSettled`
   returns a pending start's promise, and lets it go when that resolves. The
   listener reads the token and the proof as the request goes out, so a start
   that published sends both and one that ended without trust sends neither.
   A request elsewhere, one whose URL does not parse, and every request while
   no start is pending go straight on. */
export function holdWhileServerStarts(
  serverPort: () => number,
  untilSettled: () => Promise<void> | null,
): RequestGate {
  return (details, settle) => {
    const settled = untilSettled();
    if (!settled) return false;
    try {
      if (!isServerAddress(new URL(details.url), serverPort())) return false;
    } catch {
      return false;
    }
    void settled.then(() => settle(true));
    return true;
  };
}

/* A gate that runs `first`, then `second` once `first` lets the request go.
   Either one's cancel cancels it. */
export function gatesInOrder(first: RequestGate, second: RequestGate): RequestGate {
  return (details, settle) => {
    const held = first(details, (ready) => {
      if (!ready) settle(false);
      else if (!second(details, settle)) settle(true);
    });
    return held || second(details, settle);
  };
}

/* Removes the header under any capitalization the request used. */
function removeHeader(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
}

export function serverTokenListener(deps: ServerTokenListenerDeps): ServerTokenListener {
  return (details, callback) => {
    const tokenAllowed = deps.guard.mayCarryServerToken(details.frame);
    const proofAllowed = tokenAllowed && isMainWindowFetch(details, deps.mainWindow);
    const forward = () => {
      try {
        const url = new URL(details.url);
        const isDirectServerCall = isServerAddress(url, deps.serverPort());
        /* In dev mode the renderer loads from Vite, so its API calls go to
           Vite's own port and Vite proxies them to the sidecar. This
           listener never sees the proxied request, so it adds the headers to
           the call to Vite. Only /api/ paths, so Vite's static asset and
           module requests go without them. */
        const isViteProxiedApiCall =
          deps.viteDevPort !== null && url.port === deps.viteDevPort && url.pathname.startsWith('/api/');
        if (isDirectServerCall || isViteProxiedApiCall) {
          removeHeader(details.requestHeaders, WINDOW_PROOF_HEADER);
          const token = tokenAllowed ? deps.token() : null;
          if (token) {
            details.requestHeaders['Authorization'] = `Bearer ${token}`;
            const proof = proofAllowed ? deps.windowProof() : null;
            if (proof) details.requestHeaders[WINDOW_PROOF_HEADER] = proof;
          }
        }
      } catch {
        /* A malformed URL leaves the headers untouched. */
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

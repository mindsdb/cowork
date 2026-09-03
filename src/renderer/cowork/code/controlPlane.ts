import { getCodeControlPlaneOrigin } from '../../platform/host';


/** True for an origin only this machine can reach (127.0.0.1, localhost, ::1). */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}


/**
 * Whether another computer could connect to this Code service at all. The
 * desktop's sidecar listens on loopback, so on a plain desktop nothing can;
 * a hosted deployment (or a desktop pointed at a reachable control plane)
 * hands runtimes a shared address.
 */
export function codeControlPlaneReachable(): boolean {
  return !isLoopbackOrigin(getCodeControlPlaneOrigin());
}


/** What the connect-computer surfaces say instead of a form when nothing can connect. */
export const UNREACHABLE_TITLE = 'Not available from this desktop yet';
export const UNREACHABLE_EXPLANATION = 'Cowork\u2019s Code service on this computer is private to it, so another computer has nowhere to connect and tasks run here. Connecting other computers works when Cowork is served from a shared address, where this dialog gives you a one-time command to run on the other computer.';

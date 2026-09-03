import { getCodeControlPlaneOrigin } from '../../platform/host';


/** True for an origin only this machine can reach: any 127.x.x.x address, localhost, or ::1. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}


/**
 * Whether another computer could connect to this Code service at all. The
 * desktop's sidecar listens on loopback, so on a plain desktop nothing can and
 * the connect-a-computer surfaces stay hidden; a hosted deployment (or a desktop
 * pointed at a reachable control plane) hands runtimes a shared address.
 */
export function codeControlPlaneReachable(): boolean {
  return !isLoopbackOrigin(getCodeControlPlaneOrigin());
}

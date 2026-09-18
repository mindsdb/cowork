import type { WebContents } from 'electron';
import { isSelfReload } from './external-url';

/** The app can notify after its explicit UI opt-in; embedded pages cannot. */
export function registerRendererPermissions(renderer: WebContents): void {
  const allowed = (requester: WebContents | null, permission: string, details: {
    isMainFrame: boolean;
    requestingUrl?: string;
  }) => {
    // Preserve the existing voice-input permission policy.
    if (permission === 'media' || permission === 'audioCapture') return true;
    return permission === 'notifications'
      && requester === renderer
      && !renderer.isDestroyed()
      && details.isMainFrame
      && isSelfReload(details.requestingUrl, renderer.getURL());
  };
  renderer.session.setPermissionCheckHandler((requester, permission, _origin, details) => allowed(requester, permission, details));
  renderer.session.setPermissionRequestHandler((requester, permission, callback, details) => callback(allowed(requester, permission, details)));
}

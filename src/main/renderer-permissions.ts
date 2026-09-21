import type { WebContents } from 'electron';
import { isSelfReload } from './external-url';

/** Scope notifications and voice input to the app, not its embedded pages. */
export function registerRendererPermissions(renderer: WebContents): void {
  const isAppFrame = (requester: WebContents | null, details: {
    isMainFrame: boolean;
    requestingUrl?: string;
  }) => {
    return requester === renderer
      && !renderer.isDestroyed()
      && details.isMainFrame
      && isSelfReload(details.requestingUrl, renderer.getURL());
  };
  renderer.session.setPermissionCheckHandler((requester, permission, _origin, details) => {
    if (permission === 'media' || permission === 'notifications') return isAppFrame(requester, details);
    // Before this gate Electron allowed checks by default. Keep that behaviour
    // for unrelated permissions, including clipboard writes; their requests
    // still follow the existing deny policy below.
    return true;
  });
  renderer.session.setPermissionRequestHandler((requester, permission, callback, details) => callback(
    isAppFrame(requester, details)
      && ['media', 'audioCapture', 'notifications'].includes(permission),
  ));
}

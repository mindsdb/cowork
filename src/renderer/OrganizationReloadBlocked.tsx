// Covers the stale UI once the organization reload budget runs out. That
// document refuses every token, so without this it looks alive but does nothing.

import { useSyncExternalStore } from 'react';
import {
  isOrganizationReloadBlocked,
  subscribeOrganizationReloadBlocked,
} from './cowork/lib/organizationTransition';
import { WelcomeNotice } from './WelcomeLoading';

/** Full screen reload prompt, shown only while the reload budget is spent. */
export function OrganizationReloadBlocked() {
  const blocked = useSyncExternalStore(subscribeOrganizationReloadBlocked, isOrganizationReloadBlocked);
  if (!blocked) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
      <WelcomeNotice
        title="Your organization changed"
        message="This tab still shows the previous organization. Reload to continue."
        actionLabel="Reload"
        onAction={() => window.location.reload()}
      />
    </div>
  );
}

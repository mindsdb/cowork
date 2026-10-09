// Replaces the app once the organization reload budget runs out. That document
// refuses every token, so leaving it mounted shows a stale UI that does nothing.

import { useSyncExternalStore, type ReactNode } from 'react';
import {
  isOrganizationReloadBlocked,
  subscribeOrganizationReloadBlocked,
} from './cowork/lib/organizationTransition';
import { WelcomeNotice } from './WelcomeLoading';

/** Render the children, or a reload prompt in their place while the budget is spent. */
export function OrganizationReloadGate({ children }: { children: ReactNode }) {
  const blocked = useSyncExternalStore(subscribeOrganizationReloadBlocked, isOrganizationReloadBlocked);
  if (!blocked) return children;
  return (
    <WelcomeNotice
      title="Your organization changed"
      message="This tab still belongs to the previous organization. Reload to continue."
      actionLabel="Reload"
      onAction={() => window.location.reload()}
    />
  );
}

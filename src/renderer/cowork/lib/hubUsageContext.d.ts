// Hand-written types for hubUsageContext.js, same pattern as analytics.d.ts.
// Only what TypeScript callers read is typed; `usage` is the /hub/usage/ view.

import type { Context } from 'react';

export interface HubUsageContextValue {
  usage: ({ isBillingOwner?: boolean } & Record<string, unknown>) | null;
  providerType?: string | null;
  refresh?: () => unknown;
}

export const HubUsageContext: Context<HubUsageContextValue | null>;

export function useHubUsageContext(): HubUsageContextValue | null;

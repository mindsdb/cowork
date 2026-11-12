// Hand-written types for usageWarnings.js, same pattern as analytics.d.ts.
// Only the members imported from TypeScript are declared — extend as TS
// callers need more of the surface.

export interface UsageAction {
  key: string;
  label: string;
}

export const USAGE_ACTIONS: Readonly<{
  viewUsage: UsageAction;
  addFunds: UsageAction;
  setUpAutoTopUp: UsageAction;
  manageAutoTopUp: UsageAction;
  updatePaymentMethod: UsageAction;
}>;

/** The console URL an action opens; only a billing owner is deep-linked into a dialog. */
export function usageActionUrl(action: UsageAction | null | undefined, options?: { isBillingOwner?: boolean }): string;

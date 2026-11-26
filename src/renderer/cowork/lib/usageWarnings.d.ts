// Hand-written types for usageWarnings.js, same pattern as analytics.d.ts.
// Only the members imported from TypeScript are declared — extend as TS
// callers need more of the surface.

export interface UsageAction {
  key: string;
  label: string;
  /** Only on an upgrade: the plan it buys ('plus' | 'pro'). */
  tier?: string | null;
}

export const USAGE_ACTIONS: Readonly<{
  viewUsage: UsageAction;
  addFunds: UsageAction;
  setUpAutoTopUp: UsageAction;
  manageAutoTopUp: UsageAction;
  updatePaymentMethod: UsageAction;
  upgrade: UsageAction;
}>;

/** The upgrade action for a tier: "Get Plus", "Upgrade to Pro". */
export function upgradeAction(tier: 'plus' | 'pro' | string | null | undefined): UsageAction;

/** The console URL an action opens; only a billing owner is deep-linked into a
 *  wallet dialog, and an upgrade opens the plan's confirm dialog for the named
 *  organization, with `placement` as its start surface when one is given. */
export function usageActionUrl(
  action: UsageAction | null | undefined,
  options?: { isBillingOwner?: boolean; organizationId?: string | null; subject?: string | null; placement?: string | null },
): string;

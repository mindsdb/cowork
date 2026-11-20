import { useCallback, useMemo } from 'react';
import { host } from '../../platform/host';
import { MINDS_BILLING_URL, consoleUrlFor, mindsUpgradeUrl } from '../../lib/mindsUrls';
import { offersBilling } from '../lib/billingLinks';
import { useHubUsageContext } from '../lib/hubUsageContext';
import { trackUpgradeClicked } from '../lib/analytics';
import { planOf, nextUpgradeTier, cleanRequiredTier, tierRank } from '../lib/subscriptionPlan';
import { useAccountUser } from './useAccountUser';

/**
 * Whether this session may offer a plan upgrade, and how to open one
 * (ENG-4186).
 *
 * An upgrade is offered only when all of these hold:
 *  - the usage read carries a plan (the feature gate is on, and cowork-server
 *    is new enough to relay it). No plan, no offer: the UI reads as before.
 *  - the surface may sell (never inside the mobile app; see billingLinks).
 *  - the session runs in a personal organization. v1 sells plans to the owner
 *    of a personal organization only, and the console refuses anyone else, so
 *    a team member is never shown a button that leads to a refusal.
 *
 * `tier` is the next plan up from the current one (Free → Plus, Plus → Pro),
 * or null when there is nothing to offer. `canOffer(tier)` answers for a
 * specific tier, e.g. the one a `model_not_in_tier` stop names.
 */
export function useUpgradeOffer() {
  const usage = useHubUsageContext()?.usage ?? null;
  const plan = useMemo(() => planOf(usage), [usage]);
  // The token is read only once there is a plan to speak of, so a surface
  // with no plan does no extra work and renders exactly as before.
  const user = useAccountUser(false, { active: !!plan });
  const eligible = !!plan && offersBilling() && !!user?.orgIsPersonal;
  const organizationId = user?.orgId ?? null;
  const subject = user?.sub ?? null;

  const canOffer = useCallback(
    (tier) => eligible && !!cleanRequiredTier(tier) && tierRank(tier) > tierRank(plan?.tier),
    [eligible, plan?.tier],
  );
  const urlFor = useCallback(
    (tier) => mindsUpgradeUrl(tier, { organizationId, subject }),
    [organizationId, subject],
  );
  /* The billing page for this organization, where "Manage" sends someone to
     change or cancel the plan in the console itself. */
  const manageUrl = useMemo(
    () => consoleUrlFor(MINDS_BILLING_URL, { organizationId, subject }),
    [organizationId, subject],
  );
  const open = useCallback((tier, surface) => {
    trackUpgradeClicked(surface, tier, plan?.tier ?? null);
    host.openExternal(urlFor(tier));
  }, [plan?.tier, urlFor]);

  return useMemo(() => {
    const next = nextUpgradeTier(plan?.tier);
    return {
      plan,
      /** This session may buy or manage a plan (personal org, billing surface). */
      eligible,
      tier: eligible ? next : null,
      canOffer,
      urlFor,
      open,
      manageUrl,
      account: { organizationId, subject },
    };
  }, [plan, eligible, canOffer, urlFor, open, manageUrl, organizationId, subject]);
}

/**
 * For a surface that paints usage actions (`USAGE_ACTIONS`, `upgradeAction`):
 * `visible(actions)` drops an upgrade this session may not buy, and
 * `isUpgrade(action)` / `openUpgrade(action, surface)` route one that it may
 * through the plan confirm link, with its own analytics event. Every other
 * action is the caller's, exactly as before.
 */
export function useUsageActions() {
  const upgrade = useUpgradeOffer();
  const { canOffer, open } = upgrade;
  const visible = useCallback(
    (actions) => (actions || []).filter((a) => a?.key !== 'upgrade' || canOffer(a.tier)),
    [canOffer],
  );
  const openUpgrade = useCallback((action, surface) => open(action.tier, surface), [open]);
  return { visible, isUpgrade: (a) => a?.key === 'upgrade', openUpgrade, upgrade };
}

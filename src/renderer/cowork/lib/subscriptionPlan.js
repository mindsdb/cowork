// MindsHub subscription plans (ENG-4186): Free, Plus and Pro.
//
// Pure. The input is the `plan` block of cowork-server's `/hub/usage/` view:
//
//   { tier: 'free'|'plus'|'pro', status: 'active'|'past_due'|'canceled',
//     renewsAt, cancelAtPeriodEnd,
//     windows: [{ window: '5h'|'7d', percentUsed: 0-100, resetsAt }] }
//
// or null, which is what every read carries while the feature gate is off and
// what an older cowork-server sends. Null means "say nothing new": every
// surface then renders exactly as it did before plans existed. A Free plan
// differs from null in one way only, the "Get Plus" offer.
//
// The allowance is tracked in dollars, but no surface ever shows dollars or
// tokens for it: only the percentage of each window and when it frees up.

export const PLAN_TIERS = Object.freeze(['free', 'plus', 'pro']);
export const PAID_PLAN_TIERS = Object.freeze(['plus', 'pro']);
export const ALLOWANCE_WINDOWS = Object.freeze(['5h', '7d']);

/* At this share of a window used, the bar and a running task say so. The
   console warns at the same mark. */
export const WINDOW_WARN_PERCENT = 80;
/* Steps a dismissal is keyed to, so closing the warning at 80% lets it ask
   again at 90% and at 95%, as the free allowance's bar does. */
const WINDOW_WARN_STEPS = [WINDOW_WARN_PERCENT, 90, 95];

/** Where `tier` sits in PLAN_TIERS: free 0, plus 1, pro 2, anything else -1. */
export const tierRank = (tier) => PLAN_TIERS.indexOf(tier);

function cleanWindow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!ALLOWANCE_WINDOWS.includes(raw.window)) return null;
  const pct = Number(raw.percentUsed);
  if (!Number.isFinite(pct)) return null;
  return {
    window: raw.window,
    percentUsed: Math.max(0, Math.min(100, pct)),
    resetsAt: typeof raw.resetsAt === 'string' && raw.resetsAt ? raw.resetsAt : null,
  };
}

/**
 * The plan from a usage read, cleaned, or null when the read carries none (or
 * one this build cannot read: an unknown tier fails closed to null, so a new
 * tier never paints as something it is not).
 */
export function planOf(usage) {
  if (!usage?.reachable) return null;
  const raw = usage.plan;
  if (!raw || typeof raw !== 'object') return null;
  if (!PLAN_TIERS.includes(raw.tier)) return null;
  const windows = Array.isArray(raw.windows)
    ? raw.windows.map(cleanWindow).filter(Boolean)
    : [];
  // 5h first, then 7d, whatever order the server listed them in.
  windows.sort((a, b) => ALLOWANCE_WINDOWS.indexOf(a.window) - ALLOWANCE_WINDOWS.indexOf(b.window));
  return {
    tier: raw.tier,
    status: typeof raw.status === 'string' ? raw.status : 'active',
    renewsAt: typeof raw.renewsAt === 'string' && raw.renewsAt ? raw.renewsAt : null,
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd === true,
    windows,
  };
}

/** True for Plus and Pro. */
export function isPaidPlan(plan) {
  return !!plan && PAID_PLAN_TIERS.includes(plan.tier);
}

/** The tier above `tier` worth offering: Free → Plus, Plus → Pro, Pro → none. */
export function nextUpgradeTier(tier) {
  if (tier === 'free') return 'plus';
  if (tier === 'plus') return 'pro';
  return null;
}

/** Whether `tier`'s allowance covers a model whose cheapest covering tier is
 *  `coveredByTier`. An unknown coverage (null, an older server) counts as
 *  covered, so nothing is said that the server did not say. */
export function tierCovers(tier, coveredByTier) {
  if (!coveredByTier || tierRank(coveredByTier) < 0) return true;
  return tierRank(tier) >= tierRank(coveredByTier);
}

/** The tier a `model_not_in_tier` stop names, cleaned: 'plus', 'pro' or null. */
export function cleanRequiredTier(value) {
  return PAID_PLAN_TIERS.includes(value) ? value : null;
}

/** The window a `window_allowance_exhausted` stop names, cleaned. */
export function cleanAllowanceWindow(value) {
  return ALLOWANCE_WINDOWS.includes(value) ? value : null;
}

/**
 * The plan fields a turn failure carries, from the wire event (snake_case, as
 * `reset_at` is) or an already-camelCased one. Used by every path that turns a
 * `response.failed` into an error message, so a reloaded failure renders the
 * same card as the live one.
 */
export function planFailureFields(ev) {
  return {
    allowanceWindow: cleanAllowanceWindow(ev?.window ?? ev?.allowance_window ?? ev?.allowanceWindow),
    requiredTier: cleanRequiredTier(ev?.required_tier ?? ev?.requiredTier),
  };
}

/** Which step of the warning band a window sits in: under 80% is 0. */
export function windowWarnStep(percentUsed) {
  const n = Number(percentUsed) || 0;
  return WINDOW_WARN_STEPS.filter((mark) => n >= mark).length;
}

/**
 * Where a paid plan's windows stand, for the bar and the running-task notice.
 *
 * - `exhausted`: the window that stops plan-covered work, or null. When both
 *   are used up, the one that frees up last, since that is when work resumes.
 * - `warning`: the fullest window at or past WINDOW_WARN_PERCENT that is not
 *   used up, or null.
 */
export function windowState(plan) {
  if (!isPaidPlan(plan)) return { exhausted: null, warning: null };
  const full = plan.windows.filter((w) => w.percentUsed >= 100);
  const exhausted = full.length
    ? full.reduce((a, b) => ((Date.parse(b.resetsAt) || 0) > (Date.parse(a.resetsAt) || 0) ? b : a))
    : null;
  const warm = plan.windows.filter((w) => w.percentUsed >= WINDOW_WARN_PERCENT && w.percentUsed < 100);
  const warning = warm.length
    ? warm.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a))
    : null;
  return { exhausted, warning };
}

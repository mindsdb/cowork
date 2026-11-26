// Usage warnings (ENG-1782): which notice, if any, sits above the composer,
// and which alert lands in a running task when the usage state changes.
//
// Pure. Input is the `/hub/usage/` view (see hooks/useHubUsage) plus what the
// composer knows about the current pick. Output is copy + action keys; the
// renderer decides how to paint them and where the actions open.
//
// Two resources, always named apart: the FREE MindsHub Air allowance, which
// refills on its own, and the PAID balance. "Out of tokens" on its own is never
// one of the outputs.

import { MINDSHUB_AIR_MODEL_ID, MODEL_ROUTER_ID } from './modelCatalog';
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL, MINDS_AUTO_TOP_UP_URL, mindsUpgradeUrl } from '../../lib/mindsUrls';
import { planOf, isPaidPlan, nextUpgradeTier, tierCovers, windowState, windowWarnStep } from './subscriptionPlan';
import { billingCopyKey, offersBilling } from './billingLinks';
import { budgetScopeOf } from './budgetScope';
import i18n, { currentLocale } from '../../lib/i18n';

/* User-facing copy, translated when it is read (never at import). */
const tr = (key, vars) => i18n.t(`messages.usage.${key}`, { ns: 'projects', ...vars });
const trBilling = (key, vars) => tr(billingCopyKey(key), vars);

/* The viewer's locale for dates and times; English (and the pseudo-locale)
   format as en-US, as they always have. */
function dateLocale() {
  const locale = currentLocale();
  return locale === 'en' || locale === 'en-XA' ? 'en-US' : locale;
}

// Free tokens read as "running low" once this fraction or less remains. The
// console alerts at 80% used; this is the same line from the other side.
export const FREE_TOKENS_LOW_FRACTION = 0.2;

/* Fractions left that the allowance steps down through: the band's own edge,
   then 90% used (where the console escalates too), then 95%.
   Two jobs, one scale. A dismissal is keyed to the step the allowance was in
   when the bar was closed, so closing it at 900K of 5M lets it ask again at
   500K and at 250K rather than staying shut until the tokens are gone. And a
   running task reports each step it crosses, for which the edge has to be a
   mark like the others: entering the band is the first thing worth saying. */
const FREE_DISMISS_STEPS_FRACTION = [FREE_TOKENS_LOW_FRACTION, 0.1, 0.05];

/* The bar above the composer speaks only when the next task is likely to stop
   (ENG-4719): every source that can pay for the picked model is nearly gone.
   "Nearly gone" for an allowance is this fraction left or less, for a plan
   window the matching share used. Above it the user has room and nothing to
   do, so the bar stays empty; the figures live in Settings → Usage, which
   keeps its own 20% / 80% colouring. */
export const ALLOWANCE_NEARLY_GONE_FRACTION = 0.1;
export const PLAN_WINDOW_NEARLY_GONE_PERCENT = 90;

export const USAGE_ACTIONS = Object.freeze({
  viewUsage: { key: 'viewUsage', get label() { return tr('actions.viewUsage'); } },
  addFunds: { key: 'addFunds', get label() { return tr('actions.addFunds'); } },
  setUpAutoTopUp: { key: 'setUpAutoTopUp', get label() { return tr('actions.setUpAutoTopUp'); } },
  manageAutoTopUp: { key: 'manageAutoTopUp', get label() { return tr('actions.manageAutoTopUp'); } },
  updatePaymentMethod: { key: 'updatePaymentMethod', get label() { return tr('actions.updatePaymentMethod'); } },
  // A plan upgrade (ENG-4186). Generic: `upgradeAction(tier)` names the tier.
  upgrade: { key: 'upgrade', tier: null, get label() { return tr('actions.upgrade', { tier: 'other' }); } },
});

/** The upgrade action for `tier` ('plus' | 'pro'): "Get Plus", "Upgrade to Pro". */
export function upgradeAction(tier) {
  return { key: 'upgrade', tier, get label() { return tr('actions.upgrade', { tier: tier || 'other' }); } };
}

/** Where an action opens in the console. Every wallet control the console
 *  offers is owner-only, so only an owner is deep-linked into a dialog; anyone
 *  else goes to the billing page itself and sees what they are allowed to.
 *
 *  An upgrade always opens the plan's confirm dialog for the organization this
 *  session runs in (`organizationId`, `subject`): the console checks who may
 *  buy before it subscribes, and callers only offer an upgrade where one can
 *  be bought (see hooks/useUpgradeOffer). */
export function usageActionUrl(action, { isBillingOwner = false, organizationId = null, subject = null } = {}) {
  if (action?.key === 'upgrade') return mindsUpgradeUrl(action.tier, { organizationId, subject });
  if (!isBillingOwner) return MINDS_BILLING_URL;
  if (action?.key === 'addFunds') return MINDS_ADD_FUNDS_URL;
  if (action?.key === 'setUpAutoTopUp' || action?.key === 'manageAutoTopUp') return MINDS_AUTO_TOP_UP_URL;
  return MINDS_BILLING_URL;
}

/* Dollar marks inside the "low" band. A dismissal is keyed to the step the
   balance was in when the bar was closed, so closing it at $18 lets it ask
   again at $9 rather than staying closed until the balance empties. The steps
   tighten as zero approaches, which is when a top-up is worth interrupting
   for; four crossings is the most anyone sees before the balance is empty. */
const BALANCE_DISMISS_STEPS_USD = [10, 5, 2.5, 1];

/** How many of `marks` a value has fallen below. Reads a missing or
 *  unparseable value as 0, which is the deepest step: a number we cannot
 *  read is the one worth asking about, not the one worth hiding. */
function dismissStep(value, marks) {
  const n = Number(value) || 0;
  return marks.filter((mark) => n < mark).length;
}

/** Which step of the low band a balance sits in: $18 is 0, $9 is 1, $0.50 is 4. */
export function balanceDismissStep(usd) {
  return dismissStep(usd, BALANCE_DISMISS_STEPS_USD);
}

/* Below this balance the wallet is worth a word, and only then (ENG-4188,
   ENG-4719). Above it the next task is paid for: the allowance running out,
   or a paid pick billing the wallet, changes nothing the user needs to act on,
   and saying so trains them to ignore the bar. Auth's own $20 "low" line still
   drives its emails and the console; the composer waits for this one. */
export const BALANCE_WARN_USD = 5;

/** Whether the wallet comfortably pays for the next task: BALANCE_WARN_USD
 *  or more, or an auto top up that is working and will refill it. Nothing to
 *  tell such an account (ENG-4188, ENG-4719). */
export function balanceCarriesNextTask(balance, autoTopUp) {
  if (!balance || isBalanceEmpty(balance)) return false;
  if (autoTopUp?.enabled && autoTopUp.status === 'ok') return true;
  return Number(balance.usd) >= BALANCE_WARN_USD;
}

/** How far down the allowance has stepped, from the fraction still left: 40%
 *  is 0 (not low at all), 18% is 1, 9% is 2, 4% is 3. Step 0 is reachable from
 *  inside the band: `low` takes the edge (`<=`) while a step is strictly below
 *  each mark (`<`), so a read landing on exactly 0.2 shows the bar and keys its
 *  dismissal to step 0. The key is opaque, so nothing downstream cares. */
export function freeDismissStep(fractionLeft) {
  return dismissStep(fractionLeft, FREE_DISMISS_STEPS_FRACTION);
}

/** 0.124 → "12%", 0.004 → "0.4%", 0.996 → "99.6%", 1 → "100%".
 *
 *  Keeps one decimal at both ends of the range, and for the same reason: 0.4%
 *  of the allowance is still a usable turn for a caller who caches well, so
 *  rounding it to "0%" reads as used up, and rounding the 99.6% used alongside
 *  it to "100%" puts "100% used" and "0.4% left" on the same row of Settings.
 *  Only a genuinely empty or genuinely untouched allowance reads 0% or 100%.
 */
export function formatPercentShort(fraction) {
  const pct = Math.max(0, Math.min(100, (Number(fraction) || 0) * 100));
  if (pct > 0 && pct < 1) return `${Math.round(pct * 10) / 10}%`;
  if (pct > 99 && pct < 100) return `${Math.round(pct * 10) / 10}%`;
  return `${Math.round(pct)}%`;
}

/** "$8.42", "$0.00", "-$0.25". Always two decimals so amounts line up. */
export function formatUsd(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/** "Sep 11" in the viewer's timezone, or null when the date is unusable. For
 *  spans that really are calendar dates; the allowance uses `formatResetTime`. */
export function formatResetDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' });
}

/** When the allowance next refills, on the viewer's clock: "2:15 PM", or
 *  "Sep 15, 2:15 PM" on another local day. Null when nothing is quotable.
 *
 *  It refills every few hours, so a date names a day the reader is already in.
 *  An instant already past returns null and the caller drops the clause, since
 *  a stale time reads as imminent. Mirrors the console's formatter
 *  (mindshub_frontend creditAlert.js).
 */
export function formatResetTime(iso, now = new Date()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= now.getTime()) return null;
  const time = d.toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' });
  const sameLocalDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameLocalDay) return time;
  return `${d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })}, ${time}`;
}

// `available`: Air can run on the free tokens right now. -1 is auth's uncapped
// sentinel; 0 or a missing limit means there is no grant to draw from.
// `fractionLeft` is a number only for a capped grant, so it doubles as the test
// for "there is a figure worth showing": an uncapped grant has nothing to count
// down and a missing one has nothing to count.
function freeState(free) {
  if (!free) return { out: false, low: false, available: false, fractionLeft: null };
  if (free.limit === -1) return { out: false, low: false, available: true, fractionLeft: null };
  if (!(free.limit > 0)) return { out: false, low: false, available: false, fractionLeft: null };
  const remaining = Math.max(0, Number(free.remaining) || 0);
  const fractionLeft = remaining / free.limit;
  return {
    out: remaining <= 0,
    low: remaining > 0 && fractionLeft <= FREE_TOKENS_LOW_FRACTION,
    available: remaining > 0,
    remaining,
    fractionLeft,
  };
}

/* The console's no-grant sentence (mindshub_frontend grant-usage-card.jsx
   NO_GRANT_SENTENCE), word for word, so both apps describe the same account
   the same way. It names no cause and no size. */
export const NO_FREE_GRANT_SENTENCE =
  'This account does not include free MindsHub Air tokens. MindsHub Air uses your balance, like every other model.';

/** NO_FREE_GRANT_SENTENCE in the viewer's language. */
export function noFreeGrantSentence() {
  return tr('noFreeGrant');
}

/**
 * @typedef {'has_room' | 'spent' | 'no_grant' | 'no_figure'} FreeAllowanceStatus
 * @typedef {{ status: FreeAllowanceStatus, resetsAt: string | null }} FreeAllowanceState
 */

/** Where the free MindsHub Air allowance stands, for a surface outside the
 *  composer bar that has to say so (ChatView's stopped-task cards, the
 *  Settings probe notice).
 *
 *  `has_room` and `spent` only ever describe a capped grant from a reachable
 *  read. `no_grant` is the sidecar's explicit no-grant value, a limit of 0,
 *  which cowork-server sends only when auth reports `free_grant_eligible:
 *  false`. It carries no `resetsAt`: nothing refills, so no card may name a
 *  refill time, even if an older sidecar still relays one. Everything else is
 *  `no_figure`: signed out or unreachable, a missing figure, or auth's uncapped
 *  sentinel, none of which gives a card a number to speak from. A missing read
 *  is unknown, never `no_grant`. `resetsAt` is the refill instant auth
 *  reported, carried whenever the read is reachable and a grant exists,
 *  because a caller that already knows the allowance is spent (the gate said
 *  so) still needs the time.
 *
 *  @returns {FreeAllowanceState} */
export function freeAllowanceState(usage) {
  if (!usage?.reachable) return { status: 'no_figure', resetsAt: null };
  if (usage.freeTokens?.limit === 0) return { status: 'no_grant', resetsAt: null };
  const resetsAt = usage.freeTokens?.resetsAt || null;
  const f = freeState(usage.freeTokens);
  if (f.fractionLeft === null) return { status: 'no_figure', resetsAt };
  return { status: f.available ? 'has_room' : 'spent', resetsAt };
}

/** Whether a hub usage `balance` says the wallet cannot pay: auth flagged it
 *  depleted, or said it cannot be drawn on. The one place that rule is
 *  written, for the composer bar, the drained-wallet card and Settings > Usage
 *  alike. A missing balance is not an empty one, because a read without it
 *  says nothing about the wallet. */
export function isBalanceEmpty(balance) {
  return !!balance && (balance.alert === 'depleted' || balance.canConsume === false);
}

/** Whether a hub usage `balance` is a wallet the next task can fall through
 *  to: present, not empty, and holding money. A wallet the auth service has
 *  not flagged but that holds nothing does not count. */
export function isBalanceUsable(balance) {
  return !!balance && !isBalanceEmpty(balance) && Number(balance.usd) > 0;
}

/** What in a usage read decides model locks, as a comparable string (null if unknown). Prefers
 *  `walletCanConsume` (set for members too; never shown in UI), else the balance (ENG-4147). */
export function modelAccessSignature(usage) {
  if (!usage?.reachable) return null;
  const walletEmpty = typeof usage.walletCanConsume === 'boolean' ? !usage.walletCanConsume : isBalanceEmpty(usage.balance);
  const base = `${walletEmpty}|${freeAllowanceState(usage).status}`;
  // A plan change moves model locks too (ENG-4186): an upgrade unlocks rows,
  // and a window filling or freeing up locks or unlocks the ones it covers.
  // Only with a plan, so the signature without one reads as before.
  const plan = planOf(usage);
  if (!plan) return base;
  const { exhausted } = windowState(plan);
  return `${base}|${plan.tier}|${exhausted ? exhausted.window : ''}`;
}

/** What a stop on `included_allowance_exhausted` says, for the stopped-task
 *  card and the Settings probe notice alike. The drained-wallet card's
 *  spent-allowance branch describes the same state, so it uses this too.
 *
 *  An org with no free grant is told that, in the console's words, and never a
 *  refill time. Otherwise the refill time is the gate's (`resetAt`), falling
 *  back to the hub usage read's. When neither is a usable future instant, the
 *  sentence offers funds alone: nothing then says the allowance refills at
 *  all, and the org may have no grant to refill. */
export function allowanceStopCopy({ resetAt = null, usage = null } = {}) {
  const free = freeAllowanceState(usage);
  if (!offersBilling()) {
    if (free.status === 'no_grant') return i18n.t('providers.unavailable', { ns: 'settings' });
    const time = formatResetTime(resetAt || free.resetsAt);
    return time ? tr('balanceEmpty.freeUsedTooWithTimeMobile', { time }) : tr('freeUsed.title');
  }
  if (free.status === 'no_grant') {
    return trBilling('allowanceStop.noGrant', { noGrant: noFreeGrantSentence() });
  }
  const time = formatResetTime(resetAt || free.resetsAt);
  return time ? trBilling('allowanceStop.withTime', { time }) : trBilling('allowanceStop.noTime');
}

/** What a stop on auth's daily free-Air spend fuse says (`free_serving_paused`
 *  on a turn, `free_air_daily_spend_fuse_exceeded` on the Settings probe). The
 *  fuse lifts at the next UTC midnight, which the gate sends as its reset
 *  instant, on a desktop or a hosted turn. Without a usable one (a hosted turn
 *  from a cowork-server that predates it, say) the sentence names the event
 *  instead. */
export function freeServingPausedCopy(resetAt) {
  const until = formatResetTime(resetAt);
  return until ? trBilling('freeServingPaused.until', { until }) : trBilling('freeServingPaused.dailyReset');
}

/** What a stop on a spent budget says (`budget_exceeded`), after a
 *  lead naming the budget, for the stopped-task card and the Settings notice.
 *  Credits do not lift it, so it never asks for funds; Air is named only while
 *  the hub read shows its free allowance has room. `budgetScope` picks who can
 *  raise it; without one the copy names no role. */
export function budgetExceededCopy({ usage = null, budgetScope = null, budgetModelLabel = null } = {}) {
  const scope = budgetScopeOf(budgetScope);
  // A per-model budget names its model and says the others still work.
  const model = { hasModel: budgetModelLabel ? 'true' : 'other', model: budgetModelLabel || '' };
  return freeAllowanceState(usage).status === 'has_room'
    ? tr('budgetExceeded.airHasRoom', { scope, ...model })
    : tr('budgetExceeded.raise', { scope, ...model });
}

/** The picked model id: an id string, a catalog option ({ id }), or null. */
function pickedModelId(modelIn) {
  return typeof modelIn === 'string' ? modelIn : modelIn?.id ?? null;
}

/** An explicit pick that only ever bills the balance (not Air, not the router). */
function isExplicitPaidModel(model) {
  return !!model && model !== MINDSHUB_AIR_MODEL_ID && model !== MODEL_ROUTER_ID;
}

/* `${key}WithTime` with the refill time, or `${key}` when none is quotable. */
function withResetTime(free, key, vars, translate = tr) {
  const time = formatResetTime(free?.resetsAt);
  return time ? translate(`${key}WithTime`, { ...vars, time }) : translate(key, vars);
}

/* Whether a capped allowance is nearly gone: used up, or at or under
   ALLOWANCE_NEARLY_GONE_FRACTION left. An uncapped grant never is. */
function allowanceNearlyGone(f) {
  if (f.out) return true;
  return f.fractionLeft !== null && f.fractionLeft <= ALLOWANCE_NEARLY_GONE_FRACTION;
}

export function deriveComposerWarning(usage, options = {}) {
  if (offersBilling()) return deriveUsageWarning(usage, options);
  const { providerType = 'minds-cloud', model, coveredByTier = null } = options;
  if (!usage?.reachable || (providerType && providerType !== 'minds-cloud')) return null;
  // On Plus or Pro the plan's windows, not the free allowance, carry a pick
  // the tier covers, so they speak for it. A pick outside the tier bills the
  // wallet, which the mobile app does not talk about.
  const plan = planOf(usage);
  if (isPaidPlan(plan)) {
    if (!tierCovers(plan.tier, coveredByTier)) return null;
    return planWindowWarning(plan, {
      balanceUsable: isBalanceUsable(usage.balance),
      balanceCarries: balanceCarriesNextTask(usage.balance, usage.autoTopUp),
    });
  }
  if (isExplicitPaidModel(pickedModelId(model))) return null;
  const free = usage.freeTokens;
  const f = freeState(free);
  // Nothing at rest (ENG-4719): an allowance with room says nothing.
  if (f.fractionLeft === null || !allowanceNearlyGone(f)) return null;
  const time = formatResetTime(free.resetsAt);
  return {
    kind: f.out ? 'free_used' : 'free_low',
    title: f.out ? tr('freeUsed.title') : tr('percentLeft', { percent: formatPercentShort(f.fractionLeft) }),
    body: time ? tr('resetsAt', { time }) : '',
    tone: f.out ? 'info' : 'warning',
    dismissKey: f.out ? 'free_used' : `free_low:${freeDismissStep(f.fractionLeft)}`,
    actions: [],
  };
}

/**
 * The notice above the composer, or null.
 *
 * @param usage    the `/hub/usage/` view (null when signed out / unreachable)
 * @param opts.providerType  the planning provider ('minds-cloud' | BYOK types)
 * @param opts.model         the model the composer will send with: an id, or
 *                           a catalog option ({ id }) as HomeView/ChatView pass it
 */
export function deriveUsageWarning(usage, {
  providerType = 'minds-cloud', model: modelIn = null, coveredByTier = null,
} = {}) {
  if (!usage || !usage.reachable) return null;
  if (providerType && providerType !== 'minds-cloud') return null;
  const model = pickedModelId(modelIn);

  const free = usage.freeTokens || null;
  const balance = usage.balance || null;
  const auto = usage.autoTopUp || null;

  // Which resource the next turn spends. An explicit Air pick runs on the free
  // tokens until they are gone; an explicit paid model only ever bills the
  // balance; the router (and no pick, which resolves to the router on
  // MindsHub) can land on either, so both resources matter for it.
  const isPaidModel = isExplicitPaidModel(model);
  const f = freeState(free);
  const balanceEmpty = isBalanceEmpty(balance);
  // A wallet the next task falls through to once the allowance is gone.
  const balanceUsable = isBalanceUsable(balance);
  // The bar speaks only when the next task is likely to stop (ENG-4719): the
  // wallet can't carry it (under BALANCE_WARN_USD, no working auto top
  // up) AND no allowance can either. An explicit paid pick has only the wallet.
  const balanceCarries = balanceCarriesNextTask(balance, auto);
  const balanceShort = !!balance && !balanceEmpty && !balanceCarries;
  const freeInUse = !isPaidModel;
  // An empty balance only stops the next task when nothing else can pay for
  // it. The router (and no pick) resolves to the account's configured model,
  // and cowork-server swaps a wallet-locked model for Air while the free
  // tokens last, so it keeps running; only an explicit paid pick is stuck.
  const balanceEmptyStopsNextTask = balanceEmpty && (isPaidModel || !f.available);
  const usd = balance ? formatUsd(balance.usd) : null;

  if (auto?.status === 'payment_failed') {
    return {
      kind: 'auto_top_up_failed',
      tone: 'danger',
      title: tr('autoTopUpFailed.title'),
      body: trBilling('autoTopUpFailed.body'),
      actions: [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.updatePaymentMethod],
    };
  }

  // Plus and Pro (ENG-4186): the plan's two windows decide what the next task
  // spends, so they speak first. A pick the tier does not cover runs on the
  // wallet like any paid model, and the wallet branches below say what there
  // is to say about it. A null or Free plan never enters here, so every
  // surface reads exactly as before plans existed.
  const plan = planOf(usage);
  if (isPaidPlan(plan) && tierCovers(plan.tier, coveredByTier)) {
    return planWindowWarning(plan, { balanceUsable, balanceCarries });
  }

  if (balanceEmptyStopsNextTask) {
    const body = freeInUse && f.out
      ? withResetTime(free, 'balanceEmpty.freeUsedToo', {}, trBilling)
      : trBilling('balanceEmpty.body');
    return {
      kind: 'balance_empty',
      tone: 'danger',
      title: tr('balanceEmpty.title'),
      body,
      actions: auto?.enabled
        ? [USAGE_ACTIONS.addFunds]
        : [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.setUpAutoTopUp],
    };
  }

  // A short wallet is news only when it is the one thing paying for the next
  // task: an explicit paid pick, or no allowance left to draw on (ENG-4719).
  // While some allowance remains, the router and Air run on it and cowork-server
  // swaps a wallet-locked pick for Air, so a nearly-gone allowance is said by
  // `free_low` below, which names the short wallet too. A working auto top up
  // counts as carrying, so it never reaches here.
  if (balanceShort && (isPaidModel || !f.available)) {
    const title = tr('balanceLow.title');
    // Closing the bar hides this step only; the next step down asks again.
    const dismissKey = `balance_low:${balanceDismissStep(balance.usd)}`;
    if (auto?.enabled && auto.status === 'pending_action') {
      return {
        kind: 'balance_low',
        dismissKey,
        tone: 'warning',
        title,
        body: tr('balanceLow.autoPending', { usd }),
        actions: [],
      };
    }
    if (auto?.enabled && auto.status === 'cap_reached') {
      return {
        kind: 'balance_low',
        dismissKey,
        tone: 'warning',
        title,
        body: trBilling('balanceLow.autoCapReached', { usd }),
        actions: [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.manageAutoTopUp],
      };
    }
    return {
      kind: 'balance_low',
      dismissKey,
      tone: 'warning',
      title,
      body: trBilling('balanceLow.body', { usd }),
      actions: [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.setUpAutoTopUp],
    };
  }

  // A healthy wallet just carries Air until the refill: no bar (ENG-4188).
  if (freeInUse && f.out && balanceCarries) return null;

  if (freeInUse && f.out) {
    return {
      kind: 'free_used',
      tone: 'info',
      title: tr('freeUsed.title'),
      body: usd ? withResetTime(free, 'freeUsed.bodyWithUsd', { usd }) : withResetTime(free, 'freeUsed.body'),
      actions: [USAGE_ACTIONS.viewUsage],
    };
  }

  // The allowance running low is news only once it is nearly gone and the
  // wallet can't carry Air past it (ENG-4208, ENG-4719).
  if (freeInUse && !f.out && allowanceNearlyGone(f) && !balanceCarries) {
    let body = withResetTime(free, 'freeLow.body');
    const actions = [USAGE_ACTIONS.viewUsage];
    if (balanceEmpty) {
      body += ` ${tr('balanceEmptySentence')}`;
      actions.push(USAGE_ACTIONS.addFunds);
    } else if (balanceUsable) {
      // Past the return above, a usable balance is under the line: say how
      // much cash is left, since that is what runs out next.
      body += ` ${tr('freeLow.balanceLowToo', { usd })}`;
      actions.push(USAGE_ACTIONS.addFunds);
    }
    return {
      kind: 'free_low',
      tone: 'warning',
      // Stepped like the balance: closing this at 10% left asks again at 5%.
      dismissKey: `free_low:${freeDismissStep(f.fractionLeft)}`,
      title: tr('percentLeft', { percent: formatPercentShort(f.fractionLeft) }),
      body,
      actions,
    };
  }

  // Nothing is wrong, so the bar says nothing (ENG-4719). The standing
  // allowance figure is gone for everyone, including a free user with an
  // empty wallet: with room left they keep working, and Settings → Usage
  // still shows where the allowance stands.
  return null;
}

/* Which window, in words: "5-hour" or "weekly". */
const windowName = (w) => (w === '7d' ? '7d' : '5h');

/* The bar for a paid plan: a used-up window first (work on the plan has
   stopped), then a window at PLAN_WINDOW_NEARLY_GONE_PERCENT or more. Silent
   whenever the wallet carries the next task (ENG-4719): the plan running out
   then changes nothing the subscriber must act on. Nothing at rest: the
   meters live in Settings → Usage. No dollar or token figure, ever: only the
   share of the window and when it frees up. Inside the mobile app the bar still says
   how full a window is and when it resets, but it names no wallet and offers
   no action (see billingLinks). */
function planWindowWarning(plan, { balanceUsable, balanceCarries = false }) {
  if (balanceCarries) return null;
  const { exhausted, warning: warm } = windowState(plan);
  const warning = warm && warm.percentUsed >= PLAN_WINDOW_NEARLY_GONE_PERCENT ? warm : null;
  const sells = offersBilling();
  const upgradeTier = nextUpgradeTier(plan.tier);
  const upgrade = upgradeTier ? [upgradeAction(upgradeTier)] : [];
  const offer = (actions) => (sells ? actions : []);
  const resets = (time) => (time ? tr('resetsAt', { time }) : '');
  if (exhausted) {
    const time = formatResetTime(exhausted.resetsAt);
    const vars = { window: windowName(exhausted.window), time: time || '' };
    if (balanceUsable) {
      return {
        kind: 'window_on_wallet',
        tone: 'warning',
        dismissKey: `window_on_wallet:${exhausted.window}`,
        title: tr('window.usedUpTitle', vars),
        body: sells
          ? (time ? tr('window.onWalletWithTime', vars) : tr('window.onWallet', vars))
          : resets(time),
        actions: offer([USAGE_ACTIONS.viewUsage, ...upgrade]),
      };
    }
    return {
      kind: 'window_exhausted',
      tone: 'danger',
      title: tr('window.usedUpTitle', vars),
      body: time ? trBilling('window.pausedWithTime', vars) : trBilling('window.paused', vars),
      actions: offer([USAGE_ACTIONS.addFunds, ...upgrade]),
    };
  }
  if (warning) {
    const time = formatResetTime(warning.resetsAt);
    const vars = { window: windowName(warning.window), percent: `${Math.round(warning.percentUsed)}%`, time: time || '' };
    let body;
    if (!balanceUsable) body = time ? tr('window.lowThenPauseWithTime', vars) : tr('window.lowThenPause', vars);
    else if (sells) body = time ? tr('window.lowThenWalletWithTime', vars) : tr('window.lowThenWallet', vars);
    else body = resets(time);
    return {
      kind: 'window_low',
      tone: 'warning',
      // Stepped like the free allowance: closing it at 80% asks again at 90%.
      dismissKey: `window_low:${warning.window}:${windowWarnStep(warning.percentUsed)}`,
      title: tr('window.lowTitle', vars),
      body,
      actions: offer([USAGE_ACTIONS.viewUsage, ...upgrade]),
    };
  }
  return null;
}

/**
 * What changed between two usage reads that a running task should hear about.
 * Returns alert descriptors for ChatView's `usage_notice` messages.
 *
 * @param opts.model  the running task's pick (id, catalog option, or null for
 *                    the router). A task on an explicit paid model was on the
 *                    balance all along, so the free tokens running out is not
 *                    its news.
 * @param opts.providerType  the planning provider. The poll keeps running on a
 *                    BYOK provider because it is keyed on the MindsHub sign-in,
 *                    but a task billing someone else's key never spends these
 *                    tokens, so an account-wide change is not its news either.
 *                    Same gate `deriveComposerWarning` applies to the bar.
 * @param opts.coveredByTier  the cheapest plan covering the task's model, or
 *                    null when unknown. A task on a model its Plus or Pro plan
 *                    does not cover bills the wallet from the start, so the
 *                    plan's windows are not its news. Same gate the bar uses.
 */
export function usageTransitions(prev, next, {
  model: modelIn = null, providerType = 'minds-cloud', coveredByTier = null,
} = {}) {
  if (!prev?.reachable || !next?.reachable) return [];
  if (providerType && providerType !== 'minds-cloud') return [];
  const out = [];
  const before = freeState(prev.freeTokens);
  const after = freeState(next.freeTokens);
  const spendsFree = !isExplicitPaidModel(pickedModelId(modelIn));
  // A task on a healthy wallet keeps going on it; that is not news (ENG-4188).
  if (!before.out && after.out && spendsFree && !balanceCarriesNextTask(next.balance, next.autoTopUp)) {
    out.push({ kind: 'free_used', resetsAt: next.freeTokens?.resetsAt || null });
  }
  // A long task can cross the low band and empty it without the composer bar
  // ever being looked at, so the crossing is this task's news too. Stepped on
  // the same scale as the bar's dismissal, so a task that runs from 40% left to
  // 8% left reports on each step rather than on each poll. Both reads have to be a
  // capped grant, or a grant arriving mid-task would read as one draining, and
  // `free_used` above owns the last step so reaching zero says the allowance is
  // gone rather than that it is low.
  // The first four terms are belt and braces, not load-bearing: `after.low`
  // already implies a capped grant with allowance left, and `freeDismissStep`
  // reads a null fraction as the deepest step, which no later step can exceed.
  // They stay because the step comparison carrying all of that alone does not
  // read as the rule it enforces.
  if (!before.out && !after.out && after.low && spendsFree
      && !balanceCarriesNextTask(next.balance, next.autoTopUp)
      && before.fractionLeft !== null && after.fractionLeft !== null
      && freeDismissStep(after.fractionLeft) > freeDismissStep(before.fractionLeft)) {
    out.push({
      kind: 'free_low',
      fractionLeft: after.fractionLeft,
      resetsAt: next.freeTokens?.resetsAt || null,
    });
  }
  // Plus and Pro (ENG-4186): a window crossing a warning step, or filling up,
  // during this task. Both reads must carry the paid plan, or a plan arriving
  // mid-task would read as a window filling. The plan must cover the task's
  // model, or the task was on the wallet all along.
  const planBefore = planOf(prev);
  const planAfter = planOf(next);
  if (isPaidPlan(planBefore) && isPaidPlan(planAfter) && tierCovers(planAfter.tier, coveredByTier)) {
    const prior = new Map(planBefore.windows.map((w) => [w.window, w]));
    for (const w of planAfter.windows) {
      const was = prior.get(w.window);
      if (!was) continue;
      if (was.percentUsed < 100 && w.percentUsed >= 100) {
        out.push({
          kind: 'window_exhausted',
          window: w.window,
          resetsAt: w.resetsAt,
          onWallet: isBalanceUsable(next.balance),
        });
      } else if (w.percentUsed < 100 && windowWarnStep(w.percentUsed) > windowWarnStep(was.percentUsed)) {
        out.push({ kind: 'window_low', window: w.window, percentUsed: w.percentUsed, resetsAt: w.resetsAt });
      }
    }
  }
  if (prev.autoTopUp?.status !== 'payment_failed' && next.autoTopUp?.status === 'payment_failed') {
    out.push({ kind: 'auto_top_up_failed' });
  }
  return out;
}

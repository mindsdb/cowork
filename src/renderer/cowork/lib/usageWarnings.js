// Usage warnings (ENG-1782): which notice, if any, sits above the composer,
// and which alert lands in a running task when the usage state changes.
//
// Pure. Input is the `/hub/usage/` view (see hooks/useHubUsage) plus what the
// composer knows about the current pick. Output is copy + action keys; the
// renderer decides how to paint them and where the actions open.
//
// Two resources, always named apart: the FREE monthly MindsHub Air tokens and
// the PAID balance. "Out of tokens" on its own is never one of the outputs.

import { MINDSHUB_AIR_MODEL_ID, MODEL_ROUTER_ID } from './modelCatalog';
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL, MINDS_AUTO_TOP_UP_URL } from '../../lib/mindsUrls';

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

export const USAGE_ACTIONS = Object.freeze({
  viewUsage: { key: 'viewUsage', label: 'View usage' },
  addFunds: { key: 'addFunds', label: 'Add funds' },
  setUpAutoTopUp: { key: 'setUpAutoTopUp', label: 'Set up auto top up' },
  manageAutoTopUp: { key: 'manageAutoTopUp', label: 'Manage auto top up' },
  updatePaymentMethod: { key: 'updatePaymentMethod', label: 'Update payment method' },
});

/** Where an action opens in the console. Every wallet control the console
 *  offers is owner-only, so only an owner is deep-linked into a dialog; anyone
 *  else goes to the billing page itself and sees what they are allowed to. */
export function usageActionUrl(action, { isBillingOwner = false } = {}) {
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

/** How far down the allowance has stepped, from the fraction still left: 40%
 *  is 0 (not low at all), 18% is 1, 9% is 2, 4% is 3. A dismissal only ever
 *  reads this inside the low band, so it never sees 0. */
export function freeDismissStep(fractionLeft) {
  return dismissStep(fractionLeft, FREE_DISMISS_STEPS_FRACTION);
}

/** 620000 → "620K", 1200000 → "1.2M", 5000000 → "5M", 900 → "900". */
export function formatTokensShort(value) {
  const n = Number(value) || 0;
  const trim = (x) => String(Math.round(x * 10) / 10);
  // From 999,950 the K form rounds to "1000K"; that is "1M".
  if (n >= 999_950) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}K`;
  return String(Math.round(n));
}

/** "$8.42", "$0.00", "-$0.25". Always two decimals so amounts line up. */
export function formatUsd(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/** "Sep 11" in the viewer's timezone, or null when the date is unusable. */
export function formatResetDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

/** The picked model id: an id string, a catalog option ({ id }), or null. */
function pickedModelId(modelIn) {
  return typeof modelIn === 'string' ? modelIn : modelIn?.id ?? null;
}

/** An explicit pick that only ever bills the balance (not Air, not the router). */
function isExplicitPaidModel(model) {
  return !!model && model !== MINDSHUB_AIR_MODEL_ID && model !== MODEL_ROUTER_ID;
}

function resetClause(free, lead) {
  const date = formatResetDate(free?.resetsAt);
  return date ? `${lead} on ${date}` : lead;
}

/**
 * The notice above the composer, or null.
 *
 * @param usage    the `/hub/usage/` view (null when signed out / unreachable)
 * @param opts.providerType  the planning provider ('minds-cloud' | BYOK types)
 * @param opts.model         the model the composer will send with: an id, or
 *                           a catalog option ({ id }) as HomeView/ChatView pass it
 */
export function deriveComposerWarning(usage, { providerType = 'minds-cloud', model: modelIn = null } = {}) {
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
  const isAir = model === MINDSHUB_AIR_MODEL_ID;
  const isPaidModel = isExplicitPaidModel(model);
  const f = freeState(free);
  const balanceEmpty = !!balance && (balance.alert === 'depleted' || balance.canConsume === false);
  const balanceLow = !!balance && !balanceEmpty && balance.alert === 'low';
  const freeInUse = !isPaidModel;
  const paidInUse = !isAir || f.out || !free;
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
      title: 'Auto top up failed',
      body: "We couldn't charge your card. Add funds or update your payment method.",
      actions: [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.updatePaymentMethod],
    };
  }

  if (balanceEmptyStopsNextTask) {
    const body = freeInUse && f.out
      ? `Free tokens are used up too. Add funds, or wait for them to ${resetClause(free, 'reset')}.`
      : 'Add funds to start another task.';
    return {
      kind: 'balance_empty',
      tone: 'danger',
      title: 'Balance empty',
      body,
      actions: auto?.enabled
        ? [USAGE_ACTIONS.addFunds]
        : [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.setUpAutoTopUp],
    };
  }

  if (balanceLow && paidInUse) {
    const title = 'Balance running low';
    // Closing the bar hides this step only; the next step down asks again.
    const dismissKey = `balance_low:${balanceDismissStep(balance.usd)}`;
    if (auto?.enabled && auto.status === 'ok') {
      const target = auto.rechargeToUsd != null ? formatUsd(auto.rechargeToUsd) : null;
      const floor = auto.thresholdUsd != null ? formatUsd(auto.thresholdUsd) : null;
      const detail = target && floor
        ? `Auto top up refills it to ${target} when it drops below ${floor}.`
        : 'Auto top up will cover it.';
      return { kind: 'balance_low', dismissKey, tone: 'warning', title, body: `${usd} left. ${detail}`, actions: [] };
    }
    if (auto?.enabled && auto.status === 'pending_action') {
      return {
        kind: 'balance_low',
        dismissKey,
        tone: 'warning',
        title,
        body: `${usd} left. Auto top up is waiting on your bank.`,
        actions: [],
      };
    }
    if (auto?.enabled && auto.status === 'cap_reached') {
      return {
        kind: 'balance_low',
        dismissKey,
        tone: 'warning',
        title,
        body: `${usd} left and auto top up hit its monthly cap. Add funds to keep going.`,
        actions: [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.manageAutoTopUp],
      };
    }
    return {
      kind: 'balance_low',
      dismissKey,
      tone: 'warning',
      title,
      body: `${usd} left. Add funds or turn on auto top up.`,
      actions: [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.setUpAutoTopUp],
    };
  }

  if (freeInUse && f.out) {
    const left = usd ? ` (${usd} left)` : '';
    return {
      kind: 'free_used',
      tone: 'info',
      title: 'Free monthly tokens used',
      body: `MindsHub Air is on your balance${left} until your free tokens ${resetClause(free, 'reset')}.`,
      actions: [USAGE_ACTIONS.viewUsage],
    };
  }

  if (freeInUse && f.low) {
    let body = `After that, MindsHub Air uses your balance ${resetClause(free, 'until your free tokens reset')}.`;
    const actions = [USAGE_ACTIONS.viewUsage];
    if (balanceEmpty) {
      body += ' Your balance is empty.';
      actions.push(USAGE_ACTIONS.addFunds);
    } else if (balanceLow) {
      body += ` Your balance is low too (${usd}).`;
      actions.push(USAGE_ACTIONS.addFunds);
    }
    return {
      kind: 'free_low',
      tone: 'warning',
      // Stepped like the balance: closing this at 900K of 5M asks again at
      // 500K, which is also where the console escalates from 80% to 90% used.
      dismissKey: `free_low:${freeDismissStep(f.fractionLeft)}`,
      title: `${formatTokensShort(f.remaining)} free tokens left`,
      body,
      actions,
    };
  }

  // Nothing is wrong, so say where the allowance stands rather than nothing at
  // all. A warning the person only meets at 20% left is a warning they cannot
  // plan around, and Settings is somewhere they have to think to go. `resting`
  // marks this as a figure and not a warning: it carries no close button, and
  // it does not count as something to warn about (see `usageHealthy`).
  if (freeInUse && f.available && f.fractionLeft !== null) {
    const resets = formatResetDate(free.resetsAt);
    return {
      kind: 'free_at_rest',
      tone: 'resting',
      resting: true,
      title: `${formatTokensShort(f.remaining)} of ${formatTokensShort(free.limit)} free tokens left`,
      body: resets ? `Resets on ${resets}.` : 'Air runs on these until they are used up.',
      actions: [USAGE_ACTIONS.viewUsage],
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
 */
export function usageTransitions(prev, next, { model: modelIn = null } = {}) {
  if (!prev?.reachable || !next?.reachable) return [];
  const out = [];
  const before = freeState(prev.freeTokens);
  const after = freeState(next.freeTokens);
  const spendsFree = !isExplicitPaidModel(pickedModelId(modelIn));
  if (!before.out && after.out && spendsFree) {
    out.push({ kind: 'free_used', resetsAt: next.freeTokens?.resetsAt || null });
  }
  // A long task can cross the low band and empty it without the composer bar
  // ever being looked at, so the crossing is this task's news too. Stepped on
  // the same scale as the bar's dismissal, so a task that runs from 2M to 400K
  // reports on each step rather than on each poll. Both reads have to be a
  // capped grant, or a grant arriving mid-task would read as one draining, and
  // `free_used` above owns the last step so reaching zero says the tokens are
  // gone rather than that they are low.
  if (!before.out && !after.out && after.low && spendsFree
      && before.fractionLeft !== null && after.fractionLeft !== null
      && freeDismissStep(after.fractionLeft) > freeDismissStep(before.fractionLeft)) {
    out.push({
      kind: 'free_low',
      remaining: after.remaining,
      resetsAt: next.freeTokens?.resetsAt || null,
    });
  }
  if (prev.autoTopUp?.status !== 'payment_failed' && next.autoTopUp?.status === 'payment_failed') {
    out.push({ kind: 'auto_top_up_failed' });
  }
  return out;
}

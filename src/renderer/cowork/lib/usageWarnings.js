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
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL } from '../../lib/mindsUrls';

// Free tokens read as "running low" once this fraction or less remains. The
// console alerts at 80% used; this is the same line from the other side.
export const FREE_TOKENS_LOW_FRACTION = 0.2;

export const USAGE_ACTIONS = Object.freeze({
  viewUsage: { key: 'viewUsage', label: 'View usage' },
  addFunds: { key: 'addFunds', label: 'Add funds' },
  setUpAutoTopUp: { key: 'setUpAutoTopUp', label: 'Set up auto top up' },
  manageAutoTopUp: { key: 'manageAutoTopUp', label: 'Manage auto top up' },
  updatePaymentMethod: { key: 'updatePaymentMethod', label: 'Update payment method' },
});

/** Where an action opens in the console. Only the owner can add funds, and only
 *  the owner's console lands in the add-credits dialog; anyone else goes to the
 *  billing page itself. */
export function usageActionUrl(action, { isBillingOwner = false } = {}) {
  if (action?.key === 'addFunds' && isBillingOwner) return MINDS_ADD_FUNDS_URL;
  return MINDS_BILLING_URL;
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
function freeState(free) {
  if (!free) return { out: false, low: false, available: false };
  if (free.limit === -1) return { out: false, low: false, available: true };
  if (!(free.limit > 0)) return { out: false, low: false, available: false };
  const remaining = Math.max(0, Number(free.remaining) || 0);
  return {
    out: remaining <= 0,
    low: remaining > 0 && remaining / free.limit <= FREE_TOKENS_LOW_FRACTION,
    available: remaining > 0,
    remaining,
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
    if (auto?.enabled && auto.status === 'ok') {
      const target = auto.rechargeToUsd != null ? formatUsd(auto.rechargeToUsd) : null;
      const floor = auto.thresholdUsd != null ? formatUsd(auto.thresholdUsd) : null;
      const detail = target && floor
        ? `Auto top up refills it to ${target} when it drops below ${floor}.`
        : 'Auto top up will cover it.';
      return { kind: 'balance_low', tone: 'warning', title, body: `${usd} left. ${detail}`, actions: [] };
    }
    if (auto?.enabled && auto.status === 'pending_action') {
      return {
        kind: 'balance_low',
        tone: 'warning',
        title,
        body: `${usd} left. Auto top up is waiting on your bank.`,
        actions: [],
      };
    }
    if (auto?.enabled && auto.status === 'cap_reached') {
      return {
        kind: 'balance_low',
        tone: 'warning',
        title,
        body: `${usd} left and auto top up hit its monthly cap. Add funds to keep going.`,
        actions: [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.manageAutoTopUp],
      };
    }
    return {
      kind: 'balance_low',
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
      title: `${formatTokensShort(f.remaining)} free tokens left`,
      body,
      actions,
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
  if (!before.out && after.out && !isExplicitPaidModel(pickedModelId(modelIn))) {
    out.push({ kind: 'free_used', resetsAt: next.freeTokens?.resetsAt || null });
  }
  if (prev.autoTopUp?.status !== 'payment_failed' && next.autoTopUp?.status === 'payment_failed') {
    out.push({ kind: 'auto_top_up_failed' });
  }
  return out;
}

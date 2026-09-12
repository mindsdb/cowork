import { describe, it, expect } from 'vitest';
import {
  deriveComposerWarning,
  usageTransitions,
  usageActionUrl,
  balanceDismissStep,
  freeDismissStep,
  countsAsWarning,
  formatPercentShort,
  formatUsd,
  formatResetDate,
  FREE_TOKENS_LOW_FRACTION,
  USAGE_ACTIONS,
} from './usageWarnings';
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL, MINDS_AUTO_TOP_UP_URL } from '../../lib/mindsUrls';

const RESET = '2099-09-11T12:00:00Z';

const usage = (over = {}) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens: { percentRemaining: 80, limit: 100, used: 20, remaining: 80, resetsAt: RESET },
  balance: { usd: 42.1, canConsume: true, hasToppedUp: true, alert: '' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
  ...over,
});

const labels = (w) => w.actions.map((a) => a.label);

describe('formatting', () => {
  it('renders the allowance as a whole percentage', () => {
    expect(formatPercentShort(0.124)).toBe('12%');
    expect(formatPercentShort(1)).toBe('100%');
    expect(formatPercentShort(0)).toBe('0%');
  });
  it('keeps a decimal below one percent, so a usable turn does not read as zero', () => {
    // 0.4% of the allowance is a real small turn for a caller who caches well,
    // and "0%" next to a working account is the reading this avoids.
    expect(formatPercentShort(0.004)).toBe('0.4%');
    expect(formatPercentShort(0.0004)).toBe('0%');
  });
  it('clamps a value outside the range rather than trusting it', () => {
    expect(formatPercentShort(1.5)).toBe('100%');
    expect(formatPercentShort(-1)).toBe('0%');
  });
  it('formats dollars with two decimals and keeps the sign', () => {
    expect(formatUsd(8.42)).toBe('$8.42');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(-0.25)).toBe('-$0.25');
  });
  it('formats the reset date short and tolerates junk', () => {
    expect(formatResetDate(RESET)).toMatch(/^Sep 1[12]$/);
    expect(formatResetDate('nope')).toBeNull();
    expect(formatResetDate(null)).toBeNull();
  });
});

describe('deriveComposerWarning', () => {
  it('says where a healthy allowance stands rather than nothing at all', () => {
    const w = deriveComposerWarning(usage());
    expect(w.kind).toBe('free_at_rest');
    expect(w.resting).toBe(true);
    expect(w.title).toBe('80% of your free allowance left');
    expect(w.body).toMatch(/^Resets on Sep 1[12]\.$/);
    expect(labels(w)).toEqual(['View usage']);
    // No dismissal key: the standing figure is not closable, so nothing can
    // key a dismissal to it.
    expect(w.dismissKey).toBeUndefined();
  });

  it('names the allowance even with no reset date to quote', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 80, limit: 100, used: 20, remaining: 80, resetsAt: null },
    }));
    expect(w.kind).toBe('free_at_rest');
    expect(w.body).toBe('Air runs on these until they are used up.');
  });

  it('a free warning carries the figure a dismissal steps down to', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 18, limit: 100, used: 82, remaining: 18, resetsAt: RESET },
    }));
    expect(w.kind).toBe('free_low');
    // Closing it must leave the allowance somewhere, not nowhere.
    expect(w.whenDismissed.kind).toBe('free_at_rest');
    expect(w.whenDismissed.resting).toBe(true);
    expect(w.whenDismissed.title).toBe('18% of your free allowance left');
    // And the figure is the same object the healthy state builds.
    expect(w.whenDismissed.dismissKey).toBeUndefined();
  });

  it('is quiet when signed out, unreachable, or on a BYOK provider', () => {
    expect(deriveComposerWarning(null)).toBeNull();
    expect(deriveComposerWarning(usage({ reachable: false }))).toBeNull();
    expect(deriveComposerWarning(usage({ freeTokens: { limit: 100, used: 95, remaining: 5 } }), { providerType: 'openai' })).toBeNull();
    // The standing figure obeys the same three silences: a healthy allowance is
    // still nothing to a signed-out, unreachable, or BYOK caller.
    expect(deriveComposerWarning(usage({ reachable: false }), { model: null })).toBeNull();
    expect(deriveComposerWarning(usage(), { providerType: 'openai' })).toBeNull();
  });

  it('shows no figure for an allowance there is nothing to count', () => {
    // Uncapped is auth's -1 sentinel, and 0 or a missing limit means no grant.
    // Neither has a number to count down, so neither gets a standing figure.
    expect(deriveComposerWarning(usage({ freeTokens: { limit: -1, used: 30 } }))).toBeNull();
    expect(deriveComposerWarning(usage({ freeTokens: null }))).toBeNull();
    expect(deriveComposerWarning(usage({ freeTokens: { limit: 0, used: 0, remaining: 0 } }))).toBeNull();
  });

  it('shows no figure to a pick that cannot spend the allowance', () => {
    expect(deriveComposerWarning(usage(), { model: 'claude-sonnet-4' })).toBeNull();
  });

  it('free tokens running low: names the count and what happens next, no top-up CTA', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 12.4, limit: 100, used: 87.6, remaining: 12.4, resetsAt: RESET },
    }));
    expect(w.kind).toBe('free_low');
    expect(w.title).toBe('12% of your free allowance left');
    expect(w.body).toMatch(/^After that, MindsHub Air uses your balance until your allowance refills on Sep 1[12]\.$/);
    expect(labels(w)).toEqual(['View usage']);
  });

  it('free tokens low AND balance low on Air: says both and offers funds', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 12.4, limit: 100, used: 87.6, remaining: 12.4, resetsAt: RESET },
      balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' },
    }), { model: 'mindshub_air' });
    expect(w.kind).toBe('free_low');
    expect(w.body).toContain('Your balance is low too ($8.42).');
    expect(labels(w)).toEqual(['View usage', 'Add funds']);
  });

  it('free tokens used, balance fine: an info note, not an error', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 0, limit: 100, used: 100, remaining: 0, resetsAt: RESET },
    }));
    expect(w.kind).toBe('free_used');
    expect(w.tone).toBe('info');
    expect(w.title).toBe('Free allowance used up');
    expect(w.body).toMatch(/^MindsHub Air is on your balance \(\$42\.10 left\) until your allowance refills on Sep 1[12]\.$/);
    expect(labels(w)).toEqual(['View usage']);
  });

  it('paid balance low without auto top up: Add funds + Set up auto top up', () => {
    const w = deriveComposerWarning(usage({
      balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' },
    }), { model: 'claude-sonnet-4' });
    expect(w.kind).toBe('balance_low');
    expect(w.title).toBe('Balance running low');
    expect(w.body).toBe('$8.42 left. Add funds or turn on auto top up.');
    expect(labels(w)).toEqual(['Add funds', 'Set up auto top up']);
  });

  it('paid balance low with auto top up on: explains the top up, no CTA', () => {
    const w = deriveComposerWarning(usage({
      balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' },
      autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'ok' },
    }), { model: 'claude-sonnet-4' });
    expect(w.body).toBe('$8.42 left. Auto top up refills it to $20.00 when it drops below $5.00.');
    expect(w.actions).toEqual([]);
  });

  it('paid balance low but auto top up capped: asks for funds', () => {
    const w = deriveComposerWarning(usage({
      balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' },
      autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'cap_reached' },
    }), { model: 'claude-sonnet-4' });
    expect(w.body).toContain('hit its monthly cap');
    expect(labels(w)).toEqual(['Add funds', 'Manage auto top up']);
  });

  it('balance low while free Air tokens remain: no warning, just the standing figure', () => {
    const w = deriveComposerWarning(usage({
      balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' },
    }), { model: 'mindshub_air' });
    expect(w.kind).toBe('free_at_rest');
    expect(w.resting).toBe(true);
    // The low balance is not this pick's problem, so it stays out of the copy.
    expect(w.body).not.toContain('balance');
  });

  it('the router (the default pick) can spend either resource, so it hears about both', () => {
    const lowBalance = usage({ balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' } });
    expect(deriveComposerWarning(lowBalance, { model: 'model-router' })?.kind).toBe('balance_low');
    expect(deriveComposerWarning(lowBalance, { model: null })?.kind).toBe('balance_low');
    const lowFree = usage({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } });
    expect(deriveComposerWarning(lowFree, { model: 'model-router' })?.kind).toBe('free_low');
  });

  it('accepts the catalog option object the views pass as `model`', () => {
    const lowFree = usage({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } });
    expect(deriveComposerWarning(lowFree, { model: { id: 'model-router', name: 'Model Router' } })?.kind).toBe('free_low');
    expect(deriveComposerWarning(lowFree, { model: { id: 'claude-sonnet-4' } })).toBeNull();
  });

  it('an explicit paid model never hears about free tokens', () => {
    const lowFree = usage({ freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: RESET } });
    expect(deriveComposerWarning(lowFree, { model: 'claude-sonnet-4' })).toBeNull();
  });

  it('balance empty on a paid model', () => {
    const w = deriveComposerWarning(usage({
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
    }), { model: 'claude-sonnet-4' });
    expect(w.kind).toBe('balance_empty');
    expect(w.title).toBe('Balance empty');
    expect(w.body).toBe('Add funds to start another task.');
    expect(labels(w)).toEqual(['Add funds', 'Set up auto top up']);
  });

  it('balance empty but free tokens remain: the router and Air still run, so no stop sign', () => {
    // cowork-server swaps a wallet-locked model for Air while the grant lasts,
    // so the next task starts. Only an explicit paid pick is stuck.
    const depleted = usage({ balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' } });
    // A resting figure is a figure, not a stop sign: no danger tone and
    // nothing that reads as the next task being refused. It does still name
    // the empty wallet, in the warning's own words, because that is true and
    // actionable now rather than at 20% left — the same fact must not appear
    // to arrive with the threshold that has nothing to do with it.
    for (const model of ['model-router', null, 'mindshub_air']) {
      const w = deriveComposerWarning(depleted, { model });
      expect(w.kind).toBe('free_at_rest');
      expect(w.tone).toBe('resting');
      expect(w.body).toMatch(/Your balance is empty\.$/);
      expect(labels(w)).toEqual(['View usage', 'Add funds']);
    }
    // The disclosure does not hinge on the crossing: one token either side of
    // the 20% edge says the same thing about the wallet.
    const edge = (percent) => deriveComposerWarning(usage({
      freeTokens: { percentRemaining: percent, limit: 100, used: 100 - percent, remaining: percent, resetsAt: RESET },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
    }), { model: null });
    expect(edge(20.0001).kind).toBe('free_at_rest');
    expect(edge(20).kind).toBe('free_low');
    for (const w of [edge(20.0001), edge(20)]) {
      expect(w.body).toMatch(/Your balance is empty\.$/);
      expect(labels(w)).toContain('Add funds');
    }
    expect(deriveComposerWarning(depleted, { model: 'claude-sonnet-4' })?.kind).toBe('balance_empty');
    // Free tokens low as well: the free-token line carries the balance news.
    const depletedLowFree = usage({
      freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
    });
    const w = deriveComposerWarning(depletedLowFree, { model: 'model-router' });
    expect(w.kind).toBe('free_low');
    expect(w.body).toMatch(/Your balance is empty\.$/);
    expect(labels(w)).toEqual(['View usage', 'Add funds']);
    // An uncapped grant keeps Air free forever; no grant at all leaves only the balance.
    expect(deriveComposerWarning(usage({
      freeTokens: { limit: -1, used: 10, remaining: -1 },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
    }), { model: 'model-router' })).toBeNull();
    expect(deriveComposerWarning(usage({
      freeTokens: null,
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
    }), { model: 'model-router' })?.kind).toBe('balance_empty');
    expect(deriveComposerWarning(usage({
      freeTokens: { limit: 0, used: 0, remaining: 0 },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
    }), { model: 'mindshub_air' })?.kind).toBe('balance_empty');
  });

  it('balance empty and free tokens used on Air: names both and the reset date', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 0, limit: 100, used: 100, remaining: 0, resetsAt: RESET },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
      autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'ok' },
    }));
    expect(w.kind).toBe('balance_empty');
    expect(w.body).toMatch(/^Your free allowance is used up too\. Add funds, or wait for it to refill on Sep 1[12]\.$/);
    expect(labels(w)).toEqual(['Add funds']);
  });

  it('auto top up failed wins over everything else', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 0, limit: 100, used: 100, remaining: 0, resetsAt: RESET },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
      autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'payment_failed' },
    }));
    expect(w.kind).toBe('auto_top_up_failed');
    expect(w.title).toBe('Auto top up failed');
    expect(labels(w)).toEqual(['Add funds', 'Update payment method']);
  });

  it('an uncapped grant never warns about free tokens', () => {
    expect(deriveComposerWarning(usage({ freeTokens: { limit: -1, used: 10, remaining: -1 } }))).toBeNull();
  });

  it('never says "out of tokens"', () => {
    const cases = [
      usage({ freeTokens: { limit: 100, used: 100, remaining: 0 } }),
      usage({ balance: { usd: 0, canConsume: false, alert: 'depleted' } }),
      usage({ balance: { usd: 1, canConsume: true, alert: 'low' } }),
    ];
    for (const u of cases) {
      const w = deriveComposerWarning(u, { model: 'claude-sonnet-4' });
      expect(`${w?.title} ${w?.body}`).not.toMatch(/out of tokens/i);
    }
  });
});

describe('usageTransitions', () => {
  const free = (percent) => usage({
    freeTokens: { percentRemaining: percent, limit: 100, used: 100 - percent, remaining: percent, resetsAt: RESET },
  });

  it('tells a running task when it crosses into the low band', () => {
    expect(usageTransitions(free(40), free(18))).toEqual([
      { kind: 'free_low', fractionLeft: 0.18, resetsAt: RESET },
    ]);
  });

  it('reports each step it crosses, not each poll', () => {
    // Draining inside one step is not news the task has not already had.
    expect(usageTransitions(free(18), free(16))).toEqual([]);
    // Crossing into the next one is.
    expect(usageTransitions(free(18), free(8))).toEqual([
      { kind: 'free_low', fractionLeft: 0.08, resetsAt: RESET },
    ]);
  });

  it('says the tokens are gone rather than low when a task empties them', () => {
    const t = usageTransitions(free(18), free(0));
    expect(t.map((c) => c.kind)).toEqual(['free_used']);
  });

  it('stays quiet on the low crossing for a task on an explicit paid model', () => {
    expect(usageTransitions(free(40), free(18), { model: 'claude-sonnet-4' })).toEqual([]);
  });

  it('does not read a grant appearing, or an uncapped one, as running low', () => {
    // These hold on the step comparison alone: a read with no fraction to
    // measure is the deepest step, which no later step can exceed. The
    // explicit guards in the branch are belt and braces, so deleting them
    // would not move this test — the comment there says as much.
    const uncapped = usage({ freeTokens: { limit: -1, used: 30 } });
    const none = usage({ freeTokens: null });
    expect(usageTransitions(none, free(18))).toEqual([]);
    expect(usageTransitions(uncapped, free(18))).toEqual([]);
    expect(usageTransitions(free(18), uncapped)).toEqual([]);
  });

  it('reports the deepest crossing too, not just the first two', () => {
    // 10% into 5%: the third mark, and the last one before free_used owns it.
    expect(usageTransitions(free(8), free(4))).toEqual([
      { kind: 'free_low', fractionLeft: 0.04, resetsAt: RESET },
    ]);
  });

  it('stays quiet for a BYOK task, the same silence the composer bar keeps', () => {
    // The poll is keyed on the MindsHub sign-in, not the planning provider, so
    // it keeps answering while a task bills someone else's key. That task
    // never spends these tokens, so a crossing is not its news.
    expect(usageTransitions(free(40), free(18), { providerType: 'openai' })).toEqual([]);
    expect(usageTransitions(free(18), free(0), { providerType: 'openai' })).toEqual([]);
    expect(usageTransitions(
      usage({ autoTopUp: { status: 'ok' } }),
      usage({ autoTopUp: { status: 'payment_failed' } }),
      { providerType: 'anthropic' },
    )).toEqual([]);
  });

  it('reports the free grant running out', () => {
    const t = usageTransitions(
      usage({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } }),
      usage({ freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: RESET } }),
    );
    expect(t).toEqual([{ kind: 'free_used', resetsAt: RESET }]);
  });
  it('skips the free-tokens news for a task on an explicit paid model, which was on the balance all along', () => {
    const before = usage({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } });
    const after = usage({
      freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: RESET },
      autoTopUp: { enabled: true, status: 'payment_failed' },
    });
    expect(usageTransitions(before, after, { model: 'claude-sonnet-4' })).toEqual([{ kind: 'auto_top_up_failed' }]);
    expect(usageTransitions(before, after, { model: { id: 'claude-sonnet-4' } })).toEqual([{ kind: 'auto_top_up_failed' }]);
    for (const model of ['model-router', 'mindshub_air', null]) {
      expect(usageTransitions(before, after, { model }).map((t) => t.kind)).toEqual(['free_used', 'auto_top_up_failed']);
    }
  });
  it('reports an auto top up that just failed', () => {
    const t = usageTransitions(
      usage(),
      usage({ autoTopUp: { enabled: true, status: 'payment_failed' } }),
    );
    expect(t).toEqual([{ kind: 'auto_top_up_failed' }]);
  });
  it('says nothing when nothing changed or a side is unreachable', () => {
    expect(usageTransitions(usage(), usage())).toEqual([]);
    expect(usageTransitions(null, usage())).toEqual([]);
    expect(usageTransitions(usage(), { reachable: false })).toEqual([]);
  });
});

describe('usageActionUrl', () => {
  it('sends the billing owner straight to add credits, everyone else to billing', () => {
    expect(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner: true })).toBe(MINDS_ADD_FUNDS_URL);
    expect(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner: false })).toBe(MINDS_BILLING_URL);
    expect(usageActionUrl(USAGE_ACTIONS.viewUsage, { isBillingOwner: true })).toBe(MINDS_BILLING_URL);
  });

  it('opens the auto top up form itself, so the offer is one click rather than a hunt', () => {
    expect(usageActionUrl(USAGE_ACTIONS.setUpAutoTopUp, { isBillingOwner: true })).toBe(MINDS_AUTO_TOP_UP_URL);
    expect(usageActionUrl(USAGE_ACTIONS.manageAutoTopUp, { isBillingOwner: true })).toBe(MINDS_AUTO_TOP_UP_URL);
  });

  it('a member gets the billing page for every action: the wallet controls are owner-only', () => {
    expect(usageActionUrl(USAGE_ACTIONS.setUpAutoTopUp, { isBillingOwner: false })).toBe(MINDS_BILLING_URL);
    expect(usageActionUrl(USAGE_ACTIONS.manageAutoTopUp, { isBillingOwner: false })).toBe(MINDS_BILLING_URL);
    expect(usageActionUrl(USAGE_ACTIONS.updatePaymentMethod, { isBillingOwner: false })).toBe(MINDS_BILLING_URL);
  });
});

describe('freeDismissStep', () => {
  it('steps down as the allowance drains, so a closed bar can ask again', () => {
    expect(freeDismissStep(0.4)).toBe(0);
    expect(freeDismissStep(0.19)).toBe(1);
    expect(freeDismissStep(0.1)).toBe(1);
    expect(freeDismissStep(0.09)).toBe(2);
    expect(freeDismissStep(0.05)).toBe(2);
    expect(freeDismissStep(0.04)).toBe(3);
    expect(freeDismissStep(0)).toBe(3);
  });

  it('makes step 0 mean "not low", so entering the band is itself a step', () => {
    // The scale has to carry the band's edge, or a task that runs from healthy
    // into the band would cross no mark and say nothing.
    expect(freeDismissStep(0.5)).toBe(0);
    expect(freeDismissStep(FREE_TOKENS_LOW_FRACTION - 0.001)).toBe(1);
  });

  it('leaves the exact band edge on step 0, which the band itself counts as low', () => {
    // `low` is `<=` the edge and a step is `<` each mark, so a read landing on
    // exactly 0.2 shows the bar and sits on step 0. Nothing downstream cares:
    // the key is opaque, and the only lost case is a task whose poll lands on
    // the edge exactly, which then reports on its next step instead.
    expect(freeDismissStep(FREE_TOKENS_LOW_FRACTION)).toBe(0);
    const atEdge = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 20, limit: 100, used: 80, remaining: 20, resetsAt: RESET },
    }));
    expect(atEdge.kind).toBe('free_low');
    expect(atEdge.dismissKey).toBe('free_low:0');
  });

  it('keys the free warning to the step, so one close does not hide it to zero', () => {
    const at = (percent) => deriveComposerWarning(usage({
      freeTokens: { percentRemaining: percent, limit: 100, used: 100 - percent, remaining: percent, resetsAt: RESET },
    }));
    expect(at(18).dismissKey).toBe('free_low:1');
    expect(at(8).dismissKey).toBe('free_low:2');
    expect(at(4).dismissKey).toBe('free_low:3');
    // Closing at 18% and again at 8% are different keys, which is the whole
    // point: the bar comes back rather than staying shut for the month.
    expect(at(18).dismissKey).not.toBe(at(8).dismissKey);
  });
});

describe('countsAsWarning', () => {
  it('a standing figure is not a warning, so dismissals are still forgotten', () => {
    // This is the whole of criterion 9. If a resting figure counted as a
    // warning, `usageHealthy` would be false for every free user all month,
    // the dismissal store would never be wiped, and a bar closed at 900K in
    // September would still be closed at 900K in October.
    const resting = deriveComposerWarning(usage());
    expect(resting.kind).toBe('free_at_rest');
    expect(countsAsWarning(resting)).toBe(false);
    // Nothing at all is likewise nothing to warn about.
    expect(countsAsWarning(null)).toBe(false);
  });

  it('every non-resting descriptor does count, including the one it steps down to', () => {
    const low = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 18, limit: 100, used: 82, remaining: 18, resetsAt: RESET },
    }));
    expect(countsAsWarning(low)).toBe(true);
    // The figure a dismissal falls back to is still not a warning: closing
    // the bar must not keep the account looking unhealthy forever.
    expect(countsAsWarning(low.whenDismissed)).toBe(false);
    expect(countsAsWarning(deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 0, limit: 100, used: 100, remaining: 0, resetsAt: RESET },
    })))).toBe(true);
    expect(countsAsWarning(deriveComposerWarning(usage({
      autoTopUp: { enabled: true, status: 'payment_failed' },
    })))).toBe(true);
  });
});

describe('balanceDismissStep', () => {
  it('steps down as the balance drains, so a closed bar can ask again', () => {
    expect(balanceDismissStep(18)).toBe(0);
    expect(balanceDismissStep(10)).toBe(0);
    expect(balanceDismissStep(9.99)).toBe(1);
    expect(balanceDismissStep(5)).toBe(1);
    expect(balanceDismissStep(4.99)).toBe(2);
    expect(balanceDismissStep(2.5)).toBe(2);
    expect(balanceDismissStep(2.49)).toBe(3);
    expect(balanceDismissStep(1)).toBe(3);
    expect(balanceDismissStep(0.99)).toBe(4);
    expect(balanceDismissStep(0)).toBe(4);
  });

  it('reads a missing or unparseable balance as empty rather than as healthy', () => {
    expect(balanceDismissStep(null)).toBe(4);
    expect(balanceDismissStep(undefined)).toBe(4);
  });

  it('every balance_low warning carries the step, and the step moves with the balance', () => {
    const at = (usd) => deriveComposerWarning(usage({
      balance: { usd, canConsume: true, hasToppedUp: true, alert: 'low' },
    }), { model: 'claude-sonnet-4' });
    expect(at(18).dismissKey).toBe('balance_low:0');
    expect(at(8.42).dismissKey).toBe('balance_low:1');
    expect(at(0.4).dismissKey).toBe('balance_low:4');
  });

  it('carries the step on the auto-top-up variants too, so none of them can stick', () => {
    const withAuto = (over) => deriveComposerWarning(usage({
      balance: { usd: 3.2, canConsume: true, hasToppedUp: true, alert: 'low' },
      autoTopUp: { enabled: true, thresholdUsd: 10, rechargeToUsd: 50, ...over },
    }), { model: 'claude-sonnet-4' });
    expect(withAuto({ status: 'ok' }).dismissKey).toBe('balance_low:2');
    expect(withAuto({ status: 'pending_action' }).dismissKey).toBe('balance_low:2');
    expect(withAuto({ status: 'cap_reached' }).dismissKey).toBe('balance_low:2');
  });
});

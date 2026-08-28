import { describe, it, expect } from 'vitest';
import {
  deriveComposerWarning,
  usageTransitions,
  usageActionUrl,
  formatTokensShort,
  formatUsd,
  formatResetDate,
  USAGE_ACTIONS,
} from './usageWarnings';
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL } from '../../lib/mindsUrls';

const RESET = '2099-09-11T12:00:00Z';

const usage = (over = {}) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens: { limit: 5_000_000, used: 1_000_000, remaining: 4_000_000, resetsAt: RESET },
  balance: { usd: 42.1, canConsume: true, hasToppedUp: true, alert: '' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
  ...over,
});

const labels = (w) => w.actions.map((a) => a.label);

describe('formatting', () => {
  it('abbreviates tokens the way the console does', () => {
    expect(formatTokensShort(620_000)).toBe('620K');
    expect(formatTokensShort(1_200_000)).toBe('1.2M');
    expect(formatTokensShort(5_000_000)).toBe('5M');
    expect(formatTokensShort(900)).toBe('900');
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
  it('is quiet when there is nothing to say', () => {
    expect(deriveComposerWarning(usage())).toBeNull();
  });

  it('is quiet when signed out, unreachable, or on a BYOK provider', () => {
    expect(deriveComposerWarning(null)).toBeNull();
    expect(deriveComposerWarning(usage({ reachable: false }))).toBeNull();
    expect(deriveComposerWarning(usage({ freeTokens: { limit: 100, used: 95, remaining: 5 } }), { providerType: 'openai' })).toBeNull();
  });

  it('free tokens running low: names the count and what happens next, no top-up CTA', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { limit: 5_000_000, used: 4_380_000, remaining: 620_000, resetsAt: RESET },
    }));
    expect(w.kind).toBe('free_low');
    expect(w.title).toBe('620K free tokens left');
    expect(w.body).toMatch(/^After that, MindsHub Air uses your balance until your free tokens reset on Sep 1[12]\.$/);
    expect(labels(w)).toEqual(['View usage']);
  });

  it('free tokens low AND balance low on Air: says both and offers funds', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { limit: 5_000_000, used: 4_380_000, remaining: 620_000, resetsAt: RESET },
      balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' },
    }), { model: 'mindshub_air' });
    expect(w.kind).toBe('free_low');
    expect(w.body).toContain('Your balance is low too ($8.42).');
    expect(labels(w)).toEqual(['View usage', 'Add funds']);
  });

  it('free tokens used, balance fine: an info note, not an error', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { limit: 5_000_000, used: 5_000_000, remaining: 0, resetsAt: RESET },
    }));
    expect(w.kind).toBe('free_used');
    expect(w.tone).toBe('info');
    expect(w.title).toBe('Free monthly tokens used');
    expect(w.body).toMatch(/^MindsHub Air is on your balance \(\$42\.10 left\) until your free tokens reset on Sep 1[12]\.$/);
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

  it('balance low while free Air tokens remain: nothing is about to break, stay quiet', () => {
    const w = deriveComposerWarning(usage({
      balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' },
    }), { model: 'mindshub_air' });
    expect(w).toBeNull();
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

  it('balance empty and free tokens used on Air: names both and the reset date', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { limit: 5_000_000, used: 5_000_000, remaining: 0, resetsAt: RESET },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
      autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'ok' },
    }));
    expect(w.kind).toBe('balance_empty');
    expect(w.body).toMatch(/^Free tokens are used up too\. Add funds, or wait for them to reset on Sep 1[12]\.$/);
    expect(labels(w)).toEqual(['Add funds']);
  });

  it('auto top up failed wins over everything else', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { limit: 5_000_000, used: 5_000_000, remaining: 0, resetsAt: RESET },
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
  it('reports the free grant running out', () => {
    const t = usageTransitions(
      usage({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } }),
      usage({ freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: RESET } }),
    );
    expect(t).toEqual([{ kind: 'free_used', resetsAt: RESET }]);
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
});

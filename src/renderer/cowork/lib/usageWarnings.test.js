import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  deriveComposerWarning,
  deriveUsageWarning,
  usageTransitions,
  usageActionUrl,
  balanceDismissStep,
  freeDismissStep,
  formatPercentShort,
  formatUsd,
  formatResetDate,
  formatResetTime,
  freeAllowanceState,
  airRoom,
  isBalanceEmpty,
  isBalanceUsable,
  modelAccessSignature,
  allowanceStopCopy,
  freeServingPausedCopy,
  budgetExceededCopy,
  NO_FREE_GRANT_SENTENCE,
  noFreeGrantSentence,
  FREE_TOKENS_LOW_FRACTION,
  USAGE_ACTIONS,
  BALANCE_WARN_USD,
  upgradeAction,
} from './usageWarnings';
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL, MINDS_AUTO_TOP_UP_URL } from '../../lib/mindsUrls';
import { compareCreditNotice } from './compareSides';

const RESET = '2099-09-11T12:00:00Z';

const usage = (over = {}) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens: { percentRemaining: 80, limit: 100, used: 20, remaining: 80, resetsAt: RESET },
  balance: { usd: 42.1, canConsume: true, hasToppedUp: true, alert: '' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
  ...over,
});

// Someone the allowance can actually stop: no wallet to fall through to. The
// standing figure is theirs alone (ENG-2749), at any level; 28% is just a
// number to read back. `usage()` above, with $42.10 in the wallet, keeps
// working when the allowance runs out and gets no figure at any number.
const at = (percent) => ({ percentRemaining: percent, limit: 100, used: 100 - percent, remaining: percent, resetsAt: RESET });
const unpaid = (over = {}) => usage({ balance: null, freeTokens: at(28), ...over });
// A balance under the $5 line (ENG-4188/ENG-4208): the allowance running low
// is still news to it, unlike to a balance that carries Air past it.
const SHORT = { usd: 3.2, canConsume: true, hasToppedUp: true, alert: 'low' };

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
  it('keeps a decimal above ninety-nine, so "used" and "left" cannot contradict', () => {
    // Settings prints the used share beside the remaining one. Rounding 99.6%
    // used to "100%" puts it next to "0.4% left" on the same row.
    expect(formatPercentShort(0.996)).toBe('99.6%');
    expect(formatPercentShort(1)).toBe('100%');
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

  // It refills every few hours, so a date names a day the reader is in already.
  describe('formatResetTime', () => {
    const NOW = new Date('2026-09-14T09:00:00Z');

    it('gives the clock time alone when the refill is later today', () => {
      expect(formatResetTime('2026-09-14T14:15:00Z', NOW)).toBe('2:15 PM');
    });

    it('adds the date only when the refill lands on another local day', () => {
      // A window crossing midnight must not read as a time already past.
      expect(formatResetTime('2026-09-15T02:15:00Z', NOW)).toBe('Sep 15, 2:15 AM');
    });

    it('says nothing at all about a refill already past', () => {
      // A stale time reads as imminent in a way a stale date never did.
      expect(formatResetTime('2026-09-14T08:59:00Z', NOW)).toBeNull();
      expect(formatResetTime(NOW.toISOString(), NOW)).toBeNull();
    });

    it('says nothing when there is nothing usable to quote', () => {
      expect(formatResetTime('nope', NOW)).toBeNull();
      expect(formatResetTime(null, NOW)).toBeNull();
    });

    // At TZ=UTC a same-UTC-day test and a same-local-day test agree. West of
    // UTC they part company, and only the local one is right.
    describe('west of UTC', () => {
      const realTz = process.env.TZ;
      beforeEach(() => { process.env.TZ = 'America/Los_Angeles'; });
      afterEach(() => { process.env.TZ = realTz; });

      it('keeps the time bare when the refill is a different UTC day but the same local one', () => {
        // 23:00Z is 4pm in LA and 01:15Z is 6:15pm the same evening. A UTC
        // comparison would wrongly prepend "Sep 15" to tonight.
        expect(formatResetTime('2026-09-15T01:15:00Z', new Date('2026-09-14T23:00:00Z'))).toBe('6:15 PM');
      });

      it('names the LOCAL date when the refill really is another day', () => {
        expect(formatResetTime('2026-09-15T08:30:00Z', new Date('2026-09-14T23:00:00Z'))).toBe('Sep 15, 1:30 AM');
      });
    });
  });
});

describe('deriveComposerWarning', () => {
  it('says nothing while the allowance has room, whatever the wallet holds (ENG-4719)', () => {
    // The standing figure is gone for everyone: with room left the next task
    // runs, so there is nothing to do. Settings → Usage still shows the number.
    for (const percent of [100, 80, 30, 21, 20, 11, 10.5]) {
      expect(deriveComposerWarning(unpaid({ freeTokens: at(percent) })), `${percent}% left, no wallet`).toBeNull();
      expect(deriveComposerWarning(unpaid({ freeTokens: { ...at(percent), resetsAt: null } }))).toBeNull();
      expect(deriveComposerWarning(usage({
        freeTokens: at(percent), balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
      })), `${percent}% left, empty wallet`).toBeNull();
    }
  });

  it('warns once 10% or less is left, for someone the wallet cannot carry', () => {
    expect(deriveComposerWarning(unpaid({ freeTokens: at(10) }))?.kind).toBe('free_low');
    expect(deriveComposerWarning(unpaid({ freeTokens: at(10.0001) }))).toBeNull();
  });

  it('says nothing to someone with a balance to fall through to while the allowance has room', () => {
    for (const model of ['mindshub_air', 'model-router', null]) {
      expect(deriveComposerWarning(usage({ freeTokens: at(28) }), { model })).toBeNull();
    }
    // A wallet auth has not flagged but that holds nothing: still room on the
    // allowance, so still nothing to say.
    expect(deriveComposerWarning(usage({
      freeTokens: at(28), balance: { usd: 0, canConsume: true, hasToppedUp: false, alert: '' },
    }))).toBeNull();
    // A short balance with room on the allowance: Air runs on the allowance.
    expect(deriveComposerWarning(usage({ freeTokens: at(28), balance: SHORT }), { model: 'mindshub_air' })).toBeNull();
    // The warning does reach them once both are nearly gone, and closing it
    // hides it until the next step: there is no figure to step down to.
    const w = deriveComposerWarning(usage({ balance: SHORT, freeTokens: at(8) }), { model: 'mindshub_air' });
    expect(w.kind).toBe('free_low');
    expect(w.whenDismissed).toBeUndefined();
  });

  it('says what happens next even with no reset date to quote', () => {
    const w = deriveComposerWarning(unpaid({ freeTokens: { ...at(8), resetsAt: null } }));
    expect(w.kind).toBe('free_low');
    expect(w.body).toBe('After that, free models use your balance until your allowance refills.');
  });

  it('a free warning closes to nothing, with no standing figure behind it', () => {
    const w = deriveComposerWarning(unpaid({ freeTokens: at(8) }));
    expect(w.kind).toBe('free_low');
    expect(w.whenDismissed).toBeUndefined();
  });

  it('is quiet when signed out, unreachable, or on a BYOK provider', () => {
    expect(deriveComposerWarning(null)).toBeNull();
    expect(deriveComposerWarning(usage({ reachable: false }))).toBeNull();
    expect(deriveComposerWarning(usage({ freeTokens: { limit: 100, used: 95, remaining: 5 } }), { providerType: 'openai' })).toBeNull();
    // The standing figure obeys the same three silences: a healthy allowance is
    // still nothing to a signed-out, unreachable, or BYOK caller.
    expect(deriveComposerWarning(unpaid({ reachable: false }), { model: null })).toBeNull();
    expect(deriveComposerWarning(unpaid(), { providerType: 'openai' })).toBeNull();
  });

  it('shows no figure for an allowance there is nothing to count', () => {
    // Uncapped is auth's -1 sentinel, and 0 or a missing limit means no grant.
    // Neither has a number to count down, so neither gets a standing figure.
    expect(deriveComposerWarning(unpaid({ freeTokens: { limit: -1, used: 30 } }))).toBeNull();
    expect(deriveComposerWarning(unpaid({ freeTokens: null }))).toBeNull();
    expect(deriveComposerWarning(unpaid({ freeTokens: { limit: 0, used: 0, remaining: 0 } }))).toBeNull();
  });

  it('shows no figure to a pick that cannot spend the allowance', () => {
    expect(deriveComposerWarning(unpaid(), { model: 'claude-sonnet-4' })).toBeNull();
  });

  it('free tokens nearly gone: names the count and what happens next, no top-up CTA', () => {
    const w = deriveComposerWarning(unpaid({
      freeTokens: { percentRemaining: 8.4, limit: 100, used: 91.6, remaining: 8.4, resetsAt: RESET },
    }));
    expect(w.kind).toBe('free_low');
    expect(w.title).toBe('8% of your free allowance left');
    expect(w.body).toMatch(/^After that, free models use your balance until your allowance refills at Sep 1[12], 12:00 PM\.$/);
    expect(labels(w)).toEqual(['View usage']);
  });

  it('free tokens nearly gone AND balance low: says both and offers funds, on Air or the router', () => {
    for (const model of ['mindshub_air', 'model-router', null]) {
      const w = deriveComposerWarning(usage({
        freeTokens: { percentRemaining: 8.4, limit: 100, used: 91.6, remaining: 8.4, resetsAt: RESET },
        balance: SHORT,
      }), { model });
      expect(w.kind).toBe('free_low');
      expect(w.body).toContain('Your balance is low too ($3.20).');
      expect(labels(w)).toEqual(['View usage', 'Add funds']);
    }
  });

  describe('free tokens used with a balance to fall through to (ENG-4188)', () => {
    const spent = { percentRemaining: 0, limit: 100, used: 100, remaining: 0, resetsAt: RESET };
    const wallet = (usd, alert = usd < 20 ? 'low' : '') => ({ usd, canConsume: true, hasToppedUp: true, alert });

    it('says nothing while the balance carries Air, on the router or on Air', () => {
      for (const usd of [199.48, 42.1, 12, BALANCE_WARN_USD]) {
        for (const model of [null, 'model-router', 'mindshub_air']) {
          expect(deriveComposerWarning(usage({ freeTokens: spent, balance: wallet(usd) }), { model })).toBeNull();
        }
      }
    });

    it('warns once the balance drops under $5, with the ways to add to it', () => {
      for (const model of [null, 'model-router', 'mindshub_air']) {
        const w = deriveComposerWarning(usage({ freeTokens: spent, balance: wallet(4.99) }), { model });
        expect(w.kind).toBe('balance_low');
        expect(w.tone).toBe('warning');
        expect(w.body).toBe('$4.99 left. Add funds or turn on auto top up.');
        expect(labels(w)).toEqual(['Add funds', 'Set up auto top up']);
      }
    });

    it('keys the close to the step it was made in, so it holds until the next mark', () => {
      const step = (usd) => deriveComposerWarning(usage({ freeTokens: spent, balance: wallet(usd) })).dismissKey;
      expect(step(4.2)).toBe(step(3));
      expect(step(2)).not.toBe(step(3));
      expect(step(0.5)).not.toBe(step(2));
    });

    it('says nothing under $5 while auto top up is working, since it refills itself', () => {
      const w = deriveComposerWarning(usage({
        freeTokens: spent,
        balance: wallet(3),
        autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 25, status: 'ok' },
      }));
      expect(w).toBeNull();
    });

    it('an explicit paid pick hears about the wallet only under $5 too (ENG-4719)', () => {
      expect(deriveComposerWarning(usage({ freeTokens: spent, balance: wallet(12) }), { model: 'claude-sonnet-4' })).toBeNull();
      expect(deriveComposerWarning(usage({ freeTokens: spent, balance: wallet(4.99) }), { model: 'claude-sonnet-4' })?.kind)
        .toBe('balance_low');
    });

    it('keeps the plain note when the wallet is unknown', () => {
      const w = deriveComposerWarning(usage({ freeTokens: spent, balance: null }), { model: 'mindshub_air' });
      expect(w.kind).toBe('free_used');
      expect(w.tone).toBe('info');
      expect(w.body).toMatch(/^Free models now use your balance until your allowance refills at Sep 1[12], 12:00 PM\.$/);
    });
  });

  it('paid balance under $5 without auto top up: Add funds + Set up auto top up', () => {
    const w = deriveComposerWarning(usage({
      balance: { usd: 4.2, canConsume: true, hasToppedUp: true, alert: 'low' },
    }), { model: 'claude-sonnet-4' });
    expect(w.kind).toBe('balance_low');
    expect(w.title).toBe('Balance running low');
    expect(w.body).toBe('$4.20 left. Add funds or turn on auto top up.');
    expect(labels(w)).toEqual(['Add funds', 'Set up auto top up']);
  });

  it('a paid pick with $5 or more says nothing, even under auth\'s $20 line (ENG-4719)', () => {
    for (const usd of [BALANCE_WARN_USD, 8.42, 19.99]) {
      expect(deriveComposerWarning(usage({
        balance: { usd, canConsume: true, hasToppedUp: true, alert: 'low' },
      }), { model: 'claude-sonnet-4' }), `$${usd}`).toBeNull();
    }
  });

  it('paid balance low with auto top up working: nothing, it refills itself', () => {
    expect(deriveComposerWarning(usage({
      balance: { usd: 3.2, canConsume: true, hasToppedUp: true, alert: 'low' },
      autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'ok' },
    }), { model: 'claude-sonnet-4' })).toBeNull();
  });

  it('paid balance low but auto top up capped: asks for funds', () => {
    const w = deriveComposerWarning(usage({
      balance: { usd: 4.2, canConsume: true, hasToppedUp: true, alert: 'low' },
      autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'cap_reached' },
    }), { model: 'claude-sonnet-4' });
    expect(w.body).toContain('paused to stay within its monthly cap');
    expect(labels(w)).toEqual(['Add funds', 'Manage auto top up']);
  });

  it('balance low while free Air tokens remain: nothing at all', () => {
    // The low balance is not this pick's problem, and a wallet that can still
    // pay means the allowance cannot stop them, so there is no figure either.
    expect(deriveComposerWarning(usage({
      freeTokens: at(28),
      balance: { usd: 8.42, canConsume: true, hasToppedUp: true, alert: 'low' },
    }), { model: 'mindshub_air' })).toBeNull();
  });

  it('the router (the default pick) hears about the wallet only once the allowance is nearly gone', () => {
    // Allowance with room: the router runs on it, whatever the wallet holds.
    const lowBalance = usage({ balance: { usd: 4.2, canConsume: true, hasToppedUp: true, alert: 'low' } });
    expect(deriveComposerWarning(lowBalance, { model: 'model-router' })).toBeNull();
    expect(deriveComposerWarning(lowBalance, { model: null })).toBeNull();
    // Nearly gone and a short wallet: one warning naming both.
    const lowFree = usage({ balance: SHORT, freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } });
    expect(deriveComposerWarning(lowFree, { model: 'model-router' })?.kind).toBe('free_low');
    // Used up and a short wallet: the wallet is all that is left.
    const spentFree = usage({ balance: SHORT, freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: RESET } });
    expect(deriveComposerWarning(spentFree, { model: 'model-router' })?.kind).toBe('balance_low');
    // Nearly gone with a balance that carries Air: no bar (ENG-4208).
    expect(deriveComposerWarning(usage({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } }), { model: 'mindshub_air' })).toBeNull();
  });

  it('accepts the catalog option object the views pass as `model`', () => {
    const lowFree = unpaid({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } });
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
    // so the next task starts. Only an explicit paid pick is stuck. With room
    // on the allowance there is nothing to say at all (ENG-4719).
    const depleted = usage({ freeTokens: at(28), balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' } });
    for (const model of ['model-router', null, 'mindshub_air']) {
      expect(deriveComposerWarning(depleted, { model })).toBeNull();
    }
    // At 10% left the warning appears and names the empty wallet.
    const edge = (percent) => deriveComposerWarning(usage({
      freeTokens: { percentRemaining: percent, limit: 100, used: 100 - percent, remaining: percent, resetsAt: RESET },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
    }), { model: null });
    expect(edge(10.0001)).toBeNull();
    expect(edge(10).kind).toBe('free_low');
    expect(edge(10).body).toMatch(/Your balance is empty\.$/);
    expect(labels(edge(10))).toContain('Add funds');
    expect(deriveComposerWarning(depleted, { model: 'claude-sonnet-4' })?.kind).toBe('balance_empty');
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

  it('balance empty and free tokens used on Air: names both and the refill time', () => {
    const w = deriveComposerWarning(usage({
      freeTokens: { percentRemaining: 0, limit: 100, used: 100, remaining: 0, resetsAt: RESET },
      balance: { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' },
      autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'ok' },
    }));
    expect(w.kind).toBe('balance_empty');
    expect(w.body).toMatch(/^Your free allowance is used up too\. Add funds, or wait for it to refill at Sep 1[12], 12:00 PM\.$/);
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
  const short = (percent) => usage({
    balance: SHORT,
    freeTokens: { percentRemaining: percent, limit: 100, used: 100 - percent, remaining: percent, resetsAt: RESET },
  });

  it('keeps quiet about the allowance running low on a balance that carries Air (ENG-4208)', () => {
    expect(usageTransitions(free(40), free(8))).toEqual([]);
  });

  it('keeps quiet while the allowance has room, even crossing 20% (ENG-4719)', () => {
    expect(usageTransitions(short(40), short(18))).toEqual([]);
    expect(usageTransitions(unpaid({ freeTokens: at(25) }), unpaid({ freeTokens: at(12) }))).toEqual([]);
  });

  it('tells a running task when the allowance becomes nearly gone', () => {
    expect(usageTransitions(short(18), short(10))).toEqual([
      { kind: 'free_low', fractionLeft: 0.1, resetsAt: RESET },
    ]);
    expect(usageTransitions(short(40), short(8))).toEqual([
      { kind: 'free_low', fractionLeft: 0.08, resetsAt: RESET },
    ]);
  });

  it('reports each step it crosses, not each poll', () => {
    // Draining inside one step is not news the task has not already had.
    expect(usageTransitions(short(9), short(6))).toEqual([]);
    // Crossing into the next one is.
    expect(usageTransitions(short(10), short(8))).toEqual([
      { kind: 'free_low', fractionLeft: 0.08, resetsAt: RESET },
    ]);
  });

  it('says the tokens are gone rather than low when a task empties them', () => {
    const t = usageTransitions(unpaid({ freeTokens: at(18) }), unpaid({ freeTokens: at(0) }));
    expect(t.map((c) => c.kind)).toEqual(['free_used']);
  });

  it('keeps quiet when the tokens run out on a balance that carries Air (ENG-4188)', () => {
    expect(usageTransitions(free(18), free(0))).toEqual([]);
    const short = { usd: 3, canConsume: true, hasToppedUp: true, alert: 'low' };
    expect(usageTransitions(usage({ freeTokens: at(18), balance: short }), usage({ freeTokens: at(0), balance: short }))
      .map((c) => c.kind)).toEqual(['free_used']);
  });

  it('stays quiet on the low crossing for a task on an explicit paid model', () => {
    expect(usageTransitions(short(40), short(8), { model: 'claude-sonnet-4' })).toEqual([]);
  });

  it('does not read a grant appearing, or an uncapped one, as running low', () => {
    // These hold on the step comparison alone: a read with no fraction to
    // measure is the deepest step, which no later step can exceed. The
    // explicit guards in the branch are belt and braces, so deleting them
    // would not move this test — the comment there says as much.
    const uncapped = usage({ freeTokens: { limit: -1, used: 30 } });
    const none = usage({ freeTokens: null });
    expect(usageTransitions(none, short(8))).toEqual([]);
    expect(usageTransitions(uncapped, short(8))).toEqual([]);
    expect(usageTransitions(short(8), uncapped)).toEqual([]);
  });

  it('reports the deepest crossing too, not just the first two', () => {
    // 10% into 5%: the third mark, and the last one before free_used owns it.
    expect(usageTransitions(short(8), short(4))).toEqual([
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
      unpaid({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } }),
      unpaid({ freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: RESET } }),
    );
    expect(t).toEqual([{ kind: 'free_used', resetsAt: RESET }]);
  });
  it('skips the free-tokens news for a task on an explicit paid model, which was on the balance all along', () => {
    const before = usage({ freeTokens: { limit: 100, used: 90, remaining: 10, resetsAt: RESET } });
    const after = usage({
      freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: RESET },
      balance: { usd: 3, canConsume: true, hasToppedUp: true, alert: 'low' },
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

describe('freeAllowanceState', () => {
  it('says a capped grant with tokens left has room, with its refill time', () => {
    expect(freeAllowanceState(usage())).toEqual({ status: 'has_room', resetsAt: RESET });
    // A sliver left is still room: Air runs on it.
    expect(freeAllowanceState(usage({ freeTokens: { ...at(1), remaining: 0.5 } })).status).toBe('has_room');
  });

  it('says a capped grant with nothing left is spent, and still carries the refill time', () => {
    expect(freeAllowanceState(usage({ freeTokens: at(0) }))).toEqual({ status: 'spent', resetsAt: RESET });
  });

  it('reads a negative remaining count as spent rather than trusting it', () => {
    expect(freeAllowanceState(usage({ freeTokens: { ...at(0), remaining: -3 } })).status).toBe('spent');
  });

  it('gives no figure for an uncapped grant, which has nothing to count down', () => {
    // The uncapped sentinel is -1. Reading it as "room" would put a claim on a
    // card that no number backs.
    expect(freeAllowanceState(usage({ freeTokens: { limit: -1, used: 30, resetsAt: RESET } })))
      .toEqual({ status: 'no_figure', resetsAt: RESET });
  });

  it('gives no figure when there is no grant to draw from', () => {
    expect(freeAllowanceState(usage({ freeTokens: null })).status).toBe('no_figure');
    /* Retargeted from 'no_figure': a limit of 0 is the sidecar's explicit
       no-grant value, which now has its own status so a card can say "no
       grant" rather than falling back. It is still never room or spent. */
    expect(freeAllowanceState(usage({ freeTokens: { limit: 0, used: 0, remaining: 0 } })).status).toBe('no_grant');
  });

  it('gives no figure and no time when signed out or unreachable', () => {
    expect(freeAllowanceState(null)).toEqual({ status: 'no_figure', resetsAt: null });
    expect(freeAllowanceState({ reachable: false })).toEqual({ status: 'no_figure', resetsAt: null });
    // A dark read never lends its stale refill time to a card.
    expect(freeAllowanceState({ reachable: false, freeTokens: at(0) })).toEqual({ status: 'no_figure', resetsAt: null });
  });

  it('carries a missing refill time as null, never as a string to format', () => {
    expect(freeAllowanceState(usage({ freeTokens: { ...at(0), resetsAt: undefined } })))
      .toEqual({ status: 'spent', resetsAt: null });
  });

  describe('an org with no free grant', () => {
    it('reads limit 0 as no grant, and names no refill time even when a sidecar relays one', () => {
      /* An older sidecar still passes auth's next_refresh_at through for a
         no-grant org. Nothing refills there, so the time must not reach a card. */
      expect(freeAllowanceState(usage({ freeTokens: { limit: 0, used: 0, remaining: 0, resetsAt: RESET } })))
        .toEqual({ status: 'no_grant', resetsAt: null });
    });

    it.each([
      ['a spent capped grant', { ...at(0) }],
      ['a capped grant with room', { ...at(40) }],
      ['the uncapped sentinel', { limit: -1, used: 3, resetsAt: RESET }],
      ['a figure with no limit at all', {}],
    ])('never reads %s as no grant', (_label, freeTokens) => {
      expect(freeAllowanceState(usage({ freeTokens })).status).not.toBe('no_grant');
    });

    it('never reads a missing read as no grant: unknown is not "no grant"', () => {
      expect(freeAllowanceState(null).status).toBe('no_figure');
      expect(freeAllowanceState({ reachable: false, freeTokens: { limit: 0 } }).status).toBe('no_figure');
      expect(freeAllowanceState(usage({ freeTokens: null })).status).toBe('no_figure');
    });
  });
});

describe('NO_FREE_GRANT_SENTENCE', () => {
  it('is the English no-grant sentence, and names no model', () => {
    expect(NO_FREE_GRANT_SENTENCE).toBe('This account does not include free tokens. Every model uses your balance.');
    expect(noFreeGrantSentence()).toBe(NO_FREE_GRANT_SENTENCE);
  });
});

describe('isBalanceEmpty', () => {
  it.each([
    ['depleted', { usd: 0, canConsume: false, alert: 'depleted' }],
    ['flagged depleted while auth still lets it draw', { usd: 0, canConsume: true, alert: 'depleted' }],
    ['barred from drawing with no alert', { usd: 0.4, canConsume: false, alert: null }],
  ])('reads a wallet %s as empty', (_label, balance) => {
    expect(isBalanceEmpty(balance)).toBe(true);
  });

  it.each([
    ['funded', { usd: 20, canConsume: true, alert: null }],
    ['low but still payable', { usd: 3, canConsume: true, alert: 'low' }],
    ['missing from the read', null],
  ])('does not read a wallet %s as empty', (_label, balance) => {
    expect(isBalanceEmpty(balance)).toBe(false);
  });
});

describe('isBalanceUsable', () => {
  it.each([
    ['funded', { usd: 20, canConsume: true, alert: null }],
    ['low but still payable', { usd: 3, canConsume: true, alert: 'low' }],
  ])('reads a wallet %s as usable', (_label, balance) => {
    expect(isBalanceUsable(balance)).toBe(true);
  });

  it.each([
    ['depleted', { usd: 0, canConsume: false, alert: 'depleted' }],
    ['barred from drawing', { usd: 0.4, canConsume: false, alert: null }],
    ['unflagged but holding nothing', { usd: 0, canConsume: true, alert: null }],
    ['missing from the read', null],
  ])('does not read a wallet %s as usable', (_label, balance) => {
    expect(isBalanceUsable(balance)).toBe(false);
  });
});

describe('modelAccessSignature', () => {
  it('has no signature for an unreachable or missing read', () => {
    expect(modelAccessSignature(null)).toBeNull();
    expect(modelAccessSignature({ reachable: false })).toBeNull();
  });

  it('changes when the wallet empties or fills', () => {
    const funded = modelAccessSignature(usage());
    const empty = modelAccessSignature(usage({ balance: { usd: 0, canConsume: false, alert: 'depleted' } }));
    expect(empty).not.toBe(funded);
  });

  it('changes when the free allowance is spent', () => {
    expect(modelAccessSignature(usage({ freeTokens: at(0) }))).not.toBe(modelAccessSignature(usage()));
  });

  it('reads the wallet from walletCanConsume for a member whose balance is null', () => {
    const member = (walletCanConsume) => usage({ isBillingOwner: false, balance: null, autoTopUp: null, walletCanConsume });
    expect(modelAccessSignature(member(true))).not.toBe(modelAccessSignature(member(false)));
  });

  it('prefers walletCanConsume over the balance when both are present', () => {
    expect(modelAccessSignature(usage({ walletCanConsume: false }))).toBe(
      modelAccessSignature(usage({ balance: { usd: 0, canConsume: false, alert: 'depleted' } })),
    );
  });

  it('falls back to the balance when walletCanConsume is absent (older servers)', () => {
    const empty = usage({ balance: { usd: 0, canConsume: false, alert: 'depleted' } });
    expect(modelAccessSignature(empty)).not.toBe(modelAccessSignature(usage()));
    expect(modelAccessSignature({ ...empty, walletCanConsume: null })).toBe(modelAccessSignature(empty));
  });

  it('ignores a balance amount change that does not cross empty', () => {
    expect(modelAccessSignature(usage({ balance: { usd: 3, canConsume: true, alert: 'low' } })))
      .toBe(modelAccessSignature(usage()));
  });
});

describe('allowanceStopCopy', () => {
  const SOON = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const LATER = new Date(Date.now() + 5 * 3600 * 1000).toISOString();

  it('tells a no-grant org so, with no refill clause, even when the gate sent a time', () => {
    const copy = allowanceStopCopy({ resetAt: SOON, usage: usage({ freeTokens: { limit: 0, used: 0, remaining: 0 } }) });
    expect(copy).toBe(`${NO_FREE_GRANT_SENTENCE} Your balance is empty, so add funds to continue.`);
    expect(copy).not.toMatch(/refill/i);
    expect(copy).not.toContain(formatResetTime(SOON));
  });

  it("names the gate's refill time for an org with a grant", () => {
    expect(allowanceStopCopy({ resetAt: SOON, usage: usage({ freeTokens: { ...at(0), resetsAt: LATER } }) }))
      .toBe(`Your free allowance is used up and your balance is empty. Add funds to keep working, or wait for it to refill at ${formatResetTime(SOON)}.`);
  });

  it('falls back to the hub usage refill time when the gate sent none', () => {
    expect(allowanceStopCopy({ resetAt: null, usage: usage({ freeTokens: { ...at(0), resetsAt: LATER } }) }))
      .toBe(`Your free allowance is used up and your balance is empty. Add funds to keep working, or wait for it to refill at ${formatResetTime(LATER)}.`);
  });

  it("keeps the gate's time when hub usage is unknown", () => {
    expect(allowanceStopCopy({ resetAt: SOON, usage: null }))
      .toBe(`Your free allowance is used up and your balance is empty. Add funds to keep working, or wait for it to refill at ${formatResetTime(SOON)}.`);
  });

  it.each([
    ['no time from the gate and hub usage unreachable', { usage: { reachable: false } }],
    ['no time from the gate and no hub usage at all', {}],
    ['an uncapped grant with no time from the gate', { usage: usage({ freeTokens: { limit: -1, used: 3, resetsAt: null } }) }],
    ['a time from the gate that is already past', { resetAt: new Date(Date.now() - 3600 * 1000).toISOString(), usage: null }],
  ])('offers funds alone, and promises no refill, with %s', (_label, args) => {
    /* Without a usable time nothing says the allowance refills at all, and
       the org may have no grant to refill. */
    const copy = allowanceStopCopy(args);
    expect(copy).toBe('Your free allowance is used up and your balance is empty. Add funds to keep working.');
    expect(copy).not.toMatch(/refill|wait/i);
  });

  it('never states the size or the length of the allowance, and uses no em-dash', () => {
    for (const copy of [
      allowanceStopCopy({ resetAt: SOON, usage: usage({ freeTokens: { ...at(0) } }) }),
      allowanceStopCopy({ usage: usage({ freeTokens: { limit: 0 } }) }),
    ]) {
      expect(copy).not.toMatch(/month|daily|weekly|hour|\d+ ?(k|m|tokens)/i);
      expect(copy).not.toContain('\u2014');
    }
  });
});

describe('freeServingPausedCopy', () => {
  it('names when the fuse lifts, or the event when there is no usable time', () => {
    const lifts = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    expect(freeServingPausedCopy(lifts)).toBe(
      `Free models are paused for everyone until ${formatResetTime(lifts)}. This doesn't use your allowance. Add funds to keep working now.`,
    );
    expect(freeServingPausedCopy(null)).toBe(
      "Free models are paused for everyone until the daily budget resets. This doesn't use your allowance. Add funds to keep working now.",
    );
  });
});

describe('budgetExceededCopy', () => {
  const RAISE = "Paid models can't run until an administrator raises it in Budgets.";

  it('names Air only while its free allowance has room', () => {
    expect(budgetExceededCopy({ usage: usage() })).toBe(`${RAISE} MindsHub Air still works while your free allowance lasts.`);
  });

  it.each([
    ['a spent allowance', usage({ freeTokens: at(0) })],
    ['an org with no free grant', usage({ freeTokens: { limit: 0, used: 0, remaining: 0 } })],
    ['unreachable hub usage', { reachable: false }],
    ['no hub usage at all', null],
  ])('says only who raises it with %s', (_label, u) => {
    expect(budgetExceededCopy({ usage: u })).toBe(RAISE);
  });

  it.each([
    ['org', "Paid models can't run until an owner or admin raises it in Budgets."],
    ['workspace', RAISE],
    ['api_key', RAISE],
    ['team', RAISE],
    [null, RAISE],
  ])('names who can raise a %s budget', (scope, expected) => {
    expect(budgetExceededCopy({ usage: null, budgetScope: scope })).toBe(expected);
  });

  it.each([
    ['org', "Claude Haiku can't run until an owner or admin raises it in Budgets. Other models still work."],
    ['workspace', "Claude Haiku can't run until an administrator raises it in Budgets. Other models still work."],
  ])('names the model a per-model %s budget stops, with or without Air room', (scope, expected) => {
    expect(budgetExceededCopy({ usage: null, budgetScope: scope, budgetModelLabel: 'Claude Haiku' })).toBe(expected);
    expect(budgetExceededCopy({ usage: usage(), budgetScope: scope, budgetModelLabel: 'Claude Haiku' })).toBe(expected);
  });

  it('never asks for credits or funds', () => {
    for (const copy of [budgetExceededCopy({ usage: usage() }), budgetExceededCopy()]) {
      expect(copy).not.toMatch(/credit|fund/i);
    }
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

  it('leaves the exact band edge on step 0', () => {
    // A step is `<` each mark, so a read landing on exactly 0.2 sits on step 0.
    // The key is opaque, so nothing downstream cares.
    expect(freeDismissStep(FREE_TOKENS_LOW_FRACTION)).toBe(0);
  });

  it('keys the free warning to the step, so one close does not hide it to zero', () => {
    const at = (percent) => deriveComposerWarning(unpaid({
      freeTokens: { percentRemaining: percent, limit: 100, used: 100 - percent, remaining: percent, resetsAt: RESET },
    }));
    expect(at(10).dismissKey).toBe('free_low:1');
    expect(at(8).dismissKey).toBe('free_low:2');
    expect(at(4).dismissKey).toBe('free_low:3');
    // Closing at 8% and again at 4% are different keys, which is the whole
    // point: the bar comes back rather than staying shut until it runs out.
    expect(at(8).dismissKey).not.toBe(at(4).dismissKey);
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
    expect(at(4.99).dismissKey).toBe('balance_low:2');
    expect(at(2).dismissKey).toBe('balance_low:3');
    expect(at(0.4).dismissKey).toBe('balance_low:4');
  });

  it('carries the step on the auto-top-up variants too, so none of them can stick', () => {
    const withAuto = (over) => deriveComposerWarning(usage({
      balance: { usd: 3.2, canConsume: true, hasToppedUp: true, alert: 'low' },
      autoTopUp: { enabled: true, thresholdUsd: 10, rechargeToUsd: 50, ...over },
    }), { model: 'claude-sonnet-4' });
    expect(withAuto({ status: 'pending_action' }).dismissKey).toBe('balance_low:2');
    expect(withAuto({ status: 'cap_reached' }).dismissKey).toBe('balance_low:2');
  });
});

// ── ENG-4186: Free, Plus and Pro ───────────────────────────────────────────
const IN_2H = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
const IN_2D = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
const planRead = (tier, windows = [], over = {}) => usage({
  plan: { tier, status: 'active', renewsAt: null, cancelAtPeriodEnd: false, windows },
  ...over,
});
const EMPTY_WALLET = { balance: { usd: 0, canConsume: false, alert: 'depleted' } };

describe('upgrade actions', () => {
  it('labels each tier and opens the plan confirm for the named organization', () => {
    expect(upgradeAction('plus').label).toBe('Get Plus');
    expect(upgradeAction('pro').label).toBe('Upgrade to Pro');
    expect(USAGE_ACTIONS.upgrade.label).toBe('Upgrade');
    const url = new URL(usageActionUrl(upgradeAction('pro'), { organizationId: 'org-1', subject: 'u-1' }));
    expect(url.searchParams.get('upgrade')).toBe('pro');
    expect(url.searchParams.get('organization')).toBe('org-1');
    // Not owner-gated here: the console checks who may buy.
    expect(new URL(usageActionUrl(upgradeAction('plus'), { isBillingOwner: false })).searchParams.get('upgrade')).toBe('plus');
  });
});

describe('deriveComposerWarning on a plan', () => {
  it('reads exactly as before with no plan or a Free plan', () => {
    for (const over of [{}, EMPTY_WALLET, { freeTokens: at(10) }]) {
      const before = deriveComposerWarning(usage(over), { model: null });
      expect(deriveComposerWarning(usage({ ...over, plan: null }), { model: null })).toEqual(before);
      expect(deriveComposerWarning(planRead('free', [], over), { model: null })).toEqual(before);
    }
  });

  it('says nothing on Plus while both windows have room, even with an empty wallet', () => {
    expect(deriveComposerWarning(planRead('plus', [{ window: '5h', percentUsed: 30, resetsAt: IN_2H }], EMPTY_WALLET), {
      model: 'claude-haiku-4-5',
    })).toBeNull();
  });

  it('says nothing at 80% of a window: the task is not about to stop (ENG-4719)', () => {
    expect(deriveComposerWarning(planRead('plus', [{ window: '5h', percentUsed: 84, resetsAt: IN_2H }], EMPTY_WALLET))).toBeNull();
  });

  it('warns at 90% of a window with a wallet that cannot carry it, stepped for dismissal, with Pro on offer', () => {
    const w = deriveComposerWarning(planRead('plus', [{ window: '5h', percentUsed: 91, resetsAt: IN_2H }], EMPTY_WALLET));
    expect(w.kind).toBe('window_low');
    expect(w.title).toBe('91% of your 5-hour allowance used');
    expect(w.body).toMatch(/^After that, tasks pause until .+\.$/);
    expect(w.dismissKey).toBe('window_low:5h:2');
    expect(w.actions.map((a) => a.key)).toEqual(['viewUsage', 'upgrade']);
    expect(w.actions[1].tier).toBe('pro');
    const later = deriveComposerWarning(planRead('plus', [{ window: '5h', percentUsed: 96, resetsAt: IN_2H }], EMPTY_WALLET));
    expect(later.dismissKey).toBe('window_low:5h:3');
    expect(`${w.title} ${w.body}`).not.toMatch(/\$|token/i);
  });

  it('says nothing about a window, even a full one, while the wallet carries the next task', () => {
    for (const percentUsed of [91, 100]) {
      expect(deriveComposerWarning(planRead('pro', [{ window: '7d', percentUsed, resetsAt: IN_2D }]))).toBeNull();
      expect(deriveComposerWarning(planRead('pro', [{ window: '7d', percentUsed, resetsAt: IN_2D }], {
        balance: { usd: 3, canConsume: true, alert: 'low' },
        autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 25, status: 'ok' },
      }))).toBeNull();
    }
  });

  it('at the cap with a short wallet, warns that it continues from the wallet', () => {
    const w = deriveComposerWarning(planRead('pro', [{ window: '7d', percentUsed: 100, resetsAt: IN_2D }], {
      balance: { usd: 3, canConsume: true, alert: 'low' },
    }));
    expect(w.kind).toBe('window_on_wallet');
    expect(w.tone).toBe('warning');
    expect(w.title).toBe('Weekly allowance used up');
    expect(w.body).toMatch(/Continuing from your wallet at API rates until it resets at/);
    // Nothing above Pro to offer.
    expect(w.actions.map((a) => a.key)).toEqual(['viewUsage']);
  });

  it('at the cap with an empty wallet, says paused until the reset and offers funds', () => {
    const w = deriveComposerWarning(planRead('plus', [{ window: '5h', percentUsed: 100, resetsAt: IN_2H }], EMPTY_WALLET));
    expect(w.kind).toBe('window_exhausted');
    expect(w.tone).toBe('danger');
    expect(w.body).toBe(`Tasks on your plan are paused until ${formatResetTime(IN_2H)}. Add funds to keep going.`);
    expect(w.actions.map((a) => a.key)).toEqual(['addFunds', 'upgrade']);
  });

  it('leaves a pick outside the plan to the wallet branches', () => {
    const read = planRead('plus', [{ window: '5h', percentUsed: 100, resetsAt: IN_2H }], EMPTY_WALLET);
    expect(deriveComposerWarning(read, { model: 'claude-opus-5-5', coveredByTier: 'pro' }).kind).toBe('balance_empty');
  });

  it('says nothing about plan windows on a provider other than MindsHub', () => {
    const full = planRead('plus', [{ window: '5h', percentUsed: 100, resetsAt: IN_2H }], EMPTY_WALLET);
    const half = planRead('plus', [{ window: '5h', percentUsed: 50, resetsAt: IN_2H }], EMPTY_WALLET);
    expect(deriveComposerWarning(full, { providerType: 'anthropic' })).toBeNull();
    expect(usageTransitions(half, full, { providerType: 'openai-compatible' })).toEqual([]);
  });
});

describe('usageTransitions on a plan', () => {
  const plus = (pct5h, over = {}) => planRead('plus', [
    { window: '5h', percentUsed: pct5h, resetsAt: IN_2H },
    { window: '7d', percentUsed: 20, resetsAt: IN_2D },
  ], over);

  const SHORT_WALLET = { balance: { usd: 3, canConsume: true, alert: 'low' } };

  it('reports a window once it is nearly gone, then once per step (ENG-4719)', () => {
    // 80% is not news: the task is not about to stop.
    expect(usageTransitions(plus(70, EMPTY_WALLET), plus(82, EMPTY_WALLET))).toEqual([]);
    expect(usageTransitions(plus(82, EMPTY_WALLET), plus(91, EMPTY_WALLET))).toEqual([
      { kind: 'window_low', window: '5h', percentUsed: 91, resetsAt: IN_2H },
    ]);
    expect(usageTransitions(plus(91, EMPTY_WALLET), plus(93, EMPTY_WALLET))).toEqual([]);
    expect(usageTransitions(plus(93, EMPTY_WALLET), plus(96, EMPTY_WALLET)).map((t) => t.kind)).toEqual(['window_low']);
  });

  it('reports a window filling up, and whether a short wallet carries on', () => {
    expect(usageTransitions(plus(95, SHORT_WALLET), plus(100, SHORT_WALLET))).toEqual([
      { kind: 'window_exhausted', window: '5h', resetsAt: IN_2H, onWallet: true },
    ]);
    expect(usageTransitions(plus(95, EMPTY_WALLET), plus(100, EMPTY_WALLET))[0].onWallet).toBe(false);
  });

  it('says nothing about the windows while the wallet carries the next task', () => {
    expect(usageTransitions(plus(82), plus(96))).toEqual([]);
    expect(usageTransitions(plus(95), plus(100))).toEqual([]);
  });

  it('says nothing when a plan arrives mid-task', () => {
    expect(usageTransitions(usage(), plus(100))).toEqual([]);
  });

  it('says nothing about the windows to a task on a model the plan does not cover', () => {
    // The task bills the wallet from the start, so the window is not its news.
    expect(usageTransitions(plus(82, EMPTY_WALLET), plus(91, EMPTY_WALLET), { coveredByTier: 'pro' })).toEqual([]);
    expect(usageTransitions(plus(95, EMPTY_WALLET), plus(100, EMPTY_WALLET), { coveredByTier: 'pro' })).toEqual([]);
    // A model the plan covers still hears about it.
    expect(usageTransitions(plus(82, EMPTY_WALLET), plus(91, EMPTY_WALLET), { coveredByTier: 'plus' }).map((t) => t.kind)).toEqual(['window_low']);
    expect(usageTransitions(plus(95, EMPTY_WALLET), plus(100, EMPTY_WALLET), { coveredByTier: 'free' }).map((t) => t.kind)).toEqual(['window_exhausted']);
  });

  it('never tells a task on Air or the router about a free allowance, since the figure is the plan window', () => {
    /* On Plus and Pro, auth's /me serves the plan's own windows in the flat
       allowance fields that cowork-server relays as freeTokens, so the figure
       falls as the fuller window fills. Only the window kinds are news. The
       short wallet keeps the wallet rule for free_used out of the way, so the
       plan alone has to silence it. */
    const following = (tier, remaining, wallet) => planRead(tier, [
      { window: '5h', percentUsed: 100 - remaining, resetsAt: IN_2H },
      { window: '7d', percentUsed: 20, resetsAt: IN_2D },
    ], { ...wallet, freeTokens: at(remaining) });
    const kinds = (tier, from, to, wallet, opts) => usageTransitions(
      following(tier, from, wallet), following(tier, to, wallet), opts,
    ).map((t) => t.kind);
    for (const tier of ['plus', 'pro']) {
      for (const wallet of [EMPTY_WALLET, SHORT_WALLET]) {
        for (const model of [null, 'model-router', 'mindshub_air']) {
          for (const coveredByTier of [null, 'free']) {
            expect(kinds(tier, 18, 8, wallet, { model, coveredByTier })).toEqual(['window_low']);
            expect(kinds(tier, 8, 0, wallet, { model, coveredByTier })).toEqual(['window_exhausted']);
          }
        }
      }
    }
    // A Free plan's figure is the free allowance, so a task on Air still hears it.
    const freePlan = (remaining) => planRead('free', [], { ...SHORT_WALLET, freeTokens: at(remaining) });
    expect(usageTransitions(freePlan(18), freePlan(8), { model: 'mindshub_air' }).map((t) => t.kind)).toEqual(['free_low']);
    expect(usageTransitions(freePlan(8), freePlan(0), { model: 'mindshub_air' }).map((t) => t.kind)).toEqual(['free_used']);
  });
});

describe('freeAllowanceState on a plan', () => {
  it('gives no figure on Plus or Pro, whose allowance fields carry the plan windows', () => {
    for (const tier of ['plus', 'pro']) {
      for (const freeTokens of [at(0), at(40), { limit: 0, used: 0, remaining: 0, resetsAt: RESET }]) {
        expect(freeAllowanceState(planRead(tier, [], { freeTokens }))).toEqual({ status: 'no_figure', resetsAt: null });
      }
    }
  });

  it('reads a Free plan exactly as no plan', () => {
    for (const freeTokens of [at(0), at(40), { limit: 0, used: 0, remaining: 0 }, null]) {
      expect(freeAllowanceState(planRead('free', [], { freeTokens }))).toEqual(freeAllowanceState(usage({ freeTokens })));
    }
  });

  it('leaves the stop sentences on Plus as they read with no allowance figure', () => {
    const noFigure = planRead('plus', [], { freeTokens: null });
    expect(allowanceStopCopy({ usage: planRead('plus', [], { freeTokens: at(0) }) }))
      .toBe(allowanceStopCopy({ usage: noFigure }));
    expect(budgetExceededCopy({ usage: planRead('plus', [], { freeTokens: at(40) }) }))
      .toBe(budgetExceededCopy({ usage: noFigure }));
  });
});

describe('airRoom', () => {
  const FULL_5H = [{ window: '5h', percentUsed: 100, resetsAt: IN_2H }, { window: '7d', percentUsed: 40, resetsAt: IN_2D }];
  const ROOMY = [{ window: '5h', percentUsed: 60, resetsAt: IN_2H }, { window: '7d', percentUsed: 40, resetsAt: IN_2D }];

  it('answers from the free allowance without a paid plan', () => {
    for (const read of [(over) => usage(over), (over) => planRead('free', [], over)]) {
      expect(airRoom(read({ freeTokens: at(28) }))).toBe('free');
      expect(airRoom(read({ freeTokens: at(0) }))).toBeNull();
      expect(airRoom(read({ freeTokens: { limit: 0, used: 0, remaining: 0 } }))).toBeNull();
      expect(airRoom(read({ freeTokens: null }))).toBeNull();
    }
    expect(airRoom({ reachable: false })).toBeNull();
    expect(airRoom(null)).toBeNull();
  });

  it('answers from the plan windows on Plus or Pro, whatever the allowance figure says', () => {
    for (const tier of ['plus', 'pro']) {
      for (const freeTokens of [at(0), at(40), null]) {
        expect(airRoom(planRead(tier, ROOMY, { freeTokens }))).toBe('plan');
        expect(airRoom(planRead(tier, [], { freeTokens }))).toBe('plan');
        expect(airRoom(planRead(tier, FULL_5H, { freeTokens }))).toBeNull();
      }
    }
  });

  it('names the plan allowance in the budget sentence while a window has room', () => {
    const RAISE = "Paid models can't run until an administrator raises it in Budgets.";
    expect(budgetExceededCopy({ usage: planRead('plus', ROOMY, { freeTokens: at(0) }) }))
      .toBe(`${RAISE} MindsHub Air still works while your plan's allowance lasts.`);
    expect(budgetExceededCopy({ usage: planRead('pro', FULL_5H, { freeTokens: at(40) }) })).toBe(RAISE);
    // A per-model budget names its model and never Air, on a plan too.
    expect(budgetExceededCopy({ usage: planRead('plus', ROOMY), budgetModelLabel: 'Claude Haiku' }))
      .toBe("Claude Haiku can't run until an administrator raises it in Budgets. Other models still work.");
  });
});

describe('a pick the Free tier covers', () => {
  const FREE_PICK = { model: 'glm-5-3-flash', coveredByTier: 'free' };
  const PLUS_PICK = { model: 'glm-5-3-flash', coveredByTier: 'plus' };
  const AIR = { model: 'mindshub_air' };
  /* An org with no paid plan and an empty wallet: no plan block at all, and a
     Free plan, which read the same. */
  const unfunded = (freeTokens) => [
    usage({ ...EMPTY_WALLET, freeTokens }),
    planRead('free', [], { ...EMPTY_WALLET, freeTokens }),
  ];
  // Compare's Start is disabled exactly when the combined notice blocks.
  const compareBlocks = (read, a, b) => !!compareCreditNotice([deriveUsageWarning(read, a), deriveUsageWarning(read, b)])?.blocks;

  it('runs on the free allowance like Air: no balance_empty stop while it has room, and Compare starts', () => {
    for (const read of unfunded(at(28))) {
      expect(deriveUsageWarning(read, FREE_PICK)).toBeNull();
      expect(deriveComposerWarning(read, FREE_PICK)).toBeNull();
      expect(compareBlocks(read, FREE_PICK, AIR)).toBe(false);
      expect(compareBlocks(read, FREE_PICK, FREE_PICK)).toBe(false);
    }
  });

  it('gets the allowance warnings as it runs low, and the stop once it is spent', () => {
    for (const read of unfunded(at(8))) {
      expect(deriveComposerWarning(read, FREE_PICK)).toEqual(deriveComposerWarning(read, AIR));
      expect(deriveComposerWarning(read, FREE_PICK).kind).toBe('free_low');
    }
    for (const read of unfunded(at(0))) {
      expect(deriveComposerWarning(read, FREE_PICK)).toEqual(deriveComposerWarning(read, AIR));
      expect(deriveComposerWarning(read, FREE_PICK).kind).toBe('balance_empty');
      expect(compareBlocks(read, FREE_PICK, AIR)).toBe(true);
    }
  });

  it('never tells a task on an empty wallet that it now runs on the balance', () => {
    /* The wallet holds nothing, so the next call is refused and the stop card
       speaks for it. A free pick, Air, and the router alike, with no plan and
       on a Free plan. */
    const [noPlanBefore, freePlanBefore] = unfunded(at(8));
    const [noPlanAfter, freePlanAfter] = unfunded(at(0));
    const zero = (freeTokens) => usage({ balance: { usd: 0, canConsume: true, alert: null }, freeTokens });
    for (const opts of [FREE_PICK, AIR, { model: 'model-router' }, { model: null }]) {
      expect(usageTransitions(noPlanBefore, noPlanAfter, opts)).toEqual([]);
      expect(usageTransitions(freePlanBefore, freePlanAfter, opts)).toEqual([]);
      // An unflagged wallet that holds $0 has nothing to fall through to either.
      expect(usageTransitions(zero(at(8)), zero(at(0)), opts)).toEqual([]);
    }
  });

  it('reads a member wallet from walletCanConsume when the read carries no balance', () => {
    /* A member without billing access gets no balance, but /me still says
       whether the wallet can pay. A wallet that cannot is never named as what
       the task now runs on. One that can, or a read that says nothing about
       it, keeps the notice. */
    const member = (freeTokens, walletCanConsume) => usage({
      isBillingOwner: false, balance: null, autoTopUp: null, walletCanConsume, freeTokens,
    });
    const kinds = (walletCanConsume, opts) => usageTransitions(
      member(at(8), walletCanConsume), member(at(0), walletCanConsume), opts,
    ).map((t) => t.kind);
    for (const opts of [FREE_PICK, AIR, { model: 'model-router' }, { model: null }]) {
      expect(kinds(false, opts)).toEqual([]);
      for (const walletCanConsume of [true, null, undefined]) {
        expect(kinds(walletCanConsume, opts)).toEqual(['free_used']);
      }
    }
  });

  it('prefers walletCanConsume over a balance that still looks usable', () => {
    // The same preference modelAccessSignature applies.
    const short = (freeTokens, walletCanConsume) => usage({ balance: SHORT, walletCanConsume, freeTokens });
    expect(usageTransitions(short(at(8), false), short(at(0), false), AIR)).toEqual([]);
    expect(usageTransitions(short(at(8), true), short(at(0), true), AIR).map((t) => t.kind)).toEqual(['free_used']);
  });

  it('tells a running task on it when the allowance runs low or out', () => {
    expect(usageTransitions(unpaid({ freeTokens: at(18) }), unpaid({ freeTokens: at(8) }), FREE_PICK)
      .map((t) => t.kind)).toEqual(['free_low']);
    expect(usageTransitions(unpaid({ freeTokens: at(8) }), unpaid({ freeTokens: at(0) }), FREE_PICK)
      .map((t) => t.kind)).toEqual(['free_used']);
    expect(usageTransitions(unpaid({ freeTokens: at(18) }), unpaid({ freeTokens: at(8) }), PLUS_PICK)).toEqual([]);
  });

  it('hears allowance copy that names no single model', () => {
    const noTime = (percent) => ({ ...at(percent), resetsAt: null });
    expect(deriveComposerWarning(unpaid({ freeTokens: noTime(8) }), FREE_PICK).body)
      .toBe('After that, free models use your balance until your allowance refills.');
    expect(deriveComposerWarning(unpaid({ freeTokens: noTime(0) }), FREE_PICK).body)
      .toBe('Free models now use your balance until your allowance refills.');
  });

  it('a model only Plus covers still bills the wallet, so an empty one stops it', () => {
    for (const read of unfunded(at(28))) {
      expect(deriveComposerWarning(read, PLUS_PICK)).toMatchObject({ kind: 'balance_empty', tone: 'danger' });
      expect(compareBlocks(read, PLUS_PICK, AIR)).toBe(true);
      // A model other than Air or the router with unknown coverage too.
      expect(deriveComposerWarning(read, { model: 'glm-5-3-flash' }).kind).toBe('balance_empty');
    }
  });

  it('leaves Air and the router free whatever the coverage, including none', () => {
    for (const read of unfunded(at(28))) {
      for (const model of ['mindshub_air', 'model-router', null]) {
        for (const coveredByTier of [null, 'free']) {
          expect(deriveComposerWarning(read, { model, coveredByTier })).toBeNull();
        }
      }
      expect(compareBlocks(read, AIR, { model: 'model-router' })).toBe(false);
    }
  });

  it('reads the same on Plus, where the plan windows carry it', () => {
    const plus = (percentUsed, over) => planRead('plus', [{ window: '5h', percentUsed, resetsAt: IN_2H }], over);
    expect(deriveComposerWarning(plus(30, EMPTY_WALLET), FREE_PICK)).toBeNull();
    expect(deriveComposerWarning(plus(100, EMPTY_WALLET), FREE_PICK).kind).toBe('window_exhausted');
    expect(deriveComposerWarning(plus(30, EMPTY_WALLET), { model: 'claude-opus-5-5', coveredByTier: 'pro' }).kind)
      .toBe('balance_empty');
    // The free allowance draining is not news to a task the plan carries.
    const draining = (percent) => plus(30, { balance: SHORT, freeTokens: at(percent) });
    expect(usageTransitions(draining(18), draining(8), FREE_PICK)).toEqual([]);
  });
});

describe('modelAccessSignature on a plan', () => {
  it('reads as before with no plan, and changes with the tier or a full window', () => {
    expect(modelAccessSignature(usage({ plan: null }))).toBe(modelAccessSignature(usage()));
    const plus = modelAccessSignature(planRead('plus'));
    expect(modelAccessSignature(planRead('pro'))).not.toBe(plus);
    expect(modelAccessSignature(planRead('plus', [{ window: '5h', percentUsed: 100, resetsAt: IN_2H }]))).not.toBe(plus);
  });
});

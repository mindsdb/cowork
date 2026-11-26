import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({ host: { isElectron: true, isWeb: false, openExternal: vi.fn() } }));
vi.mock('../../../platform/host', () => hostMock);
vi.mock('../../lib/analytics', () => ({ trackBillingOpened: vi.fn(), trackUpgradeClicked: vi.fn() }));
const accountMock = vi.hoisted(() => ({ user: { orgId: 'org-1', sub: 'u1', name: 'Hazem' } }));
vi.mock('../../hooks/useAccountUser', () => ({ useAccountUser: () => accountMock.user }));

import UsageSection from './UsageSection';
import { HubUsageContext } from '../../lib/hubUsageContext';
import { MINDS_ADD_FUNDS_URL, MINDS_BILLING_URL, consoleUrlFor } from '../../../lib/mindsUrls';

// Console links name the session's organization and account (ENG-4333).
const forOrg = (url) => consoleUrlFor(url, { organizationId: 'org-1', subject: 'u1' });

const RESET = '2099-09-11T12:00:00Z';
const usage = (over = {}) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens: { percentRemaining: 87.2, limit: 100, used: 12.8, remaining: 87.2, resetsAt: RESET },
  balance: { usd: 99.63, canConsume: true, hasToppedUp: false, alert: '' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
  creditSpend: { usd: 0.37, periodStart: '2099-08-01T00:00:00Z', periodEnd: '2099-09-01T00:00:00Z' },
  ...over,
});

const refresh = vi.fn();
const renderWith = (u) => render(
  <HubUsageContext.Provider value={{ usage: u, providerType: 'minds-cloud', refresh }}>
    <UsageSection isSsoConnected />
  </HubUsageContext.Provider>,
);

beforeEach(() => {
  accountMock.user = { orgId: 'org-1', sub: 'u1', name: 'Hazem' };
  hostMock.host.openExternal.mockClear();
  refresh.mockClear();
});

describe('UsageSection', () => {
  it('inside the mobile app, shows the free allowance without account billing details', () => {
    hostMock.host.isMobileShell = true;
    try {
      renderWith(usage());
      expect(screen.getByText('87% left')).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/balance|credit spent|top up|\$/i);
      for (const name of ['View usage', 'Add funds', 'Set up auto top up']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
    } finally {
      hostMock.host.isMobileShell = false;
    }
  });

  it('shows the allowance proportion and the period spend', () => {
    renderWith(usage());
    expect(screen.getByText('13%')).toBeInTheDocument();
    expect(screen.getByText(/of your allowance used/)).toBeInTheDocument();
    expect(screen.getByText(/87% left/)).toBeInTheDocument();
    // A clock time; the period spend below it stays a date range.
    expect(screen.getByText(/Resets at Sep 1[12], 12:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/^After that, free models use your balance until it resets at Sep 1[12], 12:00 PM\.$/)).toBeInTheDocument();
    expect(screen.getByText('$99.63')).toBeInTheDocument();
    expect(screen.getByText('$0.37')).toBeInTheDocument();
    expect(screen.getByText(/credit spent Aug 1 to Sep 1/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Free allowance used' })).toHaveAttribute('aria-valuenow', '13');
  });

  it('derives the meter from what is left, not from a used count the server may not send', () => {
    /* `used` is deprecated compatibility data and a build talking to an older
       sidecar can get an absolute there. Deriving the meter from `remaining`
       is what keeps the fill, the two figures and the tint agreeing; a card
       that read `used` would fill to 87% here while the copy says 13% used. */
    renderWith(usage({
      freeTokens: { percentRemaining: 87.2, limit: 100, used: 4_380_000, remaining: 87.2, resetsAt: RESET },
    }));

    expect(screen.getByRole('progressbar', { name: 'Free allowance used' })).toHaveAttribute('aria-valuenow', '13');
    expect(screen.getByText('13%')).toBeInTheDocument();
    expect(screen.getByText(/87% left/)).toBeInTheDocument();
  });

  it('never says the allowance is fully used while a usable slice is left', () => {
    /* 0.4% left is a real turn for a caller who caches well. Rounding the used
       figure up to "100%" beside "0.4% left" puts a contradiction on one row
       and reads as exhausted to anyone skimming. */
    renderWith(usage({
      freeTokens: { percentRemaining: 0.4, limit: 100, used: 99.6, remaining: 0.4, resetsAt: RESET },
    }));

    expect(screen.getByText('99.6%')).toBeInTheDocument();
    expect(screen.getByText(/0\.4% left/)).toBeInTheDocument();
    expect(screen.queryByText('100%')).toBeNull();
  });

  it('says a spent allowance resets, at the time auth gave or with no time', () => {
    /* At the time auth gives (refresh_at in auth's plan_windows.py) only the
       oldest spend ages out, so the copy says the allowance resets then and
       never that it refills. */
    const { unmount } = renderWith(usage({
      freeTokens: { percentRemaining: 0, limit: 100, used: 100, remaining: 0, resetsAt: RESET },
    }));
    expect(screen.getByText(/^Used up\. Free models now use your balance until it resets at Sep 1[12], 12:00 PM\.$/)).toBeInTheDocument();
    unmount();

    renderWith(usage({ freeTokens: { percentRemaining: 0, limit: 100, used: 100, remaining: 0, resetsAt: null } }));
    expect(screen.getByText('Used up. Free models now use your balance until it resets.')).toBeInTheDocument();
  });

  it('is quiet while the first read is in flight, not an error', () => {
    renderWith(null);
    expect(screen.getByRole('status')).toHaveTextContent('Loading usage');
    expect(screen.queryByText(/Couldn't load usage/)).toBeNull();
  });

  it('offers a retry when MindsHub could not be asked', async () => {
    const user = userEvent.setup();
    renderWith({ reachable: false });
    expect(screen.getByText("Couldn't load usage")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(refresh).toHaveBeenCalled();
  });

  it('asks a signed-out person to sign in', () => {
    accountMock.user = null;
    renderWith(usage());
    expect(screen.getByText('Sign in to see your usage')).toBeInTheDocument();
  });

  it('says Unlimited for an uncapped grant and hides the card for an unusable limit', () => {
    const { unmount } = renderWith(usage({ freeTokens: { percentRemaining: null, limit: -1, used: 0, remaining: -1 } }));
    expect(screen.getByText('Unlimited on this account.')).toBeInTheDocument();
    unmount();
    renderWith(usage({ freeTokens: { percentRemaining: 0, limit: 0, used: 0, remaining: 0 } }));
    expect(screen.queryByText('Free allowance')).toBeNull();
  });

  it('describes auto top up per status', () => {
    const { unmount } = renderWith(usage({ autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'ok' } }));
    expect(screen.getByText('Tops up to $20.00 when your balance drops below $5.00.')).toBeInTheDocument();
    expect(screen.getByText('Auto top up on')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage auto top up/ })).toBeInTheDocument();
    unmount();
    renderWith(usage({ autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'payment_failed' } }));
    expect(screen.getByText(/we couldn't charge your card/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update payment method/ })).toBeInTheDocument();
  });

  it('says a cap-paused auto top up is staying within the cap, not that the cap was hit', () => {
    renderWith(usage({ autoTopUp: { enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'cap_reached' } }));
    expect(
      screen.getByText("Tops up to $20.00 when your balance drops below $5.00. Paused to stay within this month's cap.")
    ).toBeInTheDocument();
  });

  it.each([
    [{ enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' }, 'Running low. Add funds or turn on auto top up to keep tasks running.'],
    [{ enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'ok' }, 'Running low. Auto top up will refill it.'],
    [{ enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'pending_action' }, 'Running low. Auto top up is waiting on your bank.'],
    [{ enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'cap_reached' }, 'Running low. Add funds to keep tasks running.'],
    [{ enabled: true, thresholdUsd: 5, rechargeToUsd: 20, status: 'payment_failed' }, 'Running low. Add funds to keep tasks running.'],
  ])('only asks to turn on auto top up when it is off (%o)', (autoTopUp, line) => {
    renderWith(usage({ balance: { usd: 3, canConsume: true, hasToppedUp: true, alert: 'low' }, autoTopUp }));
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('tells a member who can add funds, and sends the owner to the add-credits dialog', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWith(usage({ isBillingOwner: false }));
    expect(screen.getByText(/Only your organization's billing owner/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add funds/ }));
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(forOrg(MINDS_BILLING_URL));
    unmount();
    renderWith(usage());
    await user.click(screen.getByRole('button', { name: /Add funds/ }));
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(forOrg(MINDS_ADD_FUNDS_URL));
  });
});


describe('mobile usage details', () => {
  it.each([
    ['auto top up off', {}],
    ['empty balance', { balance: { usd: 0, canConsume: false } }],
    ['low balance', { balance: { usd: 8.42, canConsume: true, alert: 'low' } }],
    ['failed payment', { autoTopUp: { enabled: true, status: 'payment_failed' } }],
    ['non-owner', { isBillingOwner: false }],
    ['unreachable', { reachable: false }],
  ])('%s contains no purchase instructions', (_name, overrides) => {
    hostMock.host.isMobileShell = true;
    try {
      const { container } = renderWith(usage(overrides));
      expect(container.textContent).not.toMatch(/add funds|turn it on|turn on|update your payment method|in the console|balance|credit spent|top up|\$|Mobile/i);
    } finally {
      hostMock.host.isMobileShell = false;
    }
  });
});

// ── ENG-4186: plans ─────────────────────────────────────────────────────────
describe('UsageSection plan card', () => {
  const IN_2H = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const plan = (tier, over = {}) => ({
    tier,
    status: 'active',
    renewsAt: '2099-12-19T00:00:00Z',
    cancelAtPeriodEnd: false,
    windows: tier === 'free' ? [] : [
      { window: '5h', percentUsed: 42, resetsAt: IN_2H },
      { window: '7d', percentUsed: 10, resetsAt: null },
    ],
    ...over,
  });
  const personal = () => { accountMock.user = { sub: 'u1', name: 'Hazem', orgId: 'org-1', orgIsPersonal: true }; };

  it('shows no plan card and no Get Plus with no plan on the read', () => {
    personal();
    renderWith(usage());
    expect(screen.queryByText(/plan$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Get Plus/ })).toBeNull();
  });

  it('on Free, keeps the allowance as it was and adds Get Plus to it', async () => {
    personal();
    renderWith(usage({ plan: plan('free') }));
    expect(screen.getByText('Free allowance')).toBeInTheDocument();
    expect(screen.queryByText('Plus plan')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Get Plus/ }));
    const url = new URL(hostMock.host.openExternal.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('upgrade')).toBe('plus');
    expect(url.searchParams.get('organization')).toBe('org-1');
  });

  it('on Plus, shows the plan, its renewal, both windows as percentages, and Upgrade and Manage', async () => {
    personal();
    renderWith(usage({ plan: plan('plus') }));
    expect(screen.getByText('Plus plan')).toBeInTheDocument();
    expect(screen.getByText(/^Renews on /)).toBeInTheDocument();
    expect(screen.getByText('5-hour allowance')).toBeInTheDocument();
    expect(screen.getByText(/^42% used · resets at /)).toBeInTheDocument();
    expect(screen.getByText('Weekly allowance')).toBeInTheDocument();
    expect(screen.getByText('10% used')).toBeInTheDocument();
    expect(screen.getByText('Past either allowance, tasks continue from your wallet at API rates, or pause until it resets.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upgrade to Pro/ })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /Manage/ }));
    expect(new URL(hostMock.host.openExternal.mock.calls.at(-1)[0]).pathname).toBe('/settings/organization/billing');
  });

  it('on a failed renewal, flags the payment and says how to keep the plan', () => {
    personal();
    renderWith(usage({ plan: plan('plus', { status: 'past_due' }) }));
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
    expect(screen.getByText("We couldn't renew your plan. Update your card under Manage to keep it.")).toBeInTheDocument();
  });

  it('on Pro set to cancel, says when it ends and offers no upgrade', () => {
    personal();
    renderWith(usage({ plan: plan('pro', { cancelAtPeriodEnd: true }) }));
    expect(screen.getByText('Pro plan')).toBeInTheDocument();
    expect(screen.getByText(/^Ends on /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade/ })).toBeNull();
  });

  it('shows the meters but no buy or manage buttons outside a personal organization', () => {
    accountMock.user = { sub: 'u1', name: 'Hazem', orgId: 'org-2', orgIsPersonal: false };
    renderWith(usage({ plan: plan('plus') }));
    expect(screen.getByText('5-hour allowance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to Pro/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Manage/ })).toBeNull();
  });

  it.each(['plus', 'pro'])('on %s, drops the free allowance card, since the plan pays instead', (tier) => {
    personal();
    renderWith(usage({ plan: plan(tier), freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: RESET } }));
    expect(screen.getByText(tier === 'plus' ? 'Plus plan' : 'Pro plan')).toBeInTheDocument();
    expect(screen.queryByText('Free allowance')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Free models now use your balance/);
  });

  it('on a paid plan with no allowance and no balance, says nothing about having no usage', () => {
    personal();
    renderWith(usage({ plan: plan('plus'), freeTokens: null, balance: null }));
    expect(screen.getByText('Plus plan')).toBeInTheDocument();
    expect(screen.queryByText('No usage to show for this account yet.')).toBeNull();
  });

  it('inside the mobile app, shows the plan and its windows but nothing to buy or manage', () => {
    personal();
    hostMock.host.isMobileShell = true;
    try {
      const { unmount } = renderWith(usage({ plan: plan('plus') }));
      expect(screen.getByText('Plus plan')).toBeInTheDocument();
      expect(screen.getByText('5-hour allowance')).toBeInTheDocument();
      expect(screen.queryByText('Free allowance')).toBeNull();
      for (const name of [/Upgrade/, /Manage/, /Get Plus/, /Add funds/]) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
      expect(document.body.textContent).not.toMatch(/\$|API rates|wallet|balance|allowance, tasks/i);
      unmount();

      // A failed renewal is a billing notice, so the mobile app leaves it out.
      const pastDue = renderWith(usage({ plan: plan('plus', { status: 'past_due' }) }));
      expect(screen.getByText('Plus plan')).toBeInTheDocument();
      expect(screen.queryByText('Payment failed')).toBeNull();
      expect(document.body.textContent).not.toMatch(/couldn't renew|balance/i);
      pastDue.unmount();

      renderWith(usage({ plan: plan('free') }));
      expect(screen.getByText('Free allowance')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Get Plus/ })).toBeNull();
    } finally {
      hostMock.host.isMobileShell = false;
    }
  });
});

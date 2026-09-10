import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({ host: { isElectron: true, isWeb: false, openExternal: vi.fn() } }));
vi.mock('../../../platform/host', () => hostMock);
vi.mock('../../lib/analytics', () => ({ trackBillingOpened: vi.fn() }));
const accountMock = vi.hoisted(() => ({ user: { sub: 'u1', name: 'Hazem' } }));
vi.mock('../../hooks/useAccountUser', () => ({ useAccountUser: () => accountMock.user }));

import UsageSection from './UsageSection';
import { HubUsageContext } from '../../lib/hubUsageContext';
import { MINDS_ADD_FUNDS_URL, MINDS_BILLING_URL } from '../../../lib/mindsUrls';

const RESET = '2099-09-11T12:00:00Z';
const usage = (over = {}) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens: { limit: 5_000_000, used: 638_142, remaining: 4_361_858, resetsAt: RESET },
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
  accountMock.user = { sub: 'u1', name: 'Hazem' };
  hostMock.host.openExternal.mockClear();
  refresh.mockClear();
});

describe('UsageSection', () => {
  it('shows the real numbers and the period spend', () => {
    renderWith(usage());
    expect(screen.getByText('638.1K')).toBeInTheDocument();
    expect(screen.getByText(/5M tokens used/)).toBeInTheDocument();
    expect(screen.getByText(/Resets Sep 1[12]/)).toBeInTheDocument();
    expect(screen.getByText('$99.63')).toBeInTheDocument();
    expect(screen.getByText('$0.37')).toBeInTheDocument();
    expect(screen.getByText(/credit spent Aug 1 to Sep 1/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Free monthly tokens used' })).toHaveAttribute('aria-valuenow', '13');
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
    const { unmount } = renderWith(usage({ freeTokens: { limit: -1, used: 10, remaining: -1 } }));
    expect(screen.getByText('Unlimited on this account.')).toBeInTheDocument();
    unmount();
    renderWith(usage({ freeTokens: { limit: 0, used: 0, remaining: 0 } }));
    expect(screen.queryByText('Free monthly tokens')).toBeNull();
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

  it('tells a member who can add funds, and sends the owner to the add-credits dialog', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWith(usage({ isBillingOwner: false }));
    expect(screen.getByText(/Only your organization's billing owner/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add funds/ }));
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
    unmount();
    renderWith(usage());
    await user.click(screen.getByRole('button', { name: /Add funds/ }));
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_ADD_FUNDS_URL);
  });
});

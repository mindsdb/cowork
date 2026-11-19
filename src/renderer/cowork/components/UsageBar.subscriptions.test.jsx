// ENG-4186: the bar's upgrade action shows only where a plan can be bought,
// and opens checkout rather than the billing page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({ host: { openExternal: vi.fn() }, getAccessToken: vi.fn(async () => null) }));
vi.mock('../../platform/host', () => hostMock);
const analyticsMock = vi.hoisted(() => ({ trackBillingOpened: vi.fn(), trackUpgradeClicked: vi.fn() }));
vi.mock('../lib/analytics', () => analyticsMock);
const account = vi.hoisted(() => ({ current: { orgIsPersonal: true, orgId: 'org-1', sub: 'u-1' } }));
vi.mock('../hooks/useAccountUser', () => ({ useAccountUser: () => account.current }));

import UsageBar from './UsageBar';
import { HubUsageContext } from '../lib/hubUsageContext';
import { deriveComposerWarning } from '../lib/usageWarnings';
import { resetUsageBarDismissForTests } from '../lib/usageBarDismiss';

const IN_2H = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
const read = {
  reachable: true,
  isBillingOwner: true,
  freeTokens: null,
  balance: { usd: 0, canConsume: false, alert: 'depleted' },
  autoTopUp: { enabled: false, status: 'ok' },
  plan: {
    tier: 'plus', status: 'active', renewsAt: null, cancelAtPeriodEnd: false,
    windows: [{ window: '5h', percentUsed: 100, resetsAt: IN_2H }],
  },
};
const renderBar = () => render(
  <HubUsageContext.Provider value={{ usage: read, providerType: 'minds-cloud' }}>
    <UsageBar warning={deriveComposerWarning(read)} isBillingOwner />
  </HubUsageContext.Provider>,
);

beforeEach(() => {
  resetUsageBarDismissForTests();
  account.current = { orgIsPersonal: true, orgId: 'org-1', sub: 'u-1' };
  hostMock.host.openExternal.mockClear();
  analyticsMock.trackBillingOpened.mockClear();
  analyticsMock.trackUpgradeClicked.mockClear();
});

describe('UsageBar on a plan', () => {
  it('says the window is used up and opens checkout from Upgrade to Pro', async () => {
    renderBar();
    expect(document.querySelector('[data-usage-notice="window_exhausted"]')).toHaveTextContent(/5-hour allowance used up/);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    const url = new URL(hostMock.host.openExternal.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('upgrade')).toBe('pro');
    expect(url.searchParams.get('organization')).toBe('org-1');
    expect(analyticsMock.trackUpgradeClicked).toHaveBeenCalledWith('usage_bar', 'pro', 'plus');
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
  });

  it('drops the upgrade outside a personal organization and keeps Add funds', () => {
    account.current = { ...account.current, orgIsPersonal: false };
    renderBar();
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add funds' })).toBeInTheDocument();
  });
});

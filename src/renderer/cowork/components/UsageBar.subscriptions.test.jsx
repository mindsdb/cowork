// ENG-4186: the bar's upgrade action shows only where a plan can be bought,
// and opens the plan confirm rather than the billing page.
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
  it('says the window is used up and opens the plan confirm from Upgrade to Pro', async () => {
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

describe('UsageBar on a plan inside the mobile app', () => {
  const WALLET = { balance: { usd: 12, canConsume: true, alert: '' } };
  const plus = (percentUsed, over = {}) => ({
    ...read,
    freeTokens: { limit: 100, remaining: 5, resetsAt: IN_2H },
    ...over,
    plan: { ...read.plan, windows: [{ window: '5h', percentUsed, resetsAt: IN_2H }] },
  });

  it.each([
    ['a used-up window, empty wallet', plus(100), 'window_exhausted', /5-hour allowance used up.*Tasks on your plan are paused until/],
    ['a window past 90%, empty wallet', plus(92), 'window_low', /92% of your 5-hour allowance used.*After that, tasks pause until/],
  ])('%s says how full the window is, with no wallet and no buttons', (_name, usage, kind, text) => {
    hostMock.host.isMobileShell = true;
    try {
      const { container } = render(
        <HubUsageContext.Provider value={{ usage, providerType: 'minds-cloud' }}>
          <UsageBar warning={deriveComposerWarning(usage, { model: null })} isBillingOwner />
        </HubUsageContext.Provider>,
      );
      expect(container.querySelector(`[data-usage-notice="${kind}"]`)).toHaveTextContent(text);
      expect(container.textContent).not.toMatch(/wallet|balance|API rates|add funds|\$|Mobile|Free/i);
      expect(screen.queryByRole('button', { name: /Upgrade|Add funds|View usage/ })).toBeNull();
    } finally {
      hostMock.host.isMobileShell = false;
    }
  });

  it('says nothing for a plan with room, a wallet that carries on, or a pick outside the plan', () => {
    hostMock.host.isMobileShell = true;
    try {
      expect(deriveComposerWarning(plus(30), { model: null })).toBeNull();
      // Short of 90%, or a funded wallet behind the plan: the task is not
      // about to stop, so there is nothing to say (ENG-4719).
      expect(deriveComposerWarning(plus(85), { model: null })).toBeNull();
      expect(deriveComposerWarning(plus(100, WALLET), { model: null })).toBeNull();
      expect(deriveComposerWarning(plus(92, WALLET), { model: null })).toBeNull();
      expect(deriveComposerWarning(plus(100), { model: 'claude-opus-5-5', coveredByTier: 'pro' })).toBeNull();
    } finally {
      hostMock.host.isMobileShell = false;
    }
  });

  it('says nothing about a used-up window to someone on their own provider key', () => {
    hostMock.host.isMobileShell = true;
    try {
      expect(deriveComposerWarning(plus(100), { providerType: 'anthropic' })).toBeNull();
    } finally {
      hostMock.host.isMobileShell = false;
    }
  });

  it('on a Free plan, warns once the free tokens are nearly gone, with no actions', () => {
    hostMock.host.isMobileShell = true;
    try {
      const free = {
        ...read,
        freeTokens: { limit: 100, used: 92, remaining: 8, resetsAt: IN_2H },
        plan: { ...read.plan, tier: 'free', windows: [] },
      };
      const warning = deriveComposerWarning(free, { model: null });
      expect(warning.kind).toBe('free_low');
      expect(warning.actions).toEqual([]);
    } finally {
      hostMock.host.isMobileShell = false;
    }
  });
});

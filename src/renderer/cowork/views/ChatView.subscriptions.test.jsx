// ENG-4186: the stopped-task cards for Free, Plus and Pro plans. With no plan
// on the usage read (the gate off, an older server) every card reads exactly
// as before; a plan adds the upgrade, and only where it can be bought.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { account, mobile } = vi.hoisted(() => ({
  account: { current: { orgIsPersonal: true, orgId: 'org-1', sub: 'user-1' } },
  mobile: { current: false },
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    get isMobileShell() { return mobile.current; },
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getVersionInfo: vi.fn(async () => ({ app: '1.2.3', ui: null, source: 'bundled', buildKind: null })),
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));
vi.mock('../hooks/useAccountUser', () => ({ useAccountUser: () => account.current }));
vi.mock('../lib/analytics', async (orig) => ({
  ...(await orig()),
  trackUpgradeClicked: vi.fn(),
  trackBillingOpened: vi.fn(),
}));

import ChatView, { ModelUnavailableCard, WindowAllowanceExhaustedCard } from './ChatView';
import { HubUsageContext } from '../lib/hubUsageContext';
import { host } from '../../platform/host';
import { trackUpgradeClicked, trackBillingOpened } from '../lib/analytics';
import { formatResetTime } from '../lib/usageWarnings';
import { failedEventMeta } from '../lib/conversationHistory';

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

const usageWith = (plan, over = {}) => ({
  reachable: true,
  isBillingOwner: true,
  freeTokens: { limit: 100, used: 100, remaining: 0, resetsAt: inHours(3) },
  balance: { usd: 0, canConsume: false, hasToppedUp: false, alert: 'depleted' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
  plan,
  ...over,
});
const FREE = { tier: 'free', status: 'active', renewsAt: null, cancelAtPeriodEnd: false, windows: [] };
const PLUS = {
  tier: 'plus',
  status: 'active',
  renewsAt: '2026-12-19T00:00:00Z',
  cancelAtPeriodEnd: false,
  windows: [
    { window: '5h', percentUsed: 100, resetsAt: inHours(2) },
    { window: '7d', percentUsed: 40, resetsAt: inHours(48) },
  ],
};
const PRO = { ...PLUS, tier: 'pro' };

const withUsage = (usage, ui) => (
  <HubUsageContext.Provider value={{ usage, providerType: 'minds-cloud', refresh: () => {} }}>
    {ui}
  </HubUsageContext.Provider>
);
const taskWith = (messages) => ({ id: 'conv-a', title: 'Alpha', status: 'active', messages });
const failedTurn = (code, extra = {}) => [
  { role: 'user', content: 'draw me a chart' },
  { role: 'error', content: 'server text', code, ...extra },
];
const card = (title) => within(screen.getByText(title).parentElement);

beforeEach(() => {
  account.current = { orgIsPersonal: true, orgId: 'org-1', sub: 'user-1' };
  mobile.current = false;
  vi.mocked(host.openExternal).mockClear();
  vi.mocked(trackUpgradeClicked).mockClear();
  vi.mocked(trackBillingOpened).mockClear();
});

describe('AllowanceExhaustedCard: Get Plus for a Free plan', () => {
  it('leads with Get Plus, opening checkout for this organization', async () => {
    render(withUsage(usageWith(FREE), <ChatView task={taskWith(failedTurn('included_allowance_exhausted'))} />));
    const stop = card('Task stopped');
    const getPlus = stop.getByRole('button', { name: 'Get Plus' });
    await userEvent.click(getPlus);
    const url = new URL(vi.mocked(host.openExternal).mock.calls.at(-1)[0]);
    expect(url.pathname).toBe('/settings/organization/billing');
    expect(url.searchParams.get('upgrade')).toBe('plus');
    expect(url.searchParams.get('organization')).toBe('org-1');
    expect(url.searchParams.get('subject')).toBe('user-1');
    expect(trackUpgradeClicked).toHaveBeenCalledWith('allowance_card', 'plus', 'free');
    expect(stop.getByRole('button', { name: 'Add funds' })).toBeEnabled();
  });

  it.each([
    ['no plan on the read', usageWith(null), true],
    ['a team organization', usageWith(FREE), false],
  ])('offers no Get Plus with %s', (_label, usage, personal) => {
    account.current = { ...account.current, orgIsPersonal: personal };
    render(withUsage(usage, <ChatView task={taskWith(failedTurn('included_allowance_exhausted'))} />));
    const stop = card('Task stopped');
    expect(stop.queryByRole('button', { name: 'Get Plus' })).toBeNull();
    expect(stop.getByRole('button', { name: 'Add funds' })).toBeEnabled();
  });

  it('offers nothing to buy inside the mobile app', () => {
    mobile.current = true;
    render(withUsage(usageWith(FREE), <ChatView task={taskWith(failedTurn('included_allowance_exhausted'))} />));
    expect(screen.queryByRole('button', { name: 'Get Plus' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add funds' })).toBeNull();
  });
});

describe('window_allowance_exhausted card', () => {
  it('says the task is paused until the window frees up, with funds and Pro on Plus', async () => {
    const resetAt = inHours(2);
    render(withUsage(usageWith(PLUS), (
      <ChatView task={taskWith(failedTurn('window_allowance_exhausted', { resetAt, allowanceWindow: '5h' }))} />
    )));
    const stop = card('Plan allowance used up');
    expect(stop.getByText(new RegExp(`5-hour allowance and your balance is empty\\. Paused until ${formatResetTime(resetAt)}\\.`)))
      .toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
    await userEvent.click(stop.getByRole('button', { name: 'Add funds' }));
    expect(trackBillingOpened).toHaveBeenCalledWith('window_allowance_exhausted');
    await userEvent.click(stop.getByRole('button', { name: 'Upgrade to Pro' }));
    expect(new URL(vi.mocked(host.openExternal).mock.calls.at(-1)[0]).searchParams.get('upgrade')).toBe('pro');
    expect(trackUpgradeClicked).toHaveBeenCalledWith('window_card', 'pro', 'plus');
  });

  it('names the weekly window and offers no upgrade on Pro', () => {
    render(withUsage(usageWith(PRO), (
      <WindowAllowanceExhaustedCard resetAt={null} allowanceWindow="7d" isBillingOwner />
    )));
    expect(screen.getByText(/weekly allowance and your balance is empty\. Paused until it resets\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add funds' })).toBeEnabled();
  });

  it('inside the mobile app, reads as a usage stop with nothing to buy', () => {
    mobile.current = true;
    render(withUsage(usageWith(PLUS), (
      <WindowAllowanceExhaustedCard resetAt={null} allowanceWindow="5h" isBillingOwner />
    )));
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.queryByText('Billing')).toBeNull();
    expect(screen.getByText("You've used your 5-hour allowance. Paused until it resets.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/balance|wallet|funds|API rates|\$/i);
    expect(screen.queryByRole('button', { name: /Add funds|Upgrade/ })).toBeNull();
  });

  it('carries the window through a reloaded failure', () => {
    // The hydrate path reads the wire's snake_case, as it does reset_at.
    const meta = failedEventMeta([
      { type: 'response.failed', code: 'window_allowance_exhausted', error: 'x', reset_at: inHours(1), window: '7d' },
    ]);
    const error = { role: 'error', content: meta.message, ...meta };
    expect(error).toMatchObject({ code: 'window_allowance_exhausted', allowanceWindow: '7d', requiredTier: null });
    render(withUsage(usageWith(PLUS), <ChatView task={taskWith([{ role: 'user', content: 'q' }, error])} />));
    expect(screen.getByText(/weekly allowance/)).toBeInTheDocument();
  });
});

describe('ModelUnavailableCard: model_not_in_tier', () => {
  it('names the tier that covers the model, with Upgrade first and Add funds', async () => {
    render(withUsage(usageWith(PLUS), (
      <ModelUnavailableCard code="model_not_in_tier" failedModel="claude-opus-5-5" requiredTier="pro" isBillingOwner />
    )));
    expect(screen.getByText(/isn't in your plan/)).toBeInTheDocument();
    expect(screen.getByText(/is included with Pro\. Upgrade, or add funds to use it at API rates\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    expect(trackUpgradeClicked).toHaveBeenCalledWith('model_card', 'pro', 'plus');
    await userEvent.click(screen.getByRole('button', { name: 'Add funds' }));
    expect(trackBillingOpened).toHaveBeenCalledWith('model_not_in_tier');
  });

  it('still offers funds, and no upgrade, where none can be bought', () => {
    account.current = { ...account.current, orgIsPersonal: false };
    render(withUsage(usageWith(FREE), (
      <ModelUnavailableCard code="model_not_in_tier" failedModel="glm-5.3" requiredTier="plus" />
    )));
    expect(screen.queryByRole('button', { name: 'Get Plus' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add funds' })).toBeEnabled();
  });

  it('inside the mobile app, says only that the model is unavailable, with nothing to buy', () => {
    mobile.current = true;
    render(withUsage(usageWith(PLUS), (
      <ModelUnavailableCard code="model_not_in_tier" failedModel="claude-opus-5-5" requiredTier="pro" isBillingOwner />
    )));
    expect(screen.getByText(/isn't available right now/)).toBeInTheDocument();
    expect(screen.getByText('Ask your operator to check the configured model and its access.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/in your plan|included with|balance|wallet|funds|API rates|\$/i);
    expect(screen.queryByRole('button', { name: /Add funds|Upgrade|Get Plus/ })).toBeNull();
  });

  it('is dispatched from the turn, the Air switch folded under More actions', () => {
    render(withUsage(usageWith(FREE), (
      <ChatView
        task={taskWith(failedTurn('model_not_in_tier', { failedModel: 'glm-5.3', requiredTier: 'plus' }))}
        onSwitchToAirAndResend={() => {}}
      />
    )));
    expect(screen.getByText(/is included with Plus/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get Plus' })).toBeEnabled();
    // A third action goes in the card's overflow menu.
    expect(card(screen.getByText(/isn't in your plan/).textContent).getByRole('button', { name: 'More actions' })).toBeEnabled();
  });
});

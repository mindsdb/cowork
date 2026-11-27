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

import ChatView, {
  BalanceEmptyCard, BudgetExceededCard, ModelUnavailableCard, WindowAllowanceExhaustedCard,
} from './ChatView';
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
  it('leads with Get Plus, opening the plan confirm for this organization', async () => {
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

describe('stopped-task cards on Plus or Pro', () => {
  /* On a paid plan, auth's /me serves the plan's own windows in the flat
     allowance fields that cowork-server relays as freeTokens. That figure is
     no free allowance, so each card renders exactly as it does for a read
     with no allowance figure at all. Render against render, so the check
     holds whatever the copy says. PLUS and PRO have the 5-hour window used
     up, so Air, which runs on the plan's windows there, has no room either. */
  const SPENT = { limit: 100, used: 100, remaining: 0, resetsAt: inHours(2) };
  const ROOM = { limit: 100, used: 20, remaining: 80, resetsAt: inHours(2) };
  const textOf = (ui) => {
    const { container, unmount } = render(ui);
    const text = container.textContent;
    unmount();
    return text;
  };
  const balanceCard = (usage) => textOf(withUsage(usage, (
    <BalanceEmptyCard usage={usage} onSwitchToAir={() => {}} isBillingOwner />
  )));
  const budgetCard = (usage) => textOf(withUsage(usage, (
    <BudgetExceededCard usage={usage} onSwitchToAir={() => {}} />
  )));

  it.each([
    ['on desktop', false],
    ['inside the mobile app', true],
  ])('the drained-wallet card reads a Plus or Pro figure as no figure, %s', (_label, isMobile) => {
    mobile.current = isMobile;
    for (const plan of [PLUS, PRO]) {
      const noFigure = balanceCard(usageWith(plan, { freeTokens: null }));
      // usageWith's own figure is spent at 0, with an empty wallet.
      expect(balanceCard(usageWith(plan))).toBe(noFigure);
      expect(balanceCard(usageWith(plan, { freeTokens: ROOM }))).toBe(noFigure);
    }
    // On a Free plan the figure is the free allowance, and the card speaks from it.
    const freeNoFigure = balanceCard(usageWith(FREE, { freeTokens: null }));
    expect(balanceCard(usageWith(FREE, { freeTokens: SPENT }))).not.toBe(freeNoFigure);
    expect(balanceCard(usageWith(FREE, { freeTokens: ROOM }))).not.toBe(freeNoFigure);
  });

  it.each([
    ['on desktop', false],
    ['inside the mobile app', true],
  ])('the budget card reads a Plus or Pro figure with room as no figure, %s', (_label, isMobile) => {
    mobile.current = isMobile;
    for (const plan of [PLUS, PRO]) {
      expect(budgetCard(usageWith(plan, { freeTokens: ROOM }))).toBe(budgetCard(usageWith(plan, { freeTokens: null })));
    }
    expect(budgetCard(usageWith(FREE, { freeTokens: ROOM }))).not.toBe(budgetCard(usageWith(FREE, { freeTokens: null })));
  });

  /* With no window used up, Air runs on the plan's windows, so both cards
     offer the switch, and the drained-wallet card names the plan's allowance
     rather than a free one. The spent allowance figure must not hide it. */
  const open = (plan) => ({
    ...plan,
    windows: [
      { window: '5h', percentUsed: 60, resetsAt: inHours(2) },
      { window: '7d', percentUsed: 40, resetsAt: inHours(48) },
    ],
  });

  it('the drained-wallet card offers Air on the plan while no window is used up', async () => {
    for (const plan of [PLUS, PRO]) {
      const onSwitchToAir = vi.fn();
      const usage = usageWith(open(plan), { freeTokens: SPENT });
      const { unmount } = render(withUsage(usage, (
        <BalanceEmptyCard usage={usage} onSwitchToAir={onSwitchToAir} isBillingOwner />
      )));
      expect(screen.getByText("Your balance is empty, so this model can't run. Your plan's allowance still covers MindsHub Air."))
        .toBeInTheDocument();
      expect(screen.queryByText(/free allowance/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Add funds' })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'Switch to MindsHub Air' }));
      expect(onSwitchToAir).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('the budget card offers Air on the plan while no window is used up', async () => {
    for (const plan of [PLUS, PRO]) {
      const onSwitchToAir = vi.fn();
      const usage = usageWith(open(plan), { freeTokens: SPENT });
      const { unmount } = render(withUsage(usage, (
        <BudgetExceededCard usage={usage} onSwitchToAir={onSwitchToAir} />
      )));
      expect(screen.getByText(/MindsHub Air still works while your plan's allowance lasts\./)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Switch to MindsHub Air' }));
      expect(onSwitchToAir).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('both cards offer Air on the plan inside the mobile app too', () => {
    mobile.current = true;
    for (const plan of [PLUS, PRO]) {
      const usage = usageWith(open(plan), { freeTokens: SPENT });
      const { unmount } = render(withUsage(usage, (
        <>
          <BalanceEmptyCard usage={usage} onSwitchToAir={() => {}} isBillingOwner />
          <BudgetExceededCard usage={usage} onSwitchToAir={() => {}} />
        </>
      )));
      expect(screen.getAllByRole('button', { name: 'Switch to MindsHub Air' })).toHaveLength(2);
      unmount();
    }
  });
});

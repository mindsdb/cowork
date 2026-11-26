import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({ host: { openExternal: vi.fn() } }));
vi.mock('../../platform/host', () => hostMock);
const accountMock = vi.hoisted(() => ({ user: { orgId: 'org-1', sub: 'u1' } }));
vi.mock('../hooks/useAccountUser', () => ({ useAccountUser: () => accountMock.user }));
const analyticsMock = vi.hoisted(() => ({ trackBillingOpened: vi.fn() }));
vi.mock('../lib/analytics', () => analyticsMock);

import UsageBar from './UsageBar';
import { USAGE_ACTIONS, deriveComposerWarning } from '../lib/usageWarnings';
import { resetUsageBarDismissForTests } from '../lib/usageBarDismiss';
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL, MINDS_AUTO_TOP_UP_URL, consoleUrlFor } from '../../lib/mindsUrls';

// Console links name the session's organization and account (ENG-4333).
const forOrg = (url) => consoleUrlFor(url, { organizationId: 'org-1', subject: 'u1' });

const freeLow = {
  kind: 'free_low', tone: 'warning', title: '12% of your free allowance left',
  body: 'After that, MindsHub Air usage will use your balance until they reset on Sep 11.',
  actions: [USAGE_ACTIONS.viewUsage],
};
const balanceLow = {
  kind: 'balance_low', tone: 'warning', title: 'Balance running low',
  body: 'You have $8.42 left.', actions: [USAGE_ACTIONS.addFunds],
};
// The announcement region is always mounted so it can be filled later; what
// matters is whether it has anything in it.
const liveText = () => screen.getByRole('status').textContent;

beforeEach(() => {
  resetUsageBarDismissForTests();
  hostMock.host.openExternal.mockClear();
  analyticsMock.trackBillingOpened.mockClear();
});

describe('UsageBar', () => {
  it('renders no bar without a warning, only the empty announcement region', () => {
    const { container } = render(<UsageBar warning={null} />);
    expect(container.querySelector('.usage-bar')).toBeNull();
    // The region has to be in the DOM and empty BEFORE a warning arrives, or
    // filling it later announces nothing (see AskUserCard for the same rule).
    expect(liveText()).toBe('');
  });

  it('shows the copy and opens the console on an action, counting the click', async () => {
    const user = userEvent.setup();
    render(<UsageBar warning={balanceLow} isBillingOwner />);
    await user.click(screen.getByRole('button', { name: 'Add funds' }));
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('usage_notice');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(forOrg(MINDS_ADD_FUNDS_URL));
  });

  it('a warning arriving later lands in the already-mounted region', () => {
    const { rerender } = render(<UsageBar warning={null} usageKnown />);
    expect(liveText()).toBe('');
    rerender(<UsageBar warning={freeLow} usageKnown />);
    // Same region node, filled on a later commit — which is the only form of
    // change aria-live actually announces.
    expect(liveText()).toBe('12% of your free allowance left. After that, MindsHub Air usage will use your balance until they reset on Sep 11.');
  });

  it('a closed warning does not count as "healthy", so its dismissal is kept', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UsageBar warning={freeLow} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    // Composer passes usageKnown for "nothing to warn about for ANY pick"; a
    // warning that is merely closed is still a warning.
    rerender(<UsageBar warning={{ ...freeLow, title: '9% of your free allowance left' }} usageKnown />);
    expect(screen.queryByText(/of your free allowance left/)).toBeNull();
  });

  it('a member is sent to the billing page, not the add-credits dialog', async () => {
    const user = userEvent.setup();
    render(<UsageBar warning={balanceLow} isBillingOwner={false} />);
    await user.click(screen.getByRole('button', { name: 'Add funds' }));
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(forOrg(MINDS_BILLING_URL));
  });

  it('can be closed, stays closed for the same kind, and returns for a new kind', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UsageBar warning={freeLow} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/of your free allowance left/)).toBeNull();

    // Same kind, fresh numbers: still closed.
    rerender(<UsageBar warning={{ ...freeLow, title: '8% of your free allowance left' }} />);
    expect(screen.queryByText(/of your free allowance left/)).toBeNull();

    // A different state: shows again.
    rerender(<UsageBar warning={balanceLow} />);
    expect(screen.getByText('Balance running low.')).toBeInTheDocument();
  });

  it('a closed low-balance bar comes back at the next step down, before the balance empties', async () => {
    const user = userEvent.setup();
    const atStep = (step, usd) => ({ ...balanceLow, dismissKey: `balance_low:${step}`, body: `You have $${usd} left.` });
    const { rerender } = render(<UsageBar warning={atStep(0, '18.00')} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Balance running low.')).toBeNull();

    // Still draining inside the same step: the person is not asked twice.
    rerender(<UsageBar warning={atStep(0, '12.00')} usageKnown />);
    expect(screen.queryByText('Balance running low.')).toBeNull();

    // A step lower, and still above zero: the offer to top up is back.
    rerender(<UsageBar warning={atStep(1, '8.42')} usageKnown />);
    expect(screen.getByText('Balance running low.')).toBeInTheDocument();
  });

  it('offers auto top up as a one-click choice for the owner', async () => {
    const user = userEvent.setup();
    const warning = { ...balanceLow, actions: [USAGE_ACTIONS.addFunds, USAGE_ACTIONS.setUpAutoTopUp] };
    render(<UsageBar warning={warning} isBillingOwner />);
    await user.click(screen.getByRole('button', { name: 'Set up auto top up' }));
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(forOrg(MINDS_AUTO_TOP_UP_URL));
  });

  it('forgets dismissals once usage is known to be healthy', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UsageBar warning={freeLow} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    rerender(<UsageBar warning={null} usageKnown />);
    rerender(<UsageBar warning={freeLow} usageKnown />);
    expect(screen.getByText('12% of your free allowance left.')).toBeInTheDocument();
  });

  it('keeps a dismissal across a launch: nothing to show yet is not "healthy"', async () => {
    const user = userEvent.setup();
    const { rerender, unmount } = render(<UsageBar warning={freeLow} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    unmount();
    // Next launch: the bar mounts before the first poll answers.
    const second = render(<UsageBar warning={null} usageKnown={false} />);
    second.rerender(<UsageBar warning={freeLow} usageKnown />);
    expect(screen.queryByText(/of your free allowance left/)).toBeNull();
    // Unreachable sidecar is not "healthy" either.
    second.rerender(<UsageBar warning={null} usageKnown={false} />);
    second.rerender(<UsageBar warning={freeLow} usageKnown />);
    expect(screen.queryByText(/of your free allowance left/)).toBeNull();
  });
  it('paints every status tone over a solid base so the conversation cannot show through', () => {
    // The dark theme's status -bg tokens are translucent; the tint alone would
    // let scrolled chat content read through the bar.
    for (const tone of ['info', 'warning', 'danger']) {
      const { unmount } = render(<UsageBar warning={{ ...balanceLow, tone }} />);
      const bar = document.querySelector('.usage-bar');
      expect(bar.classList).toContain('bg-bg');
      expect(bar.className).toContain(`linear-gradient(var(--${tone}-bg)`);
      unmount();
    }
  });
});


describe('mobile usage copy from real account states', () => {
  it.each([
    ['nearly-gone allowance', { balance: { usd: 0, canConsume: false }, freeTokens: { limit: 100, remaining: 8, resetsAt: '2099-09-11T12:00:00Z' } }, /8% of your free allowance left/],
    ['allowance with room', { balance: { usd: 0, canConsume: false }, freeTokens: { limit: 100, remaining: 50, resetsAt: '2099-09-11T12:00:00Z' } }, /^$/],
    ['empty wallet', { balance: { usd: 0, canConsume: false } }, /balance is empty/i],
    ['low wallet', { balance: { usd: 8.42, canConsume: true, alert: 'low' } }, /\$8.42/],
    ['failed auto top up', { autoTopUp: { enabled: true, status: 'payment_failed' } }, /couldn't charge your card/i],
    ['capped auto top up', { balance: { usd: 8.42, canConsume: true, alert: 'low' }, autoTopUp: { enabled: true, status: 'cap_reached' } }, /monthly cap/i],
    ['exhausted allowance', { balance: { usd: 0, canConsume: false }, freeTokens: { limit: 100, remaining: 0, resetsAt: '2099-09-11T12:00:00Z' } }, /Resets at/],
  ])('%s exposes only allowance information on mobile', (_name, overrides, fact) => {
    hostMock.host.isMobileShell = true;
    try {
      const warning = deriveComposerWarning({ reachable: true, freeTokens: null, balance: null, autoTopUp: null, ...overrides }, { model: overrides.freeTokens ? null : 'claude-sonnet-4' });
      const { container } = render(<UsageBar warning={warning} />);
      if (overrides.freeTokens) expect(container.textContent).toMatch(fact);
      else expect(container.textContent).toBe('');
      expect(container.textContent).not.toMatch(/balance|top up|card|\$|credits|add funds|Mobile/i);
    } finally {
      hostMock.host.isMobileShell = false;
    }
  });
});

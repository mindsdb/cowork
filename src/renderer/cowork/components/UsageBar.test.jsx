import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({ host: { openExternal: vi.fn() } }));
vi.mock('../../platform/host', () => hostMock);
const analyticsMock = vi.hoisted(() => ({ trackBillingOpened: vi.fn() }));
vi.mock('../lib/analytics', () => analyticsMock);

import UsageBar from './UsageBar';
import { USAGE_ACTIONS } from '../lib/usageWarnings';
import { resetUsageBarDismissForTests } from '../lib/usageBarDismiss';
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL, MINDS_AUTO_TOP_UP_URL } from '../../lib/mindsUrls';

const freeLow = {
  kind: 'free_low', tone: 'warning', title: '620K free tokens left',
  body: 'After that, MindsHub Air usage will use your balance until they reset on Sep 11.',
  actions: [USAGE_ACTIONS.viewUsage],
};
const balanceLow = {
  kind: 'balance_low', tone: 'warning', title: 'Balance running low',
  body: 'You have $8.42 left.', actions: [USAGE_ACTIONS.addFunds],
};
const atRest = {
  kind: 'free_at_rest', tone: 'resting', resting: true,
  title: '3.4M of 5M free tokens left', body: 'Resets on Sep 11.',
  actions: [USAGE_ACTIONS.viewUsage],
};
// What `deriveComposerWarning` attaches to a free warning: the figure the bar
// steps down to when the warning is closed.
const freeLowWithFallback = { ...freeLow, dismissKey: 'free_low:1', whenDismissed: atRest };

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
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_ADD_FUNDS_URL);
  });

  it('the standing figure cannot be closed: no dismiss button at all', () => {
    render(<UsageBar warning={atRest} usageKnown />);
    expect(screen.getByText('3.4M of 5M free tokens left.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('the standing figure announces nothing, so a poll does not interrupt', () => {
    render(<UsageBar warning={atRest} usageKnown />);
    // The bar itself is never the live region, and the region stays empty for
    // a figure that is on screen all month.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.usage-bar')?.getAttribute('role')).toBeNull();
    expect(liveText()).toBe('');
  });

  it('the standing figure is neutral, not amber', () => {
    render(<UsageBar warning={atRest} usageKnown />);
    const bar = document.querySelector('.usage-bar');
    expect(bar.className).toContain('bg-surface-2');
    expect(bar.className).not.toContain('bg-warning-bg');
  });

  it('a warning replacing the standing figure lands in the already-mounted region', () => {
    const { rerender } = render(<UsageBar warning={atRest} usageKnown />);
    expect(liveText()).toBe('');
    rerender(<UsageBar warning={freeLow} usageKnown />);
    // Same region node, filled on a later commit — which is the only form of
    // change aria-live actually announces.
    expect(liveText()).toBe('620K free tokens left. After that, MindsHub Air usage will use your balance until they reset on Sep 11.');
  });

  it('closing a free warning steps down to the standing figure, not to nothing', async () => {
    const user = userEvent.setup();
    render(<UsageBar warning={freeLowWithFallback} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    // The number survives the close; only the warning does not.
    expect(screen.getByText('3.4M of 5M free tokens left.')).toBeTruthy();
    expect(screen.queryByText('620K free tokens left.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(liveText()).toBe('');
  });

  it('a standing figure forgets an earlier dismissal, so next month warns again', async () => {
    const user = userEvent.setup();
    // Close the warning at 620K, the way a user does mid-month...
    const first = render(<UsageBar warning={freeLowWithFallback} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    first.unmount();
    // ...the grant resets, so the bar rests. A resting figure IS the healthy
    // state, so the stored key is forgotten here. Without that, `usageHealthy`
    // would be false for every free user all month and the dismissal would
    // outlive the reset.
    render(<UsageBar warning={atRest} usageKnown />).unmount();
    render(<UsageBar warning={freeLowWithFallback} usageKnown />);
    expect(screen.getByText('620K free tokens left.')).toBeTruthy();
  });

  it('counts a click on the standing figure apart from a warning click', async () => {
    const user = userEvent.setup();
    render(<UsageBar warning={atRest} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'View usage' }));
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('usage_at_rest');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('a member is sent to the billing page, not the add-credits dialog', async () => {
    const user = userEvent.setup();
    render(<UsageBar warning={balanceLow} isBillingOwner={false} />);
    await user.click(screen.getByRole('button', { name: 'Add funds' }));
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('can be closed, stays closed for the same kind, and returns for a new kind', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UsageBar warning={freeLow} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/free tokens left/)).toBeNull();

    // Same kind, fresh numbers: still closed.
    rerender(<UsageBar warning={{ ...freeLow, title: '400K free tokens left' }} />);
    expect(screen.queryByText(/free tokens left/)).toBeNull();

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
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_AUTO_TOP_UP_URL);
  });

  it('forgets dismissals once usage is known to be healthy', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UsageBar warning={freeLow} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    rerender(<UsageBar warning={null} usageKnown />);
    rerender(<UsageBar warning={freeLow} usageKnown />);
    expect(screen.getByText('620K free tokens left.')).toBeInTheDocument();
  });

  it('keeps a dismissal across a launch: nothing to show yet is not "healthy"', async () => {
    const user = userEvent.setup();
    const { rerender, unmount } = render(<UsageBar warning={freeLow} usageKnown />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    unmount();
    // Next launch: the bar mounts before the first poll answers.
    const second = render(<UsageBar warning={null} usageKnown={false} />);
    second.rerender(<UsageBar warning={freeLow} usageKnown />);
    expect(screen.queryByText(/free tokens left/)).toBeNull();
    // Unreachable sidecar is not "healthy" either.
    second.rerender(<UsageBar warning={null} usageKnown={false} />);
    second.rerender(<UsageBar warning={freeLow} usageKnown />);
    expect(screen.queryByText(/free tokens left/)).toBeNull();
  });
});

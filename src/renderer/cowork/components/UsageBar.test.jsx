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
import { MINDS_BILLING_URL, MINDS_ADD_FUNDS_URL } from '../../lib/mindsUrls';

const freeLow = {
  kind: 'free_low', tone: 'warning', title: '620K free tokens left',
  body: 'After that, MindsHub Air usage will use your balance until they reset on Sep 11.',
  actions: [USAGE_ACTIONS.viewUsage],
};
const balanceLow = {
  kind: 'balance_low', tone: 'warning', title: 'Balance running low',
  body: 'You have $8.42 left.', actions: [USAGE_ACTIONS.addFunds],
};

beforeEach(() => {
  resetUsageBarDismissForTests();
  hostMock.host.openExternal.mockClear();
  analyticsMock.trackBillingOpened.mockClear();
});

describe('UsageBar', () => {
  it('renders nothing without a warning', () => {
    const { container } = render(<UsageBar warning={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the copy and opens the console on an action, counting the click', async () => {
    const user = userEvent.setup();
    render(<UsageBar warning={balanceLow} isBillingOwner />);
    await user.click(screen.getByRole('button', { name: 'Add funds' }));
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('usage_notice');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_ADD_FUNDS_URL);
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

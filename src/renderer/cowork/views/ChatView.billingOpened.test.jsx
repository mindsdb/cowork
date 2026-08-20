// ENG-1533: every route from the desktop to the console billing page emits
// billing_opened carrying the condition that sent the user there. The trigger is
// the measurement — the causes have different fixes and probably different
// conversion rates — so each one is pinned to the card that actually renders it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({
  host: {
    isElectron: true,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    isLocalApiOrigin: () => false,
    openPath: vi.fn(),
    openExternal: vi.fn(),
    mindshubFinalize: vi.fn(async () => ({ ok: true })),
    mindshubLogin: vi.fn(async () => ({ ok: true })),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: true,
  isWeb: false,
}));
vi.mock('../../platform/host', () => hostMock);

const analyticsMock = vi.hoisted(() => ({
  trackBillingOpened: vi.fn(),
  trackKeyProvisioningRefused: vi.fn(),
}));
vi.mock('../lib/analytics', () => analyticsMock);

import ChatView, { ModelUnavailableCard } from './ChatView';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';

const taskWith = (messages) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages,
});

const failedTurn = (code, content, extra = {}) => [
  { role: 'user', content: 'draw me a chart' },
  { role: 'error', content, code, ...extra },
];

beforeEach(() => {
  analyticsMock.trackBillingOpened.mockClear();
  analyticsMock.trackKeyProvisioningRefused.mockClear();
  hostMock.host.openExternal.mockClear();
  hostMock.host.mindshubFinalize.mockReset().mockResolvedValue({ ok: true });
  // Reset rather than clear: one test below overrides the resolved value, and
  // without this both that value and the call count leak into every test after
  // it, in file order.
  hostMock.host.mindshubLogin.mockReset().mockResolvedValue({ ok: true });
});

describe('billing_opened trigger per call site', () => {
  it('token_limit: the out-of-credits card records the trigger and still opens billing', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith(failedTurn('token_limit', "You've run out of credits."))} />);

    await user.click(screen.getByRole('button', { name: 'Top up balance' }));

    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('token_limit');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('included_allowance_exhausted: the free-allowance card records its own trigger (ENG-1537)', async () => {
    const user = userEvent.setup();
    // A spent monthly grant is a different cohort from a drained wallet — the
    // org has never paid — so its "Add credits" click cannot be filed under
    // token_limit. Without this the card was the one route to billing that
    // opened the page and counted nothing.
    render(<ChatView task={taskWith(failedTurn('included_allowance_exhausted', "You've used this month's free tokens.", { resetAt: '2099-01-01T00:00:00Z' }))} />);

    await user.click(screen.getByRole('button', { name: 'Add credits' }));

    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('included_allowance_exhausted');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('model_access_denied: the credits-denial card records its own trigger', async () => {
    const user = userEvent.setup();
    render(<ModelUnavailableCard code="model_access_denied" failedModel="gpt-5.6-sol" />);

    await user.click(screen.getByRole('button', { name: 'Top up balance' }));

    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('model_access_denied');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('model_disabled: the same card records the code that rendered, not a credit denial', async () => {
    const user = userEvent.setup();
    render(<ModelUnavailableCard code="model_disabled" failedModel="opus" />);

    await user.click(screen.getByRole('button', { name: 'Top up balance' }));

    // The admin-disabled row also offers a top-up, as a legacy escape hatch. It
    // must not be counted as a credit denial that never happened.
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('model_disabled');
  });

  it('connect_provider: the "Start for free" card records the route, with no impression event', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith([{ role: 'provider_required' }])} />);

    // Rendering the card alone must emit nothing — whether this surface earns an
    // impression event is an open ENG-1305 question, deliberately not settled here.
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Start for free' }));

    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('connect_provider');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('fires on the click, not on the render — a repaint must not inflate the count', () => {
    const { rerender } = render(<ModelUnavailableCard code="model_access_denied" failedModel="opus" />);
    rerender(<ModelUnavailableCard code="model_access_denied" failedModel="opus" />);
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
  });
});

describe('key_provisioning_refused on the reconnect handler', () => {
  it('a refused key records the refusal AND the billing route it took', async () => {
    const user = userEvent.setup();
    hostMock.host.mindshubFinalize.mockResolvedValue({ ok: false, upgradeRequired: true });
    // `reconnectable` rides the message: it means "this key came from MindsHub",
    // which is what makes an in-place re-provision the fix.
    render(
      <ChatView
        task={taskWith(failedTurn('provider_auth', 'Your MindsHub session expired.', { reconnectable: true }))}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(analyticsMock.trackKeyProvisioningRefused).toHaveBeenCalledWith('billing_opened');
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('key_provisioning_refused');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('a plain reconnect failure records nothing — a failure is not a refusal', async () => {
    const user = userEvent.setup();
    hostMock.host.mindshubFinalize.mockResolvedValue({ ok: false, reason: 'no session' });
    hostMock.host.mindshubLogin.mockResolvedValue({ ok: false, reason: 'cancelled' });
    // `reconnectable` rides the message: it means "this key came from MindsHub",
    // which is what makes an in-place re-provision the fix.
    render(
      <ChatView
        task={taskWith(failedTurn('provider_auth', 'Your MindsHub session expired.', { reconnectable: true }))}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(analyticsMock.trackKeyProvisioningRefused).not.toHaveBeenCalled();
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
  });
});

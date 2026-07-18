import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the api module (network) and the host facade (Electron bridge).
const apiMock = vi.hoisted(() => ({
  fetchIntegrations: vi.fn(async () => ({ items: [] })),
  startConnectorOAuth: vi.fn(),
  pollConnectorOAuth: vi.fn(),
  browseControlApprove: vi.fn(async () => ({ ok: true })),
  setBrowserControlEnabled: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../api', () => apiMock);

const { mockHost, listeners } = vi.hoisted(() => {
  const l = [];
  const h = {
    browserControlStatus: vi.fn(async () => ({ available: false, state: 'disconnected' })),
    browserControlListTabs: vi.fn(async () => ({ ok: true, tabs: [] })),
    browserControlAttach: vi.fn(async () => ({ ok: true, state: 'awaiting-approval' })),
    browserControlApprove: vi.fn(async () => ({ ok: true, state: 'connected' })),
    browserControlCancelAttach: vi.fn(async () => ({ ok: true })),
    browserControlRevoke: vi.fn(async () => ({ ok: true })),
    browserControlTakeOver: vi.fn(async () => ({ ok: true })),
    browserControlSetConversation: vi.fn(async () => ({ ok: true })),
    onBrowserControlState: vi.fn((cb) => {
      l.push(cb);
      return () => {
        const i = l.indexOf(cb);
        if (i >= 0) l.splice(i, 1);
      };
    }),
  };
  return { mockHost: h, listeners: l };
});

vi.mock('../../platform/host', () => ({ host: mockHost, default: mockHost }));

import ConnectWorkflowView from './ConnectWorkflowView';

beforeEach(() => {
  listeners.length = 0;
  vi.clearAllMocks();
  mockHost.browserControlStatus.mockResolvedValue({ available: false, state: 'disconnected' });
});

function pushState(payload) {
  listeners.forEach((cb) => cb(payload));
}

describe('ConnectWorkflowView — Browser Control consolidation', () => {
  it('no longer renders the removed Control Chrome stub', async () => {
    render(<ConnectWorkflowView />);
    await waitFor(() => expect(screen.getByText('Browser Control')).toBeInTheDocument());
    expect(screen.queryByText('Control Chrome')).not.toBeInTheDocument();
  });

  it('shows the state-aware Browser Control detail (disconnected intro) when selected', async () => {
    const user = userEvent.setup();
    render(<ConnectWorkflowView />);
    await waitFor(() => expect(screen.getByText('Browser Control')).toBeInTheDocument());

    await user.click(screen.getByText('Browser Control'));
    const detail = await screen.findByTestId('browser-control-detail');
    expect(detail).toBeInTheDocument();
    // The detail wrapper carries .customize-empty-detail, whose CSS
    // (overflow-y:auto + `justify-content: safe center`) keeps the tall intro
    // scrollable and the CTA reachable at small window heights.
    expect(detail).toHaveClass('customize-empty-detail');
    // Disconnected -> idle badge + read-only intro + Choose a Chrome tab button.
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    expect(screen.getByRole('button', { name: 'Choose a Chrome tab' })).toBeInTheDocument();
    // Read-only reassurance copy is present.
    expect(screen.getByText(/login and credentials stay in Chrome/i)).toBeInTheDocument();
  });

  it('opens the tab picker and reflects a connected push', async () => {
    const user = userEvent.setup();
    mockHost.browserControlListTabs.mockResolvedValue({
      ok: true,
      tabs: [{ targetId: 'T1', title: 'Stripe Docs', url: 'https://docs.stripe.com/api', domain: 'stripe.com' }],
    });
    render(<ConnectWorkflowView activeConversationId="CONV-9" />);
    await waitFor(() => expect(screen.getByText('Browser Control')).toBeInTheDocument());
    await user.click(screen.getByText('Browser Control'));

    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(await screen.findByRole('radio', { name: /Stripe Docs/ }));
    await user.click(screen.getByRole('button', { name: 'Approve this tab' }));
    expect(mockHost.browserControlAttach).toHaveBeenCalledWith('T1');
    expect(mockHost.browserControlApprove).toHaveBeenCalled();
    // Main is handed the active conversation id BEFORE attach so the poller
    // can identify itself on bridge/hello (which 422s an anonymous hello).
    expect(mockHost.browserControlSetConversation).toHaveBeenCalledWith('CONV-9');
    // The server is told which host is approved (content-free, host-only
    // domain) FOR THE ACTIVE CONVERSATION so it creates the BrowserSession +
    // BrowserTabGrant (`/browse/control/approve` requires conversation_id).
    await waitFor(() =>
      expect(apiMock.browseControlApprove).toHaveBeenCalledWith({
        domain: 'stripe.com',
        conversationId: 'CONV-9',
      }),
    );

    // The post-approval confirmation modal opens (Base UI dialog — it makes
    // the page behind it inert); dismiss it to get back to the detail pane.
    await user.click(await screen.findByRole('button', { name: 'Back to task' }));

    // Connected state arrives via a push; the detail shows the active domain + Disconnect.
    pushState({ state: 'connected', domain: 'stripe.com' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Disconnect Browser Control' })).toBeInTheDocument(),
    );
  });

  it('skips the server approve call when no conversation is active (would 422)', async () => {
    const user = userEvent.setup();
    mockHost.browserControlListTabs.mockResolvedValue({
      ok: true,
      tabs: [{ targetId: 'T1', title: 'Stripe Docs', url: 'https://docs.stripe.com/api', domain: 'stripe.com' }],
    });
    render(<ConnectWorkflowView />);
    await waitFor(() => expect(screen.getByText('Browser Control')).toBeInTheDocument());
    await user.click(screen.getByText('Browser Control'));
    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));
    await user.click(await screen.findByRole('radio', { name: /Stripe Docs/ }));
    await user.click(screen.getByRole('button', { name: 'Approve this tab' }));
    expect(mockHost.browserControlAttach).toHaveBeenCalledWith('T1');
    // With no active conversation, main's binding is explicitly cleared
    // (null) rather than left stale from a prior conversation — but the
    // server approve call (which would 422 without a conversation id) is
    // still skipped.
    expect(mockHost.browserControlSetConversation).toHaveBeenCalledWith(null);
    expect(apiMock.browseControlApprove).not.toHaveBeenCalled();
  });

  it('a failed tab listing surfaces its real reason in the picker, not the empty state', async () => {
    const user = userEvent.setup();
    mockHost.browserControlListTabs.mockResolvedValue({
      ok: false,
      tabs: [],
      reason: 'Could not find Google Chrome. Install Chrome to use Browser Control.',
    });
    render(<ConnectWorkflowView initialConnectorId="anton_chrome" />);
    await screen.findByTestId('browser-control-detail');
    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));

    const error = await screen.findByTestId('browser-tab-picker-error');
    expect(error).toHaveTextContent(/Could not find Google Chrome/);
    // The misleading "no open tabs" empty state must NOT be shown for a failure.
    expect(screen.queryByText(/No open tabs in Cowork's Chrome window/)).not.toBeInTheDocument();
  });

  it('Try again re-runs the listing without closing the picker and transitions error → tabs', async () => {
    const user = userEvent.setup();
    mockHost.browserControlListTabs
      .mockResolvedValueOnce({ ok: false, tabs: [], reason: 'Chrome did not open a debugging session in time.' })
      .mockResolvedValueOnce({
        ok: true,
        tabs: [{ targetId: 'T1', title: 'Stripe Docs', url: 'https://docs.stripe.com/api', domain: 'stripe.com' }],
      });
    render(<ConnectWorkflowView initialConnectorId="anton_chrome" />);
    await screen.findByTestId('browser-control-detail');
    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));
    await screen.findByTestId('browser-tab-picker-error');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    // Picker stays open, error clears, and the fresh listing renders.
    expect(await screen.findByRole('radio', { name: /Stripe Docs/ })).toBeInTheDocument();
    expect(screen.queryByTestId('browser-tab-picker-error')).not.toBeInTheDocument();
    expect(mockHost.browserControlListTabs).toHaveBeenCalledTimes(2);
  });

  it('empty-but-ok listing shows the dedicated-window empty state with Try again', async () => {
    const user = userEvent.setup();
    mockHost.browserControlListTabs
      .mockResolvedValueOnce({ ok: true, tabs: [] })
      .mockResolvedValueOnce({
        ok: true,
        tabs: [{ targetId: 'T1', title: 'Stripe Docs', url: 'https://docs.stripe.com/api', domain: 'stripe.com' }],
      });
    render(<ConnectWorkflowView initialConnectorId="anton_chrome" />);
    await screen.findByTestId('browser-control-detail');
    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));

    expect(await screen.findByText(/No open tabs in Cowork's Chrome window/)).toBeInTheDocument();
    expect(screen.queryByTestId('browser-tab-picker-error')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: /Stripe Docs/ })).toBeInTheDocument();
  });
});

describe('ConnectWorkflowView — Task A1 entry + tool enablement', () => {
  it('initialConnectorId="anton_chrome" lands directly on the Browser Control detail pane', async () => {
    render(<ConnectWorkflowView initialConnectorId="anton_chrome" />);
    const detail = await screen.findByTestId('browser-control-detail');
    expect(detail).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a Chrome tab' })).toBeInTheDocument();
  });

  it('an unknown initialConnectorId falls back to the default pane', async () => {
    render(<ConnectWorkflowView initialConnectorId="nope_not_real" />);
    await waitFor(() => expect(screen.getByText('Browser Control')).toBeInTheDocument());
    expect(screen.queryByTestId('browser-control-detail')).not.toBeInTheDocument();
  });

  it('approving a tab auto-enables browser_control_enabled and shows the confirmation note', async () => {
    const user = userEvent.setup();
    mockHost.browserControlListTabs.mockResolvedValue({
      ok: true,
      tabs: [{ targetId: 'T1', title: 'Stripe Docs', url: 'https://docs.stripe.com/api', domain: 'stripe.com' }],
    });
    render(<ConnectWorkflowView activeConversationId="CONV-9" initialConnectorId="anton_chrome" />);
    await screen.findByTestId('browser-control-detail');
    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));
    await user.click(await screen.findByRole('radio', { name: /Stripe Docs/ }));
    await user.click(screen.getByRole('button', { name: 'Approve this tab' }));

    // Tool enablement: approving a tab IS the grant — the settings flag is
    // upserted so the server hands the agent the browser_control tool.
    await waitFor(() => expect(apiMock.setBrowserControlEnabled).toHaveBeenCalledWith(true));

    // Post-approval confirmation per a1-approve-autoenable: approved tab
    // echoed + "now enabled" note + Open Settings action.
    const confirm = await screen.findByTestId('browser-approved-confirm');
    expect(confirm).toBeInTheDocument();
    expect(screen.getByText('Tab approved')).toBeInTheDocument();
    expect(screen.getByText('Browser Control is now enabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeInTheDocument();

    // "Back to task" dismisses the confirmation.
    await user.click(screen.getByRole('button', { name: 'Back to task' }));
    expect(screen.queryByTestId('browser-approved-confirm')).not.toBeInTheDocument();
  });

  it('a failed attach keeps the picker open with an error and never claims success', async () => {
    const user = userEvent.setup();
    mockHost.browserControlListTabs.mockResolvedValue({
      ok: true,
      tabs: [{ targetId: 'T1', title: 'Stripe Docs', url: 'https://docs.stripe.com/api', domain: 'stripe.com' }],
    });
    // Chosen tab closed between listing and Approve / CDP attach failed.
    mockHost.browserControlAttach.mockResolvedValueOnce({ ok: false, reason: 'target-gone' });
    render(<ConnectWorkflowView activeConversationId="CONV-9" initialConnectorId="anton_chrome" />);
    await screen.findByTestId('browser-control-detail');
    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));
    await user.click(await screen.findByRole('radio', { name: /Stripe Docs/ }));
    await user.click(screen.getByRole('button', { name: 'Approve this tab' }));

    // The picker stays open with an inline error so the user can retry.
    const error = await screen.findByTestId('browser-tab-picker-error');
    expect(error).toHaveTextContent(/Could not connect to that tab/);
    expect(screen.getByRole('button', { name: 'Approve this tab' })).toBeInTheDocument();
    // Nothing downstream may run off a failed attach: no local approve, no
    // server grant, no tool enablement, no success confirmation.
    expect(mockHost.browserControlApprove).not.toHaveBeenCalled();
    expect(apiMock.browseControlApprove).not.toHaveBeenCalled();
    expect(apiMock.setBrowserControlEnabled).not.toHaveBeenCalled();
    expect(screen.queryByTestId('browser-approved-confirm')).not.toBeInTheDocument();

    // A retry that succeeds proceeds normally and clears the error.
    await user.click(screen.getByRole('button', { name: 'Approve this tab' }));
    await screen.findByTestId('browser-approved-confirm');
    expect(screen.queryByTestId('browser-tab-picker-error')).not.toBeInTheDocument();
  });

  it('a failed settings write shows the "couldn\'t enable" variant, and Retry flips it once the write lands', async () => {
    const user = userEvent.setup();
    mockHost.browserControlListTabs.mockResolvedValue({
      ok: true,
      tabs: [{ targetId: 'T1', title: 'Stripe Docs', url: 'https://docs.stripe.com/api', domain: 'stripe.com' }],
    });
    apiMock.setBrowserControlEnabled.mockResolvedValueOnce({ ok: false });
    render(<ConnectWorkflowView activeConversationId="CONV-9" initialConnectorId="anton_chrome" />);
    await screen.findByTestId('browser-control-detail');
    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));
    await user.click(await screen.findByRole('radio', { name: /Stripe Docs/ }));
    await user.click(screen.getByRole('button', { name: 'Approve this tab' }));

    // The tab IS approved — the confirmation shows — but it must not claim
    // the tool is enabled when the flag write failed.
    await screen.findByTestId('browser-approved-confirm');
    expect(screen.getByTestId('browser-approved-enable-failed')).toBeInTheDocument();
    expect(screen.getByText('Couldn’t enable Browser Control')).toBeInTheDocument();
    expect(screen.queryByText('Browser Control is now enabled')).not.toBeInTheDocument();

    // Retry (mock resolves ok:true on the second call) → enabled variant.
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Browser Control is now enabled')).toBeInTheDocument());
    expect(screen.queryByTestId('browser-approved-enable-failed')).not.toBeInTheDocument();
    expect(apiMock.setBrowserControlEnabled).toHaveBeenCalledTimes(2);
  });

  it('Open Settings routes to the agent settings section and dismisses', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    mockHost.browserControlListTabs.mockResolvedValue({
      ok: true,
      tabs: [{ targetId: 'T1', title: 'Stripe Docs', url: 'https://docs.stripe.com/api', domain: 'stripe.com' }],
    });
    render(<ConnectWorkflowView initialConnectorId="anton_chrome" onOpenSettings={onOpenSettings} />);
    await screen.findByTestId('browser-control-detail');
    await user.click(screen.getByRole('button', { name: 'Choose a Chrome tab' }));
    await user.click(await screen.findByRole('radio', { name: /Stripe Docs/ }));
    await user.click(screen.getByRole('button', { name: 'Approve this tab' }));
    await user.click(await screen.findByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('agent');
    expect(screen.queryByTestId('browser-approved-confirm')).not.toBeInTheDocument();
  });
});

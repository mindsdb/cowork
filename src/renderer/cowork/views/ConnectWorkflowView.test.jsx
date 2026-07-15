import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the api module (network) and the host facade (Electron bridge).
const apiMock = vi.hoisted(() => ({
  fetchIntegrations: vi.fn(async () => ({ items: [] })),
  startConnectorOAuth: vi.fn(),
  pollConnectorOAuth: vi.fn(),
  browseControlApprove: vi.fn(async () => ({ ok: true })),
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
});

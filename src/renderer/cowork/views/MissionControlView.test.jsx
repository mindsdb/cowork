import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The view composes `useBoard` — mocked here so each test controls the four
// columns directly. The Composer and ApprovalCard are stubbed: the board is
// responsible for rendering one ApprovalCard per pending approval and for
// wiring the composer's onSend, not for those components' internals (they
// have their own test files).
const useBoard = vi.hoisted(() => vi.fn());
vi.mock('../components/board/useBoard', () => ({ useBoard }));

const fetchSession = vi.hoisted(() => vi.fn(async () => null));
const openArtifact = vi.hoisted(() => vi.fn(async () => ({})));
const ensureOnboarding = vi.hoisted(() => vi.fn(async () => ({ seeded: true })));
vi.mock('../api', () => ({ fetchSession, openArtifact, ensureOnboarding }));

const hostMock = vi.hoisted(() => ({ isElectron: true, isMac: () => false }));
vi.mock('../../platform/host', () => ({ host: hostMock }));

vi.mock('../components/Composer', () => ({
  default: ({ onSend }) => (
    <button type="button" data-testid="board-composer" onClick={() => onSend?.('hello board')}>
      composer
    </button>
  ),
}));

vi.mock('../components/ApprovalCard', () => ({
  default: ({ approval }) => (
    <div data-testid={`approval-card-${approval?.id}`}>
      {approval?.kind === 'auth'
        ? `Sign in to ${approval?.actionDescriptor?.appName}`
        : approval?.actionDescriptor?.summary}
    </div>
  ),
}));

import MissionControlView from './MissionControlView';

// First-run effects (peek auto-open, ensure-seed, first-ship) are
// localStorage/sessionStorage-gated — seed them OFF so existing tests stay
// hermetic; dedicated tests re-arm what they exercise.
beforeEach(() => {
  localStorage.setItem('cowork.peekAutoOpened', '1');
  localStorage.setItem('cowork.firstShipCelebrated', '1');
  sessionStorage.setItem('cowork.onboardingEnsured', '1');
});

function board(overrides = {}) {
  return {
    needsYou: [],
    running: [],
    scheduled: [],
    expired: [],
    shipped: { today: [], older: [] },
    metrics: null,
    loading: false,
    refresh: vi.fn(),
    ...overrides,
  };
}

const pendingAction = {
  id: 'ap-1',
  conversationId: 'conv-1',
  kind: 'action',
  status: 'pending',
  actionDescriptor: { tool: 'gmail_send', args: {}, summary: 'Send the reply to Abi' },
  createdAt: '2026-07-23T10:00:00Z',
};

const pendingAuth = {
  id: 'ap-2',
  conversationId: 'conv-2',
  kind: 'auth',
  status: 'pending',
  actionDescriptor: { appName: 'Gmail', tabId: 'tab-9' },
  createdAt: '2026-07-23T10:05:00Z',
};

describe('MissionControlView — headline', () => {
  it('reads "Nothing needs you" at zero', () => {
    useBoard.mockReturnValue(board());
    render(<MissionControlView />);
    expect(screen.getByText('Nothing needs you. Anton has the rest.')).toBeInTheDocument();
  });

  it('singular at one', () => {
    useBoard.mockReturnValue(board({ needsYou: [pendingAction] }));
    render(<MissionControlView />);
    expect(screen.getByText('1 thing needs you. Anton has the rest.')).toBeInTheDocument();
  });

  it('plural at many, and honors a custom agent label', () => {
    useBoard.mockReturnValue(board({ needsYou: [pendingAction, pendingAuth, { ...pendingAction, id: 'ap-3' }] }));
    render(<MissionControlView agentLabel="Rex" />);
    expect(screen.getByText('3 things need you. Rex has the rest.')).toBeInTheDocument();
  });
});

describe('MissionControlView — columns', () => {
  it('shows the quiet captions when every column is empty', () => {
    useBoard.mockReturnValue(board());
    render(<MissionControlView />);
    expect(screen.getByText('Work waiting on you')).toBeInTheDocument();
    expect(screen.getByText("Anton's work in progress")).toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled')).toBeInTheDocument();
    expect(screen.getByText('Shipped work lands here')).toBeInTheDocument();
  });

  it('renders one ApprovalCard per pending approval in Needs You', () => {
    useBoard.mockReturnValue(board({ needsYou: [pendingAction, pendingAuth] }));
    render(<MissionControlView />);
    const col = screen.getByLabelText('Needs You');
    expect(col.textContent).toContain('2');
    expect(screen.getByTestId('approval-card-ap-1')).toBeInTheDocument();
    expect(screen.getByTestId('approval-card-ap-2')).toBeInTheDocument();
  });

  it('renders running and scheduled rows', () => {
    useBoard.mockReturnValue(board({
      running: [{ conversationId: 'c1', topic: 'Weekly digest', startedAt: '2026-07-23T09:00:00Z' }],
      scheduled: [{ id: 's1', title: 'Morning digest', cadence: 'daily', enabled: true, nextRunAt: '2026-07-24T08:00:00Z' }],
    }));
    render(<MissionControlView />);
    expect(screen.getByText('Weekly digest')).toBeInTheDocument();
    expect(screen.getByText('Morning digest')).toBeInTheDocument();
    expect(screen.getByText(/Daily · Next/)).toBeInTheDocument();
  });

  it('collapses expired approvals into one quiet row', () => {
    useBoard.mockReturnValue(board({
      expired: [{ id: 'x1' }, { id: 'x2' }],
    }));
    render(<MissionControlView />);
    expect(screen.getByText('2 approvals expired while you were away')).toBeInTheDocument();
  });

  it('uses singular copy for one expired approval', () => {
    useBoard.mockReturnValue(board({ expired: [{ id: 'x1' }] }));
    render(<MissionControlView />);
    expect(screen.getByText('1 approval expired while you were away')).toBeInTheDocument();
  });

  it('shows the expired row even when nothing is pending', () => {
    useBoard.mockReturnValue(board({ expired: [{ id: 'x1' }] }));
    render(<MissionControlView />);
    expect(screen.queryByText('Work waiting on you')).toBeNull();
    expect(screen.getByText('1 approval expired while you were away')).toBeInTheDocument();
  });

  it('marks paused schedules', () => {
    useBoard.mockReturnValue(board({
      scheduled: [{ id: 's1', title: 'Paused digest', cadence: 'weekly', enabled: false }],
    }));
    render(<MissionControlView />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
  });

  it('groups shipped into Today and Earlier', () => {
    useBoard.mockReturnValue(board({
      shipped: {
        today: [{ id: 'a1', conversationId: 'c1', kind: 'action', status: 'approved', actionDescriptor: { summary: 'Today item' }, resolvedAt: '2026-07-23T11:00:00Z' }],
        older: [{ id: 'a2', conversationId: 'c2', kind: 'action', status: 'edited', actionDescriptor: { summary: 'Older item' }, resolvedAt: '2026-07-20T11:00:00Z' }],
      },
    }));
    render(<MissionControlView />);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Earlier')).toBeInTheDocument();
    expect(screen.getByText('Today item')).toBeInTheDocument();
    expect(screen.getByText('Older item')).toBeInTheDocument();
    expect(screen.getByText(/Edited & sent/)).toBeInTheDocument();
  });
});

describe('MissionControlView — shipped receipts', () => {
  it('shows receipt.result.summary when present', () => {
    useBoard.mockReturnValue(board({
      shipped: {
        today: [{
          id: 'a1', conversationId: 'c1', kind: 'action', status: 'approved',
          actionDescriptor: { summary: 'Update the sheet' },
          receipt: { executed: true, result: { summary: '26 rows → B2:G12' } },
          resolvedAt: '2026-07-23T11:00:00Z',
        }],
        older: [],
      },
    }));
    render(<MissionControlView />);
    expect(screen.getByText('26 rows → B2:G12')).toBeInTheDocument();
  });

  it('shows receipt.error when the action failed', () => {
    useBoard.mockReturnValue(board({
      shipped: {
        today: [{
          id: 'a1', conversationId: 'c1', kind: 'action', status: 'approved',
          actionDescriptor: { summary: 'Send the note' },
          receipt: { executed: false, error: 'SMTP rejected the message' },
          resolvedAt: '2026-07-23T11:00:00Z',
        }],
        older: [],
      },
    }));
    render(<MissionControlView />);
    expect(screen.getByText('SMTP rejected the message')).toBeInTheDocument();
  });

  it('falls back to "Approved · <relative>" for a bare receipt', () => {
    useBoard.mockReturnValue(board({
      shipped: {
        today: [{
          id: 'a1', conversationId: 'c1', kind: 'action', status: 'approved',
          actionDescriptor: { summary: 'Send the note' },
          receipt: { executed: true, resolved_at: '2026-07-23T11:00:00Z' },
          resolvedAt: '2026-07-23T11:00:00Z',
        }],
        older: [],
      },
    }));
    render(<MissionControlView />);
    expect(screen.getByText(/Approved · /)).toBeInTheDocument();
  });

  it('surfaces an artifact link when the receipt references one', () => {
    useBoard.mockReturnValue(board({
      shipped: {
        today: [{
          id: 'a1', conversationId: 'c1', kind: 'action', status: 'approved',
          actionDescriptor: { summary: 'Build the report' },
          receipt: { executed: true, result: { summary: 'Report built' }, artifact: '/tmp/artifacts/q3-report.html' },
          resolvedAt: '2026-07-23T11:00:00Z',
        }],
        older: [],
      },
    }));
    render(<MissionControlView />);
    const link = screen.getByRole('button', { name: 'q3-report.html' });
    fireEvent.click(link);
    expect(openArtifact).toHaveBeenCalledWith('/tmp/artifacts/q3-report.html');
  });
});

describe('MissionControlView — peek', () => {
  const runningBoard = () => board({
    running: [{ conversationId: 'c1', topic: 'Weekly digest', startedAt: null }],
  });

  beforeEach(() => {
    hostMock.isElectron = true;
  });

  it('opens a read-only transcript and closes via the close button', async () => {
    fetchSession.mockImplementation(async () => ({
      messages: [
        { role: 'user', content: 'Draft the weekly update' },
        { role: 'assistant', content: 'On it — pulling the numbers.' },
        { role: '_streaming', content: '' },
        { role: 'activity', content: 'Thinking…' },
      ],
    }));
    useBoard.mockReturnValue(runningBoard());
    render(<MissionControlView />);

    fireEvent.click(screen.getByRole('button', { name: 'Peek' }));
    const panel = screen.getByLabelText('Peek — Weekly digest');
    expect(panel).toBeInTheDocument();

    expect(await screen.findByText('Draft the weekly update')).toBeInTheDocument();
    expect(screen.getByText('On it — pulling the numbers.')).toBeInTheDocument();
    // Internal roles are filtered out of the transcript.
    expect(screen.queryByText('Thinking…')).toBeNull();
    expect(fetchSession).toHaveBeenCalledWith('c1');

    fireEvent.click(screen.getByRole('button', { name: 'Close peek' }));
    expect(screen.queryByLabelText('Peek — Weekly digest')).toBeNull();
  });

  it('closes on Escape', async () => {
    fetchSession.mockImplementation(async () => ({ messages: [] }));
    useBoard.mockReturnValue(runningBoard());
    render(<MissionControlView />);
    fireEvent.click(screen.getByRole('button', { name: 'Peek' }));
    expect(screen.getByLabelText('Peek — Weekly digest')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Peek — Weekly digest')).toBeNull();
  });

  it('offers "Watch live" in the Electron shell and routes to the browser', async () => {
    hostMock.isElectron = true;
    fetchSession.mockImplementation(async () => ({ messages: [] }));
    const onNavigate = vi.fn();
    useBoard.mockReturnValue(runningBoard());
    render(<MissionControlView onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Peek' }));
    fireEvent.click(await screen.findByRole('button', { name: /Watch live/ }));
    expect(onNavigate).toHaveBeenCalledWith('browser');
    expect(screen.queryByLabelText('Peek — Weekly digest')).toBeNull();
  });

  it('hides "Watch live" in the web shell', async () => {
    hostMock.isElectron = false;
    fetchSession.mockImplementation(async () => ({ messages: [] }));
    useBoard.mockReturnValue(runningBoard());
    render(<MissionControlView />);
    fireEvent.click(screen.getByRole('button', { name: 'Peek' }));
    expect(screen.getByLabelText('Peek — Weekly digest')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Watch live/ })).toBeNull();
    hostMock.isElectron = true;
  });
});

describe('MissionControlView — drill-in + composer', () => {
  it('drills into the conversation from Running and Shipped rows', () => {
    const onSelectTask = vi.fn();
    useBoard.mockReturnValue(board({
      running: [{ conversationId: 'c1', topic: 'Weekly digest', startedAt: null }],
      shipped: {
        today: [{ id: 'a1', conversationId: 'c9', kind: 'action', status: 'approved', actionDescriptor: { summary: 'Sent the update' }, resolvedAt: '2026-07-23T11:00:00Z' }],
        older: [],
      },
    }));
    render(<MissionControlView onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByText('Weekly digest'));
    expect(onSelectTask).toHaveBeenCalledWith('c1');

    fireEvent.click(screen.getByText('Sent the update'));
    expect(onSelectTask).toHaveBeenCalledWith('c9');
  });

  it('routes scheduled rows to the scheduled view', () => {
    const onNavigate = vi.fn();
    useBoard.mockReturnValue(board({
      scheduled: [{ id: 's1', title: 'Morning digest', cadence: 'daily', enabled: true, nextRunAt: '2026-07-24T08:00:00Z' }],
    }));
    render(<MissionControlView onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Morning digest'));
    expect(onNavigate).toHaveBeenCalledWith('scheduled');
  });

  it('wires the board composer into onSend', () => {
    const onSend = vi.fn();
    useBoard.mockReturnValue(board());
    render(<MissionControlView onSend={onSend} />);
    fireEvent.click(screen.getByTestId('board-composer'));
    expect(onSend).toHaveBeenCalledWith('hello board');
  });
});

describe('MissionControlView — loading', () => {
  it('shows a spinner instead of columns while loading', () => {
    useBoard.mockReturnValue(board({ loading: true }));
    render(<MissionControlView />);
    expect(screen.queryByText('Nothing scheduled')).toBeNull();
    expect(screen.queryByText('Work waiting on you')).toBeNull();
  });
});

describe('Mission Control — metrics row (M4)', () => {
  it('renders the measured claim under the headline', () => {
    useBoard.mockReturnValue(board({
      metrics: {
        shipped: 12, needsYou: 3, autonomyRatio: 4,
        editRate: 0.25, skipRate: 0.125,
        medianTimeToResolveSeconds: 42,
        injectionTripwireHits: {}, gateQuality: {},
      },
    }));
    render(<MissionControlView />);
    const row = screen.getByTestId('metrics-row');
    expect(row.textContent).toContain('12 shipped · 3 needed you (400% autonomous)');
    expect(row.textContent).toContain('25% edited · 13% skipped');
    expect(row.textContent).toContain('resolves in ~42s');
  });

  it('hides the row when the server has no metrics', () => {
    useBoard.mockReturnValue(board({ metrics: null }));
    render(<MissionControlView />);
    expect(screen.queryByTestId('metrics-row')).toBeNull();
  });
});

describe('Mission Control — first-run effects (O2/O3)', () => {
  it('auto-opens Peek once on the first Running card', () => {
    localStorage.removeItem('cowork.peekAutoOpened');
    fetchSession.mockImplementation(async () => ({ messages: [] }));
    useBoard.mockReturnValue(board({
      running: [{ conversationId: 'c1', topic: 'Inbox scan', startedAt: null }],
    }));
    render(<MissionControlView />);
    return waitFor(() => {
      expect(fetchSession).toHaveBeenCalledWith('c1');
      expect(localStorage.getItem('cowork.peekAutoOpened')).toBe('1');
    });
  });

  it('calls ensureOnboarding once per session', async () => {
    sessionStorage.removeItem('cowork.onboardingEnsured');
    ensureOnboarding.mockClear();
    useBoard.mockReturnValue(board());
    render(<MissionControlView />);
    await waitFor(() => expect(ensureOnboarding).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('cowork.onboardingEnsured')).toBe('1');
  });

  it('celebrates the first shipped item with highlight + one-time notify', async () => {
    localStorage.removeItem('cowork.firstShipCelebrated');
    const notify = vi.fn();
    hostMock.appNotify = notify;
    const shippedOne = {
      id: 'ap-9', conversationId: 'c9', kind: 'action', status: 'approved',
      actionDescriptor: { summary: 'Box-office sheet' },
      receipt: { executed: true, summary: '26 rows → B2:G12' },
      resolvedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    };
    useBoard.mockReturnValue(board({
      shipped: { today: [shippedOne], older: [] },
      metrics: { shipped: 1, needsYou: 0, autonomyRatio: null, editRate: 0, skipRate: 0, medianTimeToResolveSeconds: null, injectionTripwireHits: {}, gateQuality: {} },
    }));
    render(<MissionControlView />);
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0][0].title).toContain('shipped its first work');
    expect(localStorage.getItem('cowork.firstShipCelebrated')).toBe('1');
  });

  it('does not celebrate when the day-two moment already happened', () => {
    const notify = vi.fn();
    hostMock.appNotify = notify;
    useBoard.mockReturnValue(board({
      shipped: { today: [{ id: 'ap-9', status: 'approved', actionDescriptor: {}, receipt: {}, resolvedAt: new Date().toISOString(), createdAt: '' }], older: [] },
      metrics: { shipped: 1, needsYou: 0, autonomyRatio: null, editRate: 0, skipRate: 0, medianTimeToResolveSeconds: null, injectionTripwireHits: {}, gateQuality: {} },
    }));
    render(<MissionControlView />);
    expect(notify).not.toHaveBeenCalled();
  });
});

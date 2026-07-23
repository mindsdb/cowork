import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The view composes `useBoard` — mocked here so each test controls the four
// columns directly. The Composer is stubbed with a button that fires onSend,
// which is all the wiring this view is responsible for.
const useBoard = vi.hoisted(() => vi.fn());
vi.mock('../components/board/useBoard', () => ({ useBoard }));

vi.mock('../components/Composer', () => ({
  default: ({ onSend }) => (
    <button type="button" data-testid="board-composer" onClick={() => onSend?.('hello board')}>
      composer
    </button>
  ),
}));

import MissionControlView from './MissionControlView';

function board(overrides = {}) {
  return {
    needsYou: [],
    running: [],
    scheduled: [],
    expired: [],
    shipped: { today: [], older: [] },
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

  it('renders column counts and rows', () => {
    useBoard.mockReturnValue(board({
      needsYou: [pendingAction, pendingAuth],
      running: [{ conversationId: 'c1', topic: 'Weekly digest', startedAt: '2026-07-23T09:00:00Z' }],
      scheduled: [{ id: 's1', title: 'Morning digest', cadence: 'daily', enabled: true, nextRunAt: '2026-07-24T08:00:00Z' }],
      shipped: {
        today: [{ id: 'ap-9', conversationId: 'c9', kind: 'action', status: 'approved', actionDescriptor: { summary: 'Sent the update' }, resolvedAt: '2026-07-23T11:00:00Z' }],
        older: [],
      },
    }));
    render(<MissionControlView />);

    const needsYouCol = screen.getByLabelText('Needs You');
    expect(needsYouCol.textContent).toContain('2');
    expect(screen.getByText('Send the reply to Abi')).toBeInTheDocument();
    expect(screen.getByText('Sign in to Gmail')).toBeInTheDocument();

    expect(screen.getByText('Weekly digest')).toBeInTheDocument();
    expect(screen.getByText('Morning digest')).toBeInTheDocument();
    expect(screen.getByText(/Daily · Next/)).toBeInTheDocument();
    expect(screen.getByText('Sent the update')).toBeInTheDocument();
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

describe('MissionControlView — drill-in + composer', () => {
  it('drills into the conversation from Needs You / Running / Shipped rows', () => {
    const onSelectTask = vi.fn();
    useBoard.mockReturnValue(board({
      needsYou: [pendingAction],
      running: [{ conversationId: 'c1', topic: 'Weekly digest', startedAt: null }],
      shipped: {
        today: [{ id: 'a1', conversationId: 'c9', kind: 'action', status: 'approved', actionDescriptor: { summary: 'Sent the update' }, resolvedAt: '2026-07-23T11:00:00Z' }],
        older: [],
      },
    }));
    render(<MissionControlView onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByText('Send the reply to Abi'));
    expect(onSelectTask).toHaveBeenCalledWith('conv-1');

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

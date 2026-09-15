import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  deleteConversationTurn: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessions: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: (...args) => spies.fetchSession(...args),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => []),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
  unpinTask: vi.fn(async () => ({})),
  deleteConversationTurn: (...args) => spies.deleteConversationTurn(...args),
}));

// The chat tree is stubbed so this file tests App's in-flight bookkeeping
// alone: which turn it publishes as deleting, and when it stops. The bubble
// treatment that reads `deletingTurnIndex` is covered in
// views/ChatView.deletingTurn.test.jsx, which also pins the prop contract
// between the two.
vi.mock('./views/ChatView', () => ({
  default: ({ task, deletingTurnIndex, onDeleteTurn }) => (
    <div>
      <div>Chat task: {task?.title || 'none'}</div>
      {deletingTurnIndex != null && <div>{`Deleting turn: ${deletingTurnIndex}`}</div>}
      {(task?.messages || []).map((m, i) => (
        <div key={i}>{`msg: ${m.role}: ${m.content}`}</div>
      ))}
      {[0, 1].map((idx) => (
        <button key={idx} type="button" onClick={() => onDeleteTurn?.(idx)}>
          {`Request turn delete ${idx}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('./views/ProjectsView', () => ({
  default: ({ tasks, onSelectTask }) => (
    <div>
      {(tasks || []).map((t) => (
        <button key={t.id} type="button" onClick={() => onSelectTask(t.id)}>
          {`Open task ${t.title}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isWeb: true,
      isMac: () => false,
      getApiOrigin: () => 'http://localhost:1',
      openPath: vi.fn(),
      openExternal: vi.fn(),
      onUpdateStatus: () => () => {},
      onOAuthRefreshError: () => () => {},
      onMindsHubAuthChanged: () => () => {},
      getKeychainPref: vi.fn(async () => false),
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
      removeCodingTask: vi.fn(async () => ({})),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

import App from './App';

const exchange = [
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
  { role: 'user', content: 'second question' },
  { role: 'assistant', content: 'second answer' },
];

const task = {
  id: 'conv-a',
  title: 'Saved task',
  messages: exchange,
  status: 'idle',
};
const otherTask = {
  id: 'conv-b',
  title: 'Other task',
  messages: exchange,
  status: 'idle',
};
// A conversation with no server history yet: performDeleteTurn drops the pair
// locally and never reaches the network.
const localTask = {
  id: 'tmp-local-1',
  title: 'Unsaved task',
  messages: [
    { role: 'user', content: 'local question' },
    { role: 'assistant', content: 'local answer' },
  ],
  status: 'idle',
};

// The failure path is a bare alert(), which this environment does not define.
let alertSpy;
const originalAlert = window.alert;

beforeEach(() => {
  alertSpy = vi.fn();
  window.alert = alertSpy;
  spies.deleteConversationTurn.mockReset().mockResolvedValue({ status: 'deleted' });
  spies.fetchSession.mockReset().mockImplementation(async (id) => ({
    id,
    messages: exchange,
  }));
  spies.fetchSessions.mockReset().mockResolvedValue([
    { ...task },
    { ...otherTask },
    { ...localTask },
  ]);
});

afterEach(() => {
  window.alert = originalAlert;
});

const openTask = async (user, which) => {
  await user.click(await screen.findByRole('button', { name: 'Projects' }));
  await user.click(await screen.findByRole('button', { name: `Open task ${which.title}` }));
  expect(await screen.findByText(`Chat task: ${which.title}`)).toBeInTheDocument();
};

const confirmDelete = async (user, idx) => {
  await user.click(await screen.findByRole('button', { name: `Request turn delete ${idx}` }));
  expect(await screen.findByText('Delete this exchange?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
};

describe('deleting a turn shows it as in flight', () => {
  it('publishes the turn as deleting until the refetched list lands', async () => {
    const user = userEvent.setup();
    let resolveDelete;
    spies.deleteConversationTurn.mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    render(<App />);
    await openTask(user, task);

    await confirmDelete(user, 0);

    // The DELETE is still out: the turn must already read as in flight.
    expect(await screen.findByText('Deleting turn: 0')).toBeInTheDocument();

    // The server has answered, but the list still shows the old messages until
    // the refetch lands. Clearing here would un-dim the turn and leave it
    // sitting there looking untouched for the whole second round trip.
    let resolveRefetch;
    spies.fetchSession.mockImplementation(() => new Promise((resolve) => {
      resolveRefetch = resolve;
    }));
    await act(async () => { resolveDelete({ status: 'deleted' }); });
    expect(screen.getByText('Deleting turn: 0')).toBeInTheDocument();

    await act(async () => {
      resolveRefetch({ id: task.id, messages: exchange.slice(2) });
    });
    await waitFor(() => {
      expect(screen.queryByText('Deleting turn: 0')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('msg: user: first question')).not.toBeInTheDocument();
    expect(screen.getByText('msg: user: second question')).toBeInTheDocument();
  });

  it('refuses a second delete in the same conversation while one is in flight', async () => {
    const user = userEvent.setup();
    let resolveDelete;
    spies.deleteConversationTurn.mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    render(<App />);
    await openTask(user, task);

    await confirmDelete(user, 0);
    expect(await screen.findByText('Deleting turn: 0')).toBeInTheDocument();

    // A stale index: the server reindexes what survives, so this second
    // request would delete the wrong exchange.
    await user.click(screen.getByRole('button', { name: 'Request turn delete 1' }));
    expect(screen.queryByText('Delete this exchange?')).not.toBeInTheDocument();
    expect(spies.deleteConversationTurn).toHaveBeenCalledTimes(1);

    await act(async () => { resolveDelete({ status: 'deleted' }); });
  });

  it('still allows a delete in a different conversation', async () => {
    const user = userEvent.setup();
    let resolveDelete;
    spies.deleteConversationTurn.mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    render(<App />);
    await openTask(user, task);
    await confirmDelete(user, 0);
    expect(await screen.findByText('Deleting turn: 0')).toBeInTheDocument();

    await openTask(user, otherTask);
    // The in-flight turn belongs to the other conversation, so nothing here
    // reads as deleting and the affordance still works.
    expect(screen.queryByText('Deleting turn: 0')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request turn delete 0' }));
    expect(await screen.findByText('Delete this exchange?')).toBeInTheDocument();

    await act(async () => { resolveDelete({ status: 'deleted' }); });
  });

  it('clears the in-flight state when the server fails and leaves the turn deletable', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(new Error('turn is locked'));
    render(<App />);
    await openTask(user, task);

    await confirmDelete(user, 0);

    await waitFor(() => {
      expect(screen.queryByText('Deleting turn: 0')).not.toBeInTheDocument();
    });
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('turn is locked'));
    // Nothing was removed, and the turn can be deleted again.
    expect(screen.getByText('msg: user: first question')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request turn delete 0' }));
    expect(await screen.findByText('Delete this exchange?')).toBeInTheDocument();
  });

  it('drops a local-only turn synchronously without touching the network', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openTask(user, localTask);
    expect(screen.getByText('msg: user: local question')).toBeInTheDocument();

    await confirmDelete(user, 0);

    await waitFor(() => {
      expect(screen.queryByText('msg: user: local question')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('msg: assistant: local answer')).not.toBeInTheDocument();
    expect(spies.deleteConversationTurn).not.toHaveBeenCalled();
    expect(screen.queryByText('Deleting turn: 0')).not.toBeInTheDocument();
  });
});

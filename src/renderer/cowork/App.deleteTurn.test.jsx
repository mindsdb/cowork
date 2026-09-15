import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  deleteConversationTurn: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionResult: vi.fn(),
  fetchSessions: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: (...args) => spies.fetchSession(...args),
  fetchSessionResult: (...args) => spies.fetchSessionResult(...args),
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
  spies.fetchSessionResult.mockReset().mockImplementation(async (id) => ({
    status: 'ok',
    task: { id, messages: exchange },
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
    spies.fetchSessionResult.mockImplementation(() => new Promise((resolve) => {
      resolveRefetch = resolve;
    }));
    await act(async () => { resolveDelete({ status: 'deleted' }); });
    expect(screen.getByText('Deleting turn: 0')).toBeInTheDocument();

    await act(async () => {
      resolveRefetch({ status: 'ok', task: { id: task.id, messages: exchange.slice(2) } });
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
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('turn is locked'), { status: 423 }),
    );
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

  it('resyncs the list before handing the delete affordances back', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('turn is locked'), { status: 423 }),
    );
    render(<App />);
    await openTask(user, task);
    spies.fetchSessionResult.mockClear();
    // A delete we did not see confirmed may still have landed, and the server
    // reindexes what survives. Re-enabling delete against the old list would
    // aim the next one at a different exchange than the user is looking at.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: { id: task.id, messages: exchange.slice(2) },
    });

    await confirmDelete(user, 0);

    await waitFor(() => expect(spies.fetchSessionResult).toHaveBeenCalledWith(task.id));
    await waitFor(() => {
      expect(screen.queryByText('msg: user: first question')).not.toBeInTheDocument();
    });
    expect(screen.getByText('msg: user: second question')).toBeInTheDocument();
  });

  it('warns when the delete landed but the list could not be re-synced', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockResolvedValue({ status: 'deleted' });
    render(<App />);
    await openTask(user, task);
    spies.fetchSessionResult.mockRejectedValue(new Error('network down'));

    await confirmDelete(user, 0);

    // The quiet version of this is the one that loses data: the exchange is
    // gone on the server, the list still shows it, and the next delete is
    // keyed by position in that list.
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/could not be refreshed/i);
    expect(alertSpy.mock.calls[0][0]).toMatch(/reload/i);
  });

  it('words a timeout as unconfirmed rather than failed', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('The delete request timed out after 30 seconds.'), { code: 'timeout' }),
    );
    render(<App />);
    await openTask(user, task);
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: { id: task.id, messages: exchange.slice(2) },
    });

    await confirmDelete(user, 0);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const said = alertSpy.mock.calls[0][0];
    // Abandoning the request says nothing about the server, so the copy must
    // not assert a failure the user can see is untrue a moment later.
    expect(said).toMatch(/may still have gone through/i);
    expect(said).not.toMatch(/could not delete this exchange/i);
  });

  it('warns harder when a timeout could not be re-synced either', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('The delete request timed out after 30 seconds.'), { code: 'timeout' }),
    );
    render(<App />);
    await openTask(user, task);
    spies.fetchSessionResult.mockRejectedValue(new Error('network down'));

    await confirmDelete(user, 0);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/could not be refreshed/i);
  });

  it('treats a transcript that failed to load as a failed re-sync', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(new Error('gateway timeout'));
    render(<App />);
    await openTask(user, task);
    // The conversation's metadata answers and its `/items` does not. Both mocks
    // describe that one server state: fetchSession collapses it to an empty
    // transcript, which would blank the list and read as a clean re-sync.
    spies.fetchSession.mockResolvedValue({ id: task.id, messages: [] });
    spies.fetchSessionResult.mockResolvedValue({ status: 'unavailable', code: 500 });

    await confirmDelete(user, 0);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/could not be refreshed/i);
    // Nothing was deleted, so nothing may disappear from the list either.
    expect(screen.getByText('msg: user: first question')).toBeInTheDocument();
    expect(screen.getByText('msg: user: second question')).toBeInTheDocument();
  });

  it('refreshes instead of deleting after an unconfirmed timeout, then allows the next delete', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('The delete request timed out after 30 seconds.'), { code: 'timeout' }),
    );
    render(<App />);
    await openTask(user, task);
    // We gave up on the wire before the server committed, so this re-sync still
    // shows the exchange. It says nothing about what the server will do next.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: { id: task.id, messages: exchange },
    });

    await confirmDelete(user, 0);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(screen.getByText('msg: user: first question')).toBeInTheDocument();

    // The server finished the delete after we stopped listening and reindexed
    // what survived: index 1 on screen is no longer index 1 on the server.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: { id: task.id, messages: exchange.slice(2) },
    });
    alertSpy.mockClear();

    await user.click(screen.getByRole('button', { name: 'Request turn delete 1' }));

    // The click buys a refresh, not a delete: sending that index would have
    // removed an exchange the user never pointed at.
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/refreshed/i);
    expect(screen.queryByText('Delete this exchange?')).not.toBeInTheDocument();
    expect(spies.deleteConversationTurn).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('msg: user: first question')).not.toBeInTheDocument();
    });

    // The list is the server's again, so deleting works normally from here.
    await user.click(screen.getByRole('button', { name: 'Request turn delete 0' }));
    expect(await screen.findByText('Delete this exchange?')).toBeInTheDocument();
  });

  it('gates the next delete when the delete answered with a gateway error', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('Delete turn failed (504)'), { status: 504 }),
    );
    render(<App />);
    await openTask(user, task);
    // The proxy stopped waiting; cowork-server may still be deleting. The list
    // this returns predates a commit it cannot show.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: { id: task.id, messages: exchange },
    });

    await confirmDelete(user, 0);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/may still have gone through/i);
    alertSpy.mockClear();

    await user.click(screen.getByRole('button', { name: 'Request turn delete 1' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(screen.queryByText('Delete this exchange?')).not.toBeInTheDocument();
    expect(spies.deleteConversationTurn).toHaveBeenCalledTimes(1);
  });

  it('refuses a refused delete nothing more: a 4xx leaves the turn deletable', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('turn is locked'), { status: 423 }),
    );
    render(<App />);
    await openTask(user, task);

    await confirmDelete(user, 0);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/turn is locked/);
    alertSpy.mockClear();

    // The server was explicit that it did not delete anything, so the list is
    // still the server's and the next delete needs no refresh first.
    await user.click(screen.getByRole('button', { name: 'Request turn delete 1' }));
    expect(await screen.findByText('Delete this exchange?')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('keeps refusing while the conversation still cannot be re-synced', async () => {
    const user = userEvent.setup();
    spies.deleteConversationTurn.mockRejectedValue(new Error('gateway timeout'));
    render(<App />);
    await openTask(user, task);
    spies.fetchSessionResult.mockRejectedValue(new Error('network down'));

    await confirmDelete(user, 0);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    alertSpy.mockClear();

    await user.click(screen.getByRole('button', { name: 'Request turn delete 1' }));

    await waitFor(() => {
      expect(alertSpy.mock.calls.some(([said]) => /reload/i.test(said))).toBe(true);
    });
    expect(screen.queryByText('Delete this exchange?')).not.toBeInTheDocument();
    expect(spies.deleteConversationTurn).toHaveBeenCalledTimes(1);
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
  });
});

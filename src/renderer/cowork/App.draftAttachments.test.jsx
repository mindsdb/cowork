// ENG-4622: a file attached in a composer stays with that composer's thread
// when the user moves between Home and chats, and never shows in another one.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => [
    { id: 'conv-a', title: 'Task A', messages: [], status: 'idle', projectName: 'general' },
    { id: 'conv-b', title: 'Task B', messages: [], status: 'idle', projectName: 'general' },
  ]),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ id: 'general-id', name: 'general', path: '/projects/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
}));

// Each view stands in for its composer: it shows the chips it is handed and
// attaches a file the way a paste does.
const composerStub = (label) => ({ attachments, onAttachFiles, onSend }) => (
  <div>
    <div data-testid="chips">{label}: {(attachments || []).map((a) => a.name).join('|')}</div>
    <button type="button" onClick={() => onAttachFiles([new File([new Uint8Array([1])], `${label}.png`, { type: 'image/png' })])}>
      Paste into {label}
    </button>
    <button type="button" onClick={() => { void onSend?.('look at this'); }}>Send from {label}</button>
  </div>
);
vi.mock('./views/HomeView', () => ({ default: (props) => composerStub('home')(props) }));
vi.mock('./views/ChatView', () => ({ default: (props) => composerStub(props.task?.id || 'none')(props) }));

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
import { fetchHealth } from './api';
import { __resetDraftsForTests } from './lib/draftStore';

beforeEach(() => {
  vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', config_ready: true });
  __resetDraftsForTests();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('drafted attachments across threads', () => {
  it('keeps each thread its own files when switching between Home and chats', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Paste into home' }));
    expect(screen.getByTestId('chips')).toHaveTextContent('home: home.png');

    await user.click(await screen.findByText('Task A'));
    expect(await screen.findByTestId('chips')).toHaveTextContent(/^conv-a:$/);
    await user.click(screen.getByRole('button', { name: 'Paste into conv-a' }));
    expect(screen.getByTestId('chips')).toHaveTextContent('conv-a: conv-a.png');

    await user.click(screen.getByText('Task B'));
    expect(await screen.findByTestId('chips')).toHaveTextContent(/^conv-b:$/);

    await user.click(screen.getByText('Task A'));
    expect(await screen.findByTestId('chips')).toHaveTextContent('conv-a: conv-a.png');

    await user.click(screen.getAllByRole('button', { name: /new task/i })[0]);
    expect(await screen.findByTestId('chips')).toHaveTextContent('home: home.png');
  });

  it('keeps Home\'s drafted files when a send stops at the provider setup card', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Paste into home' }));

    vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', config_ready: false });
    await user.click(screen.getByRole('button', { name: 'Send from home' }));
    await screen.findByText(/^tmp-.*:$/);

    await user.click(screen.getAllByRole('button', { name: /new task/i })[0]);
    expect(await screen.findByTestId('chips')).toHaveTextContent('home: home.png');
  });
});

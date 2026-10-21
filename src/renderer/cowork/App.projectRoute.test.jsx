import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: (...args) => spies.fetchHealth(...args),
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: (...args) => spies.fetchProjects(...args),
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
  createProject: vi.fn(async () => ({})),
}));

vi.mock('./views/ProjectsView', () => ({
  default: ({ projects, selectedProject, onSendInProject }) => (
    <div>
      <span>Selected project: {selectedProject?.name || 'none'}</span>
      {(projects || []).map((project) => (
        <span key={project.id}>Project: {project.name}</span>
      ))}
      {selectedProject?.shared && <button onClick={(event) => {
        const button = event.currentTarget;
        onSendInProject('Run', { project: selectedProject }).catch((error) => { button.textContent = error.message; });
      }}>Attempt recipient send</button>}
    </div>
  ),
}));

vi.mock('./views/HomeView', () => ({
  default: ({ project, projects }) => <div>
    <span>Home project: {project?.name || 'none'}</span>
    {(projects || []).map((item) => <span key={item.id}>Runnable: {item.id}</span>)}
  </div>,
}));

vi.mock('./views/ChatView', () => ({
  default: () => <div>Chat</div>,
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

const general = { id: 'general-id', name: 'general', path: '/projects/general' };

/* Lets the boot default to general run if it is going to: the server comes
   online, the project list loads, and any selection it makes reaches the URL. */
async function settle() {
  await screen.findByText(`Project: ${general.name}`);
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

beforeEach(() => {
  spies.fetchProjects.mockReset().mockResolvedValue([{ ...general }]);
  spies.fetchHealth.mockClear();
});

describe('the projects route on a cold load', () => {
  it('opens shared projects by UUID, refuses sends, and excludes them from the home picker', async () => {
    const user = userEvent.setup();
    const shared = { id: 'shared-id', name: 'planning', shared: true, path: '', capabilities: { canRun: false } };
    spies.fetchProjects.mockResolvedValue([general, shared]);
    window.history.replaceState(null, '', '/projects/shared-id');
    render(<App />);
    await screen.findByText('Selected project: planning');
    const healthCalls = spies.fetchHealth.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Attempt recipient send' }));
    await screen.findByText('Only the owner can run tasks in this shared project.');
    expect(spies.fetchHealth.mock.calls.length).toBe(healthCalls);
    await user.click(screen.getByRole('button', { name: /New task/ }));
    await screen.findByText(`Runnable: ${general.id}`);
    expect(screen.queryByText('Runnable: shared-id')).not.toBeInTheDocument();
  });

  it("lands on the grid with no selection for a project link the caller can't open", async () => {
    window.history.replaceState(null, '', '/projects/not-mine');
    render(<App />);

    await settle();

    await waitFor(() => expect(window.location.pathname).toBe('/projects'));
    expect(screen.getByText('Selected project: none')).toBeInTheDocument();
  });

  it('stays on /projects for a bare /projects load', async () => {
    window.history.replaceState(null, '', '/projects');
    render(<App />);

    await settle();

    expect(window.location.pathname).toBe('/projects');
    expect(screen.getByText('Selected project: none')).toBeInTheDocument();
  });

  it('selects general once the person goes Home', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/projects/not-mine');
    render(<App />);
    await settle();
    await waitFor(() => expect(window.location.pathname).toBe('/projects'));

    await user.click(screen.getByRole('button', { name: /New task/ }));

    expect(await screen.findByText(`Home project: ${general.name}`)).toBeInTheDocument();
  });
});

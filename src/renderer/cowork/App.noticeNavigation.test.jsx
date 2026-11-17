import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';


const spies = vi.hoisted(() => ({
  openNotice: null,
  fetchProjects: vi.fn(),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  drivePickerProject: vi.fn(),
}));

// The real hook, with the project App hands it recorded.
vi.mock('./hooks/useGoogleDrivePicker', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useGoogleDrivePicker: (context, deps) => {
      spies.drivePickerProject(context.selectedProject);
      return actual.useGoogleDrivePicker(context, deps);
    },
  };
});

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

vi.mock('./hooks/useNotices', () => ({
  useNotices: ({ onOpen }) => { spies.openNotice = onOpen; return { available: false }; },
}));

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
  spies.drivePickerProject.mockClear();
});

describe('notice navigation', () => {
  it('opens the notified conversation even when it is absent from recents', async () => {
    window.history.replaceState(null, '', '/projects');
    render(<App />);
    await settle();
    act(() => spies.openNotice({ target: { scheduleId: 'schedule-1', runId: 'older-run', conversationId: 'older-conversation' } }));
    await waitFor(() => expect(window.location.pathname).toBe('/c/older-conversation'));
  });

  it('falls back to the schedule for a run that never created a conversation', async () => {
    window.history.replaceState(null, '', '/projects');
    render(<App />);
    await settle();
    act(() => spies.openNotice({ target: { scheduleId: 'schedule-1', runId: 'setup-failure', conversationId: null } }));
    await waitFor(() => expect(window.location.pathname).toBe('/scheduled/schedule-1'));
  });
});

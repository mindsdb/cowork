import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  deleteProject: vi.fn(),
  fetchProjects: vi.fn(),
  fetchSessions: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
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
  unpinTask: vi.fn(async () => ({})),
  deleteProject: (...args) => spies.deleteProject(...args),
}));

vi.mock('./views/ProjectsView', () => ({
  default: ({ projects, selectedProject, tasks, onDeleteProject, onSelectProject, onSelectTask }) => (
    <div>
      <span>Selected project: {selectedProject?.name || 'none'}</span>
      {(projects || []).map((project) => (
        <div key={project.id}>
          <span>Project: {project.name}</span>
          <button type="button" onClick={() => onSelectProject(project)}>
            Open project {project.name}
          </button>
          <button type="button" onClick={() => onDeleteProject(project)}>
            Request deletion for {project.name}
          </button>
        </div>
      ))}
      {(tasks || []).map((task) => (
        <div key={task.id}>
          <span>Task: {task.title}</span>
          <button type="button" onClick={() => onSelectTask(task.id)}>
            Open task {task.title}
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('./views/ChatView', () => ({
  default: ({ task }) => <div>Chat task: {task?.title || 'none'}</div>,
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
import {
  __resetDraftsForTests,
  getDraft,
  setDraft,
} from './lib/draftStore';

const project = {
  id: 'project-1',
  name: 'billing',
  path: '/projects/billing',
  capabilities: {
    canRename: true,
    canDelete: true,
    canEditInstructions: true,
  },
};
const task = {
  id: 'conv-a',
  title: 'Billing task',
  messages: [],
  status: 'idle',
  projectName: project.name,
  projectPath: project.path,
};
const otherProject = {
  ...project,
  id: 'project-2',
  name: 'research',
  path: '/projects/research',
};
const unrelatedProject = {
  ...project,
  id: 'project-3',
  name: 'operations',
  path: '/projects/operations',
};
const otherTask = {
  ...task,
  id: 'conv-b',
  title: 'Research task',
  projectName: otherProject.name,
  projectPath: otherProject.path,
};
const unrelatedTask = {
  ...task,
  id: 'conv-c',
  title: 'Operations task',
  projectName: unrelatedProject.name,
  projectPath: unrelatedProject.path,
};

beforeEach(() => {
  __resetDraftsForTests();
  spies.deleteProject.mockReset().mockRejectedValue(new Error('Only an organization admin or the project creator can delete this project'));
  spies.fetchProjects.mockReset().mockResolvedValue([
    { ...project },
    { ...otherProject },
    { ...unrelatedProject },
  ]);
  // Keep an unrelated conversation first so clearing a live activeTaskId would
  // visibly fall back to the wrong chat rather than accidentally looking OK.
  spies.fetchSessions.mockReset().mockResolvedValue([
    { ...unrelatedTask },
    { ...task },
    { ...otherTask },
  ]);
});

describe('project delete authorization failure', () => {
  it('keeps project, tasks, and drafts while reporting the server denial', async () => {
    const user = userEvent.setup();
    setDraft(`project:${project.id}`, 'unsent project prompt');
    setDraft(task.id, 'unsent task reply');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: `Request deletion for ${project.name}` }));
    await user.click(await screen.findByRole('button', { name: 'Delete project' }));

    await waitFor(() => expect(spies.deleteProject).toHaveBeenCalledWith(project));
    expect(screen.getByText(`Project: ${project.name}`)).toBeInTheDocument();
    expect(screen.getByText(`Task: ${task.title}`)).toBeInTheDocument();
    expect(getDraft(`project:${project.id}`)).toBe('unsent project prompt');
    expect(getDraft(task.id)).toBe('unsent task reply');
    expect(await screen.findByText(/Couldn't delete this project.*Nothing was removed/i)).toBeInTheDocument();
    expect(screen.getByText(/Only an organization admin or the project creator/i)).toBeInTheDocument();
  });

  it('does not clear a different project selected while delete is in flight', async () => {
    const user = userEvent.setup();
    let resolveDelete;
    spies.deleteProject.mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: `Open project ${project.name}` }));
    expect(screen.getByText(`Selected project: ${project.name}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Request deletion for ${project.name}` }));
    await user.click(await screen.findByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(spies.deleteProject).toHaveBeenCalledWith(project));

    await user.click(screen.getByRole('button', { name: `Open project ${otherProject.name}` }));
    expect(screen.getByText(`Selected project: ${otherProject.name}`)).toBeInTheDocument();
    spies.fetchProjects.mockResolvedValue([{ ...otherProject }, { ...unrelatedProject }]);
    spies.fetchSessions.mockResolvedValue([{ ...unrelatedTask }, { ...otherTask }]);

    await act(async () => resolveDelete({ status: 'deleted' }));

    await waitFor(() => {
      expect(screen.getByText(`Selected project: ${otherProject.name}`)).toBeInTheDocument();
      expect(screen.queryByText(`Project: ${project.name}`)).not.toBeInTheDocument();
    });
  });

  it('keeps a newly opened unrelated task and route when delete succeeds', async () => {
    const user = userEvent.setup();
    let resolveDelete;
    spies.deleteProject.mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    render(<App />);

    // Seed activeTaskId with a task that the project deletion will cascade.
    await user.click(await screen.findByRole('button', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: `Open task ${task.title}` }));
    expect(await screen.findByText(`Chat task: ${task.title}`)).toBeInTheDocument();

    // Return to Projects without clearing activeTaskId, launch the deletion,
    // then navigate to a safe task before the server responds.
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: `Request deletion for ${project.name}` }));
    await user.click(await screen.findByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(spies.deleteProject).toHaveBeenCalledWith(project));
    await user.click(screen.getByRole('button', { name: `Open task ${otherTask.title}` }));
    expect(await screen.findByText(`Chat task: ${otherTask.title}`)).toBeInTheDocument();

    spies.fetchProjects.mockResolvedValue([{ ...otherProject }, { ...unrelatedProject }]);
    spies.fetchSessions.mockResolvedValue([{ ...unrelatedTask }, { ...otherTask }]);
    await act(async () => resolveDelete({ status: 'deleted' }));

    await waitFor(() => {
      expect(screen.getByText(`Chat task: ${otherTask.title}`)).toBeInTheDocument();
      expect(screen.queryByText(`Chat task: ${unrelatedTask.title}`)).not.toBeInTheDocument();
    });
  });
});

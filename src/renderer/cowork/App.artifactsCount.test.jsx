// The sidebar's Live Artifacts count comes from App's artifact list. Every
// delete surface goes through deleteArtifactAndSync, so these tests delete
// through it directly instead of driving a particular view.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  deleteArtifact: vi.fn(),
  deleteProject: vi.fn(),
  fetchArtifacts: vi.fn(),
  fetchArtifactsStrict: vi.fn(),
  fetchProjects: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: (...args) => spies.fetchProjects(...args),
  fetchArtifacts: (...args) => spies.fetchArtifacts(...args),
  fetchArtifactsStrict: (...args) => spies.fetchArtifactsStrict(...args),
  deleteArtifact: (...args) => spies.deleteArtifact(...args),
  deleteProject: (...args) => spies.deleteProject(...args),
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
}));

vi.mock('./views/ProjectsView', () => ({
  default: ({ projects, onDeleteProject }) => (
    <div>
      {(projects || []).map((project) => (
        <button key={project.id} type="button" onClick={() => onDeleteProject(project)}>
          Request deletion for {project.name}
        </button>
      ))}
    </div>
  ),
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
import { __resetForTests, deleteArtifactAndSync } from './lib/artifactsStore';

const project = {
  id: 'project-1',
  name: 'billing',
  path: '/projects/billing',
  capabilities: { canRename: true, canDelete: true, canEditInstructions: true },
};

const card = (slug, projectId = 'project-2') => ({
  id: `${slug}-id`,
  slug,
  projectId,
  folder: `/projects/${projectId}/.anton/artifacts/${slug}`,
  path: `/projects/${projectId}/.anton/artifacts/${slug}/index.html`,
});

const alpha = card('alpha');
const beta = card('beta');
const gamma = card('gamma', project.id);

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function expectCount(count) {
  const nav = await screen.findByRole('button', { name: 'Live Artifacts' });
  await waitFor(() => expect(nav).toHaveTextContent(new RegExp(`Live Artifacts\\s*${count}$`)));
}

beforeEach(() => {
  __resetForTests();
  spies.fetchArtifacts.mockReset().mockResolvedValue([]);
  spies.fetchArtifactsStrict.mockReset().mockResolvedValue([alpha, beta, gamma]);
  spies.deleteArtifact.mockReset().mockResolvedValue({ status: 'deleted' });
  spies.deleteProject.mockReset().mockResolvedValue({ status: 'deleted' });
  spies.fetchProjects.mockReset().mockResolvedValue([{ ...project }]);
});

// List updates and the latest-wins loader are covered in lib/artifactList.test.js.
describe('Live Artifacts sidebar count', () => {
  it('drops a deleted server card at once and asks the server about a chat card', async () => {
    render(<App />);
    await expectCount(3);
    const reload = deferred();
    spies.fetchArtifactsStrict.mockReturnValue(reload.promise);

    await act(() => deleteArtifactAndSync(beta));
    await expectCount(2);

    // A chat card names the file the stream announced, not the server's path.
    await act(() => deleteArtifactAndSync({
      id: alpha.id,
      slug: alpha.slug,
      projectId: alpha.projectId,
      canonicalPath: `${alpha.folder}/static/index.html`,
    }));
    await act(async () => reload.resolve([gamma]));
    await expectCount(1);
  });

  it('drops a deleted project\'s artifacts', async () => {
    const user = userEvent.setup();
    render(<App />);
    await expectCount(3);
    spies.fetchArtifactsStrict.mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: `Request deletion for ${project.name}` }));
    spies.fetchProjects.mockResolvedValue([]);
    await user.click(await screen.findByRole('button', { name: 'Delete project' }));

    await waitFor(() => expect(spies.deleteProject).toHaveBeenCalledWith(project));
    await expectCount(2);
  });
});

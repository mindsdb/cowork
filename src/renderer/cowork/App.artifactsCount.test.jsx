// The sidebar's Live Artifacts count comes from App's artifact list. Every
// delete surface goes through deleteArtifactAndSync, so these tests delete
// through it directly instead of driving a particular view.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  setNavigator: vi.fn(),
  fetchSharedArtifactPreview: vi.fn(),
  deleteArtifact: vi.fn(),
  deleteProject: vi.fn(),
  fetchArtifacts: vi.fn(),
  fetchArtifactsStrict: vi.fn(),
  fetchProjects: vi.fn(),
}));

vi.mock('../lib/mobilePush', async (importOriginal) => ({
  ...(await importOriginal()),
  setMobilePushNavigator: (navigate) => spies.setNavigator(navigate),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSharedArtifactPreview: (...args) => spies.fetchSharedArtifactPreview(...args),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: (...args) => spies.fetchProjects(...args),
  fetchArtifacts: (...args) => spies.fetchArtifacts(...args),
  fetchArtifactsStrict: (...args) => spies.fetchArtifactsStrict(...args),
  deleteArtifact: (...args) => spies.deleteArtifact(...args),
  deleteProject: (...args) => spies.deleteProject(...args),
  fetchSettings: vi.fn(async () => ({ showCounters: true })),
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
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
      removeCodingTask: vi.fn(async () => ({})),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

vi.mock('./components/artifact/ArtifactViewer', async (importOriginal) => ({
  ...(await importOriginal()),
  ArtifactViewer: ({ open, artifact }) => open ? <div role="dialog">{artifact.title}</div> : null,
}));

import App from './App';
import { __resetForTests, deleteArtifactAndSync, noteArtifactRenamed } from './lib/artifactsStore';

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

  it('retitles a doc renamed in its editor in the library', async () => {
    const user = userEvent.setup();
    spies.fetchArtifactsStrict.mockResolvedValue([{ ...gamma, title: 'Plan', format: 'doc' }]);
    render(<App />);
    await expectCount(1);
    await user.click(screen.getByRole('button', { name: 'Live Artifacts' }));
    expect(await screen.findByText('Plan')).toBeInTheDocument();

    act(() => noteArtifactRenamed(gamma.id, 'Hiring plan'));
    expect(await screen.findByText('Hiring plan')).toBeInTheDocument();
    expect(screen.queryByText('Plan')).toBeNull();
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

describe('shared artifact navigation', () => {
  let previousUrl;
  let previousState;
  beforeEach(() => {
    previousUrl = location.href;
    previousState = window.history.state;
  });
  afterEach(() => window.history.replaceState(previousState, '', previousUrl));

  const project_id = '11111111-1111-4111-8111-111111111111';
  const artifact_id = '22222222222242228222222222222222';
  const sharePath = '/artifacts#' + new URLSearchParams({ shared: '', ref: project_id + '/' + artifact_id });

  it.each([
    ['a shared image', '.png'],
    ['an older artifact outside the latest 80', '.md'],
  ])('opens %s after a cold start without waiting for the listing', async (title, ext) => {
    window.history.replaceState(null, '', '/');
    spies.setNavigator.mockImplementationOnce((navigate) => { navigate(sharePath); });
    spies.fetchArtifactsStrict.mockReturnValue(new Promise(() => {}));
    spies.fetchSharedArtifactPreview.mockResolvedValue({
      ...alpha, title, ext, type: 'file', path: '/old/file' + ext, draftUrl: '/api/v1/artifacts/drafts/project/old/file' + ext,
    });
    render(<App />);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(spies.fetchSharedArtifactPreview).toHaveBeenCalledWith({ project_id, artifact_id }, expect.any(AbortSignal));
    expect((await import('../platform/host')).host.openExternal).not.toHaveBeenCalled();
  });

  it('keeps a revoked share in the app and reads by stable identity', async () => {
    spies.setNavigator.mockImplementationOnce((navigate) => navigate(sharePath));
    spies.fetchSharedArtifactPreview.mockRejectedValue(new Error('Not found'));
    render(<App />);
    expect(await screen.findByText('Could not open this artifact for review')).toBeInTheDocument();
    expect(spies.fetchSharedArtifactPreview).toHaveBeenCalledWith({ project_id, artifact_id }, expect.any(AbortSignal));
    expect((await import('../platform/host')).host.openExternal).not.toHaveBeenCalled();
  });

  it('treats an ordinary artifacts link as a collection visit', async () => {
    const { host } = await import('../platform/host');
    window.history.replaceState(null, '', sharePath);
    render(<App />);
    await expectCount(3);
    expect(host.openExternal).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

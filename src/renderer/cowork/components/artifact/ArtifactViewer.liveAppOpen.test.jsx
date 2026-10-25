/*
 * With live apps on, a full-stack app runs only at its own address: the
 * deployment refuses its in-Cowork preview, and the serve route's copy of its page has no
 * backend. So the viewer mounts no preview, names the address, and both open
 * controls open it; with live apps off it previews and opens as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const workspaceMock = vi.hoisted(() => ({
  supported: true,
  mode: 'preview',
  setMode: vi.fn(),
  source: null,
  currentRevision: null,
  revisions: [],
  capabilities: null,
  capabilitiesFromServer: false,
  commentsReady: true,
  status: 'ready',
  dirty: false,
  error: '',
  conflict: null,
  repair: null,
  save: vi.fn(),
  discard: vi.fn(),
  compareRevision: vi.fn(),
  refreshRepair: vi.fn(),
  addressWithAgent: vi.fn(),
  cancelRepair: vi.fn(),
}));

const api = vi.hoisted(() => ({
  mountArtifactPreview: vi.fn(),
  fetchMyLiveApps: vi.fn(),
}));
vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: api.mountArtifactPreview,
  fetchMyLiveApps: api.fetchMyLiveApps,
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(async () => undefined),
}));
vi.mock('../../lib/artifactsStore', () => ({
  deleteArtifactAndSync: vi.fn(async () => undefined),
}));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactDraftText: vi.fn(),
  loadArtifactDraftDocument: vi.fn(),
}));
const host = vi.hoisted(() => ({
  isElectron: false,
  isWeb: true,
  isLocalApiOrigin: () => false,
  getApiOrigin: () => 'http://cowork.localhost:8080',
  openExternal: vi.fn(async () => undefined),
  openPath: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({ host }));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({
    publishedUrl: '',
    accessMode: 'private',
    artifactKey: 'artifact/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    busy: false,
  }),
}));
vi.mock('./comments', () => ({
  useArtifactComments: () => ({
    threads: [], viewer: null, unreadCount: 0,
    create: vi.fn(), reply: vi.fn(), setStatus: vi.fn(),
    editThread: vi.fn(), deleteThread: vi.fn(), editReply: vi.fn(),
    deleteReply: vi.fn(), markRead: vi.fn(),
  }),
  useArtifactCommentLayer: () => ({ exitMode: vi.fn() }),
}));
vi.mock('./workspace/useArtifactWorkspace', () => ({
  useArtifactWorkspace: () => workspaceMock,
}));
// The header's open control beside the mode tabs. The ⋯ menu has no open
// entry: Download, Open and Show in folder are visible controls, and this
// arrow opens what "Open in browser" did.
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ actions }) => (
    <div>
      {actions.canOpenInBrowserTab && <button type="button" onClick={actions.onOpenInBrowserTab}>tab</button>}
    </div>
  ),
}));
vi.mock('./ArtifactViewerBody', () => ({
  ArtifactViewerBody: ({ preview }) => (
    <div>
      <div data-testid="body">{preview.liveApp ? preview.liveApp.notice?.text ?? 'loading' : 'preview'}</div>
      {preview.liveApp?.notice?.canLaunch && preview.liveApp.onLaunch && (
        <button type="button" onClick={preview.liveApp.onLaunch}>launch</button>
      )}
    </div>
  ),
}));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';
import { setLiveApps } from '../../../lib/liveApps';
import { liveAppKey, liveAppStatesFrom } from '../../lib/liveAppState';

const SERVE_URL = '/api/v1/artifacts/serve/general/server-time-a440c451/static/index.html';
const ADDRESS = 'http://app3.view.localhost:8080/';
const app = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Server time and visit counter',
  type: 'fullstack-stateless-app',
  ext: '.html',
  projectId: 'p1',
  slug: 'server-time-a440c451',
  serveUrl: SERVE_URL,
  path: '/artifacts/server-time-a440c451/static/index.html',
  canonicalPath: '/artifacts/server-time-a440c451/static/index.html',
  capabilities: { role: 'owner', canEdit: true },
};
const launch = { projectId: 'p1', slug: app.slug, state: 'running', address: ADDRESS };

async function openViewer(artifact = app) {
  render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
  await act(async () => {});
}

describe("the viewer's preview and open controls on a live app", () => {
  beforeEach(() => {
    api.mountArtifactPreview.mockReset().mockResolvedValue({ kind: 'static', url: 'http://cowork.localhost:8080/preview' });
    api.fetchMyLiveApps.mockReset().mockResolvedValue(liveAppStatesFrom([launch]));
    host.openExternal.mockClear();
  });
  afterEach(() => setLiveApps(false));

  it('names a running app instead of asking for the preview, and the open control opens its address', async () => {
    setLiveApps(true);
    await openViewer();
    expect(api.mountArtifactPreview).not.toHaveBeenCalled();
    expect(screen.getByTestId('body').textContent).toBe('This live app runs at its own address.');
    fireEvent.click(screen.getByText('tab'));
    expect(host.openExternal.mock.calls).toEqual([[ADDRESS]]);
  });

  it('offers nothing to open while the app is stopped, and never the serve route\'s copy', async () => {
    setLiveApps(true);
    api.fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([{ ...launch, state: 'stopped', stoppedAt: '', stopReasonText: '' }]));
    await openViewer();
    expect(screen.getByTestId('body').textContent).toBe('Stopped. Ask your agent to relaunch it.');
    expect(screen.queryByText('tab')).toBe(null);
  });

  it('offers Launch on a stopped app, which asks the agent and closes the viewer', async () => {
    setLiveApps(true);
    api.fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([{ ...launch, state: 'stopped', stoppedAt: '', stopReasonText: '' }]));
    const onAddressWithAgent = vi.fn(async () => true);
    const onClose = vi.fn();
    render(<ArtifactViewer open artifact={app} onClose={onClose} onAddressWithAgent={onAddressWithAgent} />);
    await act(async () => {});

    await act(async () => { fireEvent.click(screen.getByText('launch')); });

    expect(onAddressWithAgent).toHaveBeenCalledWith({
      artifact: app, prompt: 'Launch the live app `server-time-a440c451`.', conversationId: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no Launch while the app runs, or with no agent to ask', async () => {
    setLiveApps(true);
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} onAddressWithAgent={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByText('launch')).toBe(null);

    api.fetchMyLiveApps.mockResolvedValue(liveAppStatesFrom([{ ...launch, state: 'stopped', stoppedAt: '', stopReasonText: '' }]));
    await openViewer();
    expect(screen.queryByText('launch')).toBe(null);
  });

  it('matches the app by its project as well as its slug', async () => {
    setLiveApps(true);
    api.fetchMyLiveApps.mockResolvedValue(new Map([[liveAppKey('p2', app.slug), { ...launch, projectId: 'p2' }]]));
    await openViewer();
    expect(screen.getByTestId('body').textContent).toBe("This live app isn't running. Ask your agent to launch it.");
  });

  it('previews and opens the served page as before with live apps off', async () => {
    await openViewer();
    expect(api.mountArtifactPreview).toHaveBeenCalledTimes(1);
    expect(api.fetchMyLiveApps).not.toHaveBeenCalled();
    expect(screen.getByTestId('body').textContent).toBe('preview');
    fireEvent.click(screen.getByText('tab'));
    expect(host.openExternal).toHaveBeenCalledWith(`http://cowork.localhost:8080${SERVE_URL}`);
  });
});

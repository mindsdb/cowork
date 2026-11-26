import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { getOrgMode, setOrgMode } from '../../../lib/orgMode';

const workspaceMock = vi.hoisted(() => ({
  supported: false,
  mode: 'preview',
  setMode: vi.fn(),
  source: null,
  currentRevision: null,
  revisions: [],
  capabilities: { role: 'owner', canEdit: true },
  commentsReady: false,
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

const loadArtifactDraftDocument = vi.hoisted(() => vi.fn());
const loadArtifactDraftText = vi.hoisted(() => vi.fn());
const createDraftLink = vi.hoisted(() => vi.fn());
const headerProps = vi.hoisted(() => ({ current: null }));
const fetchAuthenticatedBlob = vi.hoisted(() => vi.fn());
const fetchAuthenticatedResponse = vi.hoisted(() => vi.fn());

vi.mock('../../lib/authenticatedResource', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAuthenticatedBlob,
  fetchAuthenticatedResponse,
}));

vi.mock('../../api', () => ({
  fetchPublishStats: vi.fn(),
  setPublishTracking: vi.fn(),
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  artifactServeUrl: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
// The real artifactRef: a card without a full identity must stay on srcdoc.
vi.mock('../../lib/artifactWorkspaceApi', async (importOriginal) => ({
  artifactRef: (await importOriginal()).artifactRef,
  loadArtifactStats: vi.fn(),
  setArtifactTracking: vi.fn(),
  loadArtifactDraftText,
  loadArtifactDraftDocument,
  createDraftLink,
}));
const checkConfigured = vi.hoisted(() => vi.fn());
const getAccessToken = vi.hoisted(() => vi.fn(async () => 'kc-token'));
const viewSessionFrameUrl = vi.hoisted(() => vi.fn(async (url) => url));
vi.mock('../../../lib/viewSession', () => ({ viewSessionFrameUrl }));
vi.mock('../../../platform/host', async (importOriginal) => ({
  getAccessToken,
  host: {
    isElectron: false,
    isWeb: true,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'https://cowork.example',
    openExternal: vi.fn(),
    openPath: vi.fn(),
    openPendingTab: (await importOriginal()).openPendingTab,
    checkConfigured,
  },
}));
const published = vi.hoisted(() => ({ url: '', accessMode: 'public' }));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({
    publishedUrl: published.url,
    accessMode: published.accessMode,
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
  useArtifactCommentLayer: () => ({
    mode: false, anchorStates: {}, onIframeLoad: vi.fn(), exitMode: vi.fn(),
    toggleMode: vi.fn(), focus: vi.fn(), hlOn: vi.fn(), hlOff: vi.fn(),
  }),
  CommentsPanel: () => null,
  CommentsToolbar: () => null,
}));
vi.mock('./workspace/useArtifactWorkspace', () => ({
  useArtifactWorkspace: () => workspaceMock,
}));
vi.mock('./workspace/ArtifactSourceEditor', () => ({ ArtifactSourceEditor: () => null }));
vi.mock('./workspace/ArtifactComparison', () => ({ ArtifactComparison: () => null }));
vi.mock('./workspace/TextSelectionComment', () => ({ TextSelectionComment: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
// Captured, not rendered: the reload test drives the header's own handler.
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: (props) => {
    headerProps.current = props;
    return null;
  },
}));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';
import { publishedAppUrl } from './htmlPreviewSource';
import { mountArtifactPreview } from '../../api';

// A full-stack app on an org deployment (ENG-4687): the server can't start its
// backend (preview-mount is desktop-only), so the preview frames the app at its
// published address, where it already runs.
const app = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Team Shared Todo',
  type: 'fullstack-stateful-app',
  ext: '.html',
  path: '/artifacts/team-shared-todo/static/index.html',
  canonicalPath: '/artifacts/team-shared-todo/static/index.html',
  draftUrl: '/api/v1/artifacts/drafts/proj-1/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/static/index.html',
  capabilities: { role: 'owner', canEdit: true },
};
const LIVE = 'https://view-pr-cowork-1.dev.mindshub.test/view/8620653c9/b527cf6e';

let previous;
beforeEach(() => {
  previous = getOrgMode();
  setOrgMode(true);
  published.url = '';
  published.accessMode = 'public';
  vi.mocked(mountArtifactPreview).mockReset();
  viewSessionFrameUrl.mockClear();
});
afterEach(() => {
  setOrgMode(previous);
  cleanup();
});

describe('ArtifactViewer: a full-stack app on an org deployment', () => {
  it('frames the app at its published address, never the desktop-only preview mount', async () => {
    published.url = LIVE;
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Team Shared Todo');
    expect(frame.getAttribute('src')).toMatch(new RegExp(`^${LIVE.replace(/[.?]/g, '\\$&')}\\?v=`));
    expect(mountArtifactPreview).not.toHaveBeenCalled();
  });

  it("keeps the app's own origin in the frame, as a local proxy preview does", async () => {
    published.url = LIVE;
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    const sandbox = (await screen.findByTitle('Team Shared Todo')).getAttribute('sandbox');
    expect(sandbox.split(' ')).toEqual(expect.arrayContaining(['allow-scripts', 'allow-same-origin']));
  });

  it('opens a restricted app signed in, through the view host session bootstrap', async () => {
    published.url = LIVE;
    published.accessMode = 'restricted';
    viewSessionFrameUrl.mockResolvedValue('https://view-pr-cowork-1.dev.mindshub.test/_session?ticket=t&return=%2Fview');
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Team Shared Todo');
    await waitFor(() => expect(frame.getAttribute('src')).toContain('/_session?ticket=t'));
    expect(viewSessionFrameUrl).toHaveBeenCalledWith(expect.stringContaining(LIVE), getAccessToken);
  });

  it('frames a public app as it is, without asking for a session', async () => {
    published.url = LIVE;
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    await screen.findByTitle('Team Shared Todo');
    expect(viewSessionFrameUrl).not.toHaveBeenCalled();
  });

  it("uses the card's address before the publish state has loaded", async () => {
    render(<ArtifactViewer open artifact={{ ...app, publishedUrl: LIVE }} onClose={vi.fn()} />);

    expect((await screen.findByTitle('Team Shared Todo')).getAttribute('src')).toContain(LIVE);
  });

  it('says it shows once published instead of erroring, when it has no address yet', async () => {
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    expect(await screen.findByText(/This app shows here once it's published/)).toBeInTheDocument();
    expect(screen.queryByTitle('Team Shared Todo')).toBeNull();
    expect(mountArtifactPreview).not.toHaveBeenCalled();
  });

  it('frames nothing but an https page', async () => {
    published.url = 'javascript:alert(1)';
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    expect(await screen.findByText(/This app shows here once it's published/)).toBeInTheDocument();
    expect(screen.queryByTitle('Team Shared Todo')).toBeNull();
  });
});

describe('publishedAppUrl', () => {
  it.each([
    [LIVE, LIVE],
    ['http://view.example/x', ''],
    ['javascript:alert(1)', ''],
    ['data:text/html,hi', ''],
    ['', ''],
    [undefined, ''],
  ])('%s → %s', (value, expected) => {
    expect(publishedAppUrl(value)).toBe(expected);
  });
});

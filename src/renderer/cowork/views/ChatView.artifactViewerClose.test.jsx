// Closing the inline artifact viewer has to keep it closed.
//
// The viewer's publish hook re-reads the artifact's access list over the
// network when the viewer opens, and again on every window focus while it is
// open. In org mode that read reports back to the parent unconditionally
// (publish/usePublish.js), so a response that lands after the user closed the
// modal still arrives. ChatView fed it straight into the state the modal's
// `open` prop reads, so the artifact the user had just dismissed came back and
// only a second close stuck.
//
// This drives the real viewer, the real publish hook and the real Modal,
// because the bug lives in the seam between them and the parent. The mocks
// below only keep jsdom off the network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const loadArtifactAccess = vi.hoisted(() => vi.fn());
const viewer = vi.hoisted(() => ({ props: null }));
const loadArtifactDraftText = vi.hoisted(() => vi.fn(async () => ({ content: '', truncated: false })));
const loadArtifactDraftDocument = vi.hoisted(() => vi.fn(async () => ({ content: '' })));

vi.mock('../lib/artifactsStore', () => ({
  useArtifactLiveness: () => false,
  setArtifactsScope: vi.fn(),
  revalidate: vi.fn(async () => {}),
  deleteArtifactAndSync: vi.fn(),
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: true,
    isMac: () => false,
    getPlatform: () => 'linux',
    getApiOrigin: () => 'https://cowork.example',
    isLocalApiOrigin: () => false,
    openPath: vi.fn(),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

vi.mock('../lib/artifactDownload', () => ({
  downloadArtifactFile: vi.fn(async () => true),
}));

// Partial: usePublish reads `canUseArtifactWorkspace` from here and the answer
// has to stay real, or the refresh this test is about never runs.
vi.mock('../lib/artifactWorkspaceApi', async (importOriginal) => ({
  ...(await importOriginal()),
  loadArtifactAccess,
  loadArtifactDraftText,
  loadArtifactDraftDocument,
}));

// Partial for the same reason the card test uses one: this module has many
// more exports than the viewer touches. Only the ones that would open a socket
// on mount are replaced.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(async () => ({ url: '' })),
  previewArtifact: vi.fn(async () => ({ content: '' })),
  artifactServeUrl: vi.fn(() => ''),
  fetchArtifactStatus: vi.fn(async () => null),
  unpublishArtifact: vi.fn(),
  listArtifactVersions: vi.fn(async () => ({ versions: [] })),
}));

vi.mock('../components/artifact/comments', () => ({
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

vi.mock('../components/artifact/workspace/useArtifactWorkspace', () => ({
  useArtifactWorkspace: () => ({
    supported: false, mode: 'preview', setMode: vi.fn(),
    source: null, currentRevision: null, revisions: [],
    capabilities: { role: 'owner', canEdit: true },
    commentsReady: false, status: 'ready', dirty: false,
    error: '', conflict: null, repair: null,
    save: vi.fn(), discard: vi.fn(), compareRevision: vi.fn(),
    refreshRepair: vi.fn(), addressWithAgent: vi.fn(), cancelRepair: vi.fn(),
  }),
}));

// The artifact's content and chrome are not what this test is about, and
// rendering them drags in the iframe, the markdown pipeline and the publish menu.
vi.mock('../components/artifact/ArtifactViewerBody', () => ({
  ArtifactViewerBody: () => null,
}));
vi.mock('../components/artifact/ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: () => null,
}));

// Wraps, never replaces: the real viewer renders and the real publish hook
// runs. This only records what ChatView handed down, which is the thing under
// test and is not otherwise observable through the viewer's own chrome.
vi.mock('../components/artifact', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ArtifactViewer: (props) => {
      viewer.props = props;
      return <actual.ArtifactViewer {...props} />;
    },
  };
});

import ChatView from './ChatView';
import { setOrgMode } from '../../lib/orgMode';

const ARTIFACT_ID = '11111111111141118111111111111111';
const OTHER_ID = '22222222222242228222222222222222';

const artifactStep = (overrides = {}) => ({
  id: `artifact-${overrides.slug || 'clock'}`,
  label: 'Current time',
  badge: 'Artifact',
  icon: 'sparkle',
  status: 'completed',
  data: {
    title: 'Current time',
    file_path: '/proj/.anton/artifacts/clock/index.html',
    path: '/proj/.anton/artifacts/clock/index.html',
    ext: '.html',
    action: 'html-app',
    id: ARTIFACT_ID,
    slug: 'clock',
    draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/index.html`,
    capabilities: { role: 'owner', canEdit: true, canComment: true },
    publishedUrl: '',
    projectId: 'proj-1',
    projectName: 'general',
    ...overrides,
  },
});

const taskWith = (...steps) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages: [
    { role: 'user', content: 'build me a clock' },
    { role: 'assistant', content: 'Done.', steps },
  ],
});

// One deferred per read the viewer fires, so a test can land them out of order.
// A single shared promise fixes the resolution order to the order the reads
// started, which is exactly what the swap case below has to be able to break.
const pendingReads = [];
const captureReads = () => {
  pendingReads.length = 0;
  loadArtifactAccess.mockImplementation(() => new Promise((resolve) => {
    pendingReads.push(resolve);
  }));
};
const land = (index, payload) => act(async () => { pendingReads[index](payload); });

const ACCESS = {
  accessMode: 'restricted',
  accessEmails: ['someone@example.com'],
  orgAllowed: false,
  ownerOnly: false,
};

beforeEach(() => {
  loadArtifactAccess.mockReset();
  viewer.props = null;
  captureReads();
  setOrgMode(true);
});
afterEach(() => setOrgMode(false));

describe('inline artifact viewer, closing', () => {
  it('stays closed when the access read lands after the user closed it', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith(artifactStep())} />);

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // The reproduction is only meaningful if the read actually went out while
    // the viewer was open. Without this the test could pass on a mock that
    // swallowed it, and "no re-open" would prove nothing.
    await waitFor(() => expect(loadArtifactAccess).toHaveBeenCalled());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await land(0, ACCESS);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('applies the access read that lands while the viewer is still open', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith(artifactStep())} />);

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(loadArtifactAccess).toHaveBeenCalled());

    await land(0, ACCESS);

    // The fields the server just answered with have to reach the artifact the
    // viewer holds. usePublish re-seeds its own state from this prop, so a
    // parent that drops the update makes the hook clobber the list it loaded.
    expect(viewer.props.artifact).toMatchObject({
      accessMode: 'restricted',
      accessEmails: ['someone@example.com'],
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not swap the open artifact for one whose read lands late', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith(
      artifactStep(),
      artifactStep({ id: OTHER_ID, slug: 'report', title: 'Weekly report' }),
    )} />);

    const [first, second] = screen.getAllByRole('button', { name: 'Preview' });
    await user.click(first);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(loadArtifactAccess).toHaveBeenCalledTimes(1));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(second);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(loadArtifactAccess).toHaveBeenCalledTimes(2));

    // The open artifact's read lands first and the dismissed one's last, so the
    // stale write is the final one. Only the identity comparison can keep the
    // artifact the user is actually looking at on screen.
    await land(1, ACCESS);
    await land(0, ACCESS);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(viewer.props.artifact.title).toBe('Weekly report');
  });
});

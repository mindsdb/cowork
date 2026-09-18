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

// The artifact's content is not what this test is about, and rendering it
// drags in the iframe and the markdown pipeline.
vi.mock('../components/artifact/ArtifactViewerBody', () => ({
  ArtifactViewerBody: () => <div data-testid="viewer-body" />,
}));
// Kept only as a probe for which artifact the viewer is holding: the title it
// renders is the one the real viewer resolved from its `artifact` prop.
vi.mock('../components/artifact/ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ title }) => <div data-testid="viewer-title">{title}</div>,
}));

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

// The access read the viewer fires on open, held open so the test decides when
// it lands. This is the whole point: the response has to arrive after the close.
const deferredAccess = () => {
  let settle;
  const pending = new Promise((resolve) => { settle = resolve; });
  loadArtifactAccess.mockReturnValue(pending);
  return (payload) => act(async () => { settle(payload); });
};

const ACCESS = {
  accessMode: 'restricted',
  accessEmails: ['someone@example.com'],
  orgAllowed: false,
  ownerOnly: false,
};

beforeEach(() => {
  loadArtifactAccess.mockReset();
  setOrgMode(true);
});
afterEach(() => setOrgMode(false));

describe('inline artifact viewer, closing', () => {
  it('stays closed when the access read lands after the user closed it', async () => {
    const land = deferredAccess();
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

    await land(ACCESS);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('applies the access read that lands while the viewer is still open', async () => {
    const land = deferredAccess();
    const user = userEvent.setup();
    render(<ChatView task={taskWith(artifactStep())} />);

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(loadArtifactAccess).toHaveBeenCalled());

    await land(ACCESS);

    // A guard that drops every late change would pass the test above just as
    // well, so the open viewer has to keep receiving them.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-body')).toBeInTheDocument();
  });

  it('does not swap the open artifact for one whose read lands late', async () => {
    const land = deferredAccess();
    const user = userEvent.setup();
    render(<ChatView task={taskWith(
      artifactStep(),
      artifactStep({ id: OTHER_ID, slug: 'report', title: 'Weekly report' }),
    )} />);

    const [first, second] = screen.getAllByRole('button', { name: 'Preview' });
    await user.click(first);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(loadArtifactAccess).toHaveBeenCalled());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(second);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await land(ACCESS);

    const open = screen.getByRole('dialog');
    expect(within(open).getByTestId('viewer-title')).toHaveTextContent('Weekly report');
  });
});

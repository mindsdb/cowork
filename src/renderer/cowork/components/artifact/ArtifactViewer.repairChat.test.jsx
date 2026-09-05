/**
 * Resolve the conversation before creating a repair and pass the same id to server and host, or the
 * handoff never completes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const NEW_CHAT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGIN_CHAT = '3f6a1c8e-6b1d-4a2f-9a1e-2c7d5b0e4a11';
const HOST_CHAT = '9c2b7d10-4e5f-4a11-8b22-6d3e1f0a7c55';

const workspaceMock = vi.hoisted(() => ({
  supported: true,
  mode: 'preview',
  setMode: vi.fn(),
  source: null,
  currentRevision: null,
  revisions: [],
  capabilities: { role: 'owner', canEdit: true },
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

vi.mock('../../api', () => ({
  allocateConversationId: () => NEW_CHAT,
  mountArtifactPreview: vi.fn(async () => ({ kind: 'static', url: '/preview' })),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(async () => undefined),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactDraftText: vi.fn(),
  loadArtifactDraftDocument: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: false,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'http://localhost',
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({
    publishedUrl: '',
    accessMode: 'public',
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
vi.mock('./ArtifactViewerHeader', () => ({ ArtifactViewerHeader: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));
// Stands in for the comment inbox: one button that addresses a thread.
vi.mock('./ArtifactViewerBody', () => ({
  ArtifactViewerBody: ({ review }) => (
    <button onClick={() => review.onAddressWithAgent({ id: 'thread-1', replies: [] })}>
      Address with agent
    </button>
  ),
}));

import { ArtifactViewer } from './ArtifactViewer';

const artifact = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Launch brief',
  type: 'document',
  ext: '.html',
  path: '/artifacts/launch/index.html',
  canonicalPath: '/artifacts/launch/index.html',
  originConversationId: ORIGIN_CHAT,
  capabilities: { role: 'owner', canEdit: true },
};

function addressWithAgent(props) {
  const onAddressWithAgent = vi.fn(async () => true);
  render(
    <ArtifactViewer
      open
      artifact={artifact}
      onClose={vi.fn()}
      onAddressWithAgent={onAddressWithAgent}
      {...props}
    />,
  );
  fireEvent.click(screen.getByText('Address with agent'));
  return onAddressWithAgent;
}

describe('the chat an artifact repair is addressed to', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceMock.addressWithAgent.mockImplementation(async ({ conversationId }) => ({
      prompt: 'Fix the heading',
      repair: { id: 'repair-1', conversationId },
    }));
  });

  it('resumes the chat the host resolves, in the repair record and the send', async () => {
    const resolveRepairConversation = vi.fn(async () => ORIGIN_CHAT);
    const onAddressWithAgent = addressWithAgent({ resolveRepairConversation });

    await waitFor(() => expect(onAddressWithAgent).toHaveBeenCalled());
    expect(resolveRepairConversation).toHaveBeenCalledWith(artifact);
    expect(workspaceMock.addressWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: ORIGIN_CHAT }),
    );
    expect(onAddressWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: ORIGIN_CHAT }),
    );
  });

  it('mints a new chat when the host cannot reach the origin chat', async () => {
    const onAddressWithAgent = addressWithAgent({
      resolveRepairConversation: vi.fn(async () => ''),
    });

    await waitFor(() => expect(onAddressWithAgent).toHaveBeenCalled());
    expect(workspaceMock.addressWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: NEW_CHAT }),
    );
    expect(onAddressWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: NEW_CHAT }),
    );
  });

  it('keeps a repair inside the chat hosting the viewer, without resolving', async () => {
    const resolveRepairConversation = vi.fn(async () => ORIGIN_CHAT);
    const onAddressWithAgent = addressWithAgent({
      conversationId: HOST_CHAT,
      resolveRepairConversation,
    });

    await waitFor(() => expect(onAddressWithAgent).toHaveBeenCalled());
    expect(resolveRepairConversation).not.toHaveBeenCalled();
    expect(workspaceMock.addressWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: HOST_CHAT }),
    );
  });

  it('mints a new chat when the host offers no resolver at all', async () => {
    const onAddressWithAgent = addressWithAgent({});

    await waitFor(() => expect(onAddressWithAgent).toHaveBeenCalled());
    expect(workspaceMock.addressWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: NEW_CHAT }),
    );
  });

  it('settles the target before the repair exists', async () => {
    const order = [];
    const resolveRepairConversation = vi.fn(async () => { order.push('resolve'); return ORIGIN_CHAT; });
    workspaceMock.addressWithAgent.mockImplementation(async ({ conversationId }) => {
      order.push('mint');
      return { prompt: 'Fix the heading', repair: { id: 'repair-1', conversationId } };
    });

    const onAddressWithAgent = addressWithAgent({ resolveRepairConversation });

    await waitFor(() => expect(onAddressWithAgent).toHaveBeenCalled());
    expect(order).toEqual(['resolve', 'mint']);
  });

  it('cancels the repair when the host refuses to start the turn', async () => {
    const onAddressWithAgent = vi.fn(async () => false);
    render(
      <ArtifactViewer
        open
        artifact={artifact}
        onClose={vi.fn()}
        onAddressWithAgent={onAddressWithAgent}
        resolveRepairConversation={vi.fn(async () => ORIGIN_CHAT)}
      />,
    );
    fireEvent.click(screen.getByText('Address with agent'));

    await waitFor(() => expect(workspaceMock.cancelRepair).toHaveBeenCalledWith('repair-1'));
  });
});

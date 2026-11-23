// The viewer rail's Open chat, as the library and the Live
// artifacts rail open the viewer: it closes the viewer and opens the chat the
// artifact was made in, and is absent inside that chat.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const workspaceMock = vi.hoisted(() => ({ dirty: false }));
const layerMock = vi.hoisted(() => ({ exitMode: vi.fn() }));

vi.mock('../../api', () => ({
  fetchPublishStats: vi.fn(),
  setPublishTracking: vi.fn(),
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(async () => ({ kind: 'static', url: 'http://localhost/preview' })),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn() }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactStats: vi.fn(),
  setArtifactTracking: vi.fn(),
  loadArtifactDraftText: vi.fn(),
  loadArtifactDraftDocument: vi.fn(),
}));
vi.mock('../../lib/analytics', () => ({ trackArtifactStatsOpened: vi.fn() }));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: true,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'http://localhost',
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({
    publishedUrl: '',
    accessMode: 'restricted',
    accessLoaded: true,
    artifactKey: 'artifact/cccccccc-cccc-cccc-cccc-cccccccccccc',
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
  // Stable, like the real hook's callback: the review/edit effect depends on it.
  useArtifactCommentLayer: () => layerMock,
}));
vi.mock('./workspace/useArtifactWorkspace', () => ({
  useArtifactWorkspace: () => ({
    supported: false, mode: 'preview', setMode: vi.fn(), revisions: [],
    capabilities: null, commentsReady: true, status: 'idle', repair: null, dirty: workspaceMock.dirty,
    refreshRepair: vi.fn(), releaseRepairsForComment: vi.fn(),
  }),
}));
vi.mock('./stats/useArtifactStats', () => ({ useArtifactStats: () => ({ data: null, loading: false, error: null }) }));
vi.mock('./ArtifactViewerHeader', () => ({ ArtifactViewerHeader: () => null }));
vi.mock('./ArtifactViewerBody', () => ({ ArtifactViewerBody: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({
  Modal: ({ open, children }) => (open ? <div>{children}</div> : null),
}));
// The unsaved-edits prompt as two buttons: leave (confirm) or keep editing.
vi.mock('../ConfirmModal', () => ({
  ConfirmModal: ({ open, onConfirm, onClose, confirmLabel }) => (open && confirmLabel ? (
    <div role="dialog" aria-label="Close prompt">
      <button type="button" onClick={onConfirm}>Leave</button>
      <button type="button" onClick={onClose}>Keep editing</button>
    </div>
  ) : null),
}));

import { ArtifactViewer } from './ArtifactViewer';
import { OriginChatContext } from '../../lib/originChat';

const ORIGIN = '3f6a1c8e-6b1d-4a2f-9a1e-2c7d5b0e4a11';
const CARD = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  title: 'C',
  type: 'document',
  ext: '.html',
  path: '/artifacts/c/index.html',
  originConversationId: ORIGIN,
};

function renderViewer({ status = 'ok', conversationId = null } = {}) {
  const chats = { open: vi.fn(), check: vi.fn().mockResolvedValue(status) };
  const onClose = vi.fn();
  render(
    <OriginChatContext.Provider value={chats}>
      <ArtifactViewer open artifact={CARD} conversationId={conversationId} onClose={onClose} onChange={vi.fn()} />
    </OriginChatContext.Provider>,
  );
  return { chats, onClose };
}
const rail = () => screen.getByRole('toolbar', { name: 'Viewer panels' });
const openChat = () => within(rail()).getByRole('button', { name: 'Open chat' });

beforeEach(() => {
  workspaceMock.dirty = false;
  window.localStorage.clear();
});

describe('ArtifactViewer Open chat', () => {
  it('closes the viewer and opens the chat the artifact was made in', async () => {
    const { chats, onClose } = renderViewer();
    await waitFor(() => expect(openChat()).not.toHaveAttribute('aria-disabled'));
    expect(chats.check).toHaveBeenCalledWith(ORIGIN);

    fireEvent.click(openChat());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(chats.open).toHaveBeenCalledWith(ORIGIN);
  });

  it('is absent inside the chat the artifact was made in', async () => {
    const { chats } = renderViewer({ conversationId: ORIGIN });
    await act(async () => {});
    expect(within(rail()).queryByRole('button', { name: 'Open chat' })).toBeNull();
    expect(chats.check).not.toHaveBeenCalled();
  });

  it('opens a chat other than the one on screen', async () => {
    const { chats, onClose } = renderViewer({ conversationId: 'another-chat' });
    await waitFor(() => expect(openChat()).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(openChat());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(chats.open).toHaveBeenCalledWith(ORIGIN);
  });

  it('asks before dropping unsaved edits, and opens the chat only once the person leaves', async () => {
    workspaceMock.dirty = true;
    const { chats, onClose } = renderViewer();
    await waitFor(() => expect(openChat()).not.toHaveAttribute('aria-disabled'));

    fireEvent.click(openChat());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(chats.open).not.toHaveBeenCalled();

    fireEvent.click(openChat());
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(chats.open).toHaveBeenCalledWith(ORIGIN);
  });
});

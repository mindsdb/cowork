import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(async () => ({ kind: 'static', url: '/preview' })),
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
    publishedUrl: 'https://view.example/artifact',
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
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ actions }) => <button onClick={actions.onTrash}>Open delete</button>,
}));
vi.mock('./ArtifactViewerBody', () => ({ ArtifactViewerBody: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({
  ConfirmModal: ({ open, onConfirm }) => (open ? <button onClick={onConfirm}>Confirm delete</button> : null),
}));

import { ArtifactViewer } from './ArtifactViewer';
import { mountArtifactPreview, unpublishArtifact } from '../../api';
import { deleteArtifactAndSync } from '../../lib/artifactsStore';
import { setOrgMode } from '../../../lib/orgMode';

const artifact = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Launch brief',
  type: 'document',
  ext: '.html',
  path: '/artifacts/launch/index.html',
  canonicalPath: '/artifacts/launch/index.html',
  capabilities: { role: 'owner', canEdit: true },
};

async function deleteFromViewer() {
  render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Open delete'));
  fireEvent.click(screen.getByText('Confirm delete'));
  await waitFor(() => expect(deleteArtifactAndSync).toHaveBeenCalledWith(artifact));
}

describe('published artifact deletion from the viewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceMock.commentsReady = true;
    workspaceMock.currentRevision = null;
  });

  afterEach(() => {
    setOrgMode(false);
  });

  it('leaves unpublish to the scoped server operation in Cowork SaaS', async () => {
    setOrgMode(true);
    await deleteFromViewer();
    expect(unpublishArtifact).not.toHaveBeenCalled();
  });

  it('unpublishes before path-addressed deletion on Desktop', async () => {
    setOrgMode(false);
    await deleteFromViewer();
    expect(unpublishArtifact).toHaveBeenCalledWith(artifact.path);
  });

  it('does not remount an HTML preview when collaboration state finishes loading', async () => {
    workspaceMock.commentsReady = false;
    const { rerender } = render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
    await waitFor(() => expect(mountArtifactPreview).toHaveBeenCalledTimes(1));

    workspaceMock.commentsReady = true;
    workspaceMock.currentRevision = { id: 'rev-1', number: 1 };
    rerender(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    await waitFor(() => expect(mountArtifactPreview).toHaveBeenCalledTimes(1));
  });

  it('keeps a stable hook sequence when the viewer opens', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ArtifactViewer open={false} artifact={artifact} onClose={onClose} />,
    );

    expect(() => rerender(
      <ArtifactViewer open artifact={artifact} onClose={onClose} />,
    )).not.toThrow();

    await waitFor(() => expect(mountArtifactPreview).toHaveBeenCalledTimes(1));
  });
});

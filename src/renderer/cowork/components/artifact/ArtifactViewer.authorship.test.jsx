// ENG-2979: the viewer derives the tag from the workspace's capabilities once
// they load, and from the card's until then, the same precedence as canManage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const workspaceMock = vi.hoisted(() => ({
  supported: true,
  mode: 'preview',
  setMode: vi.fn(),
  source: null,
  currentRevision: null,
  revisions: [],
  capabilities: null,
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
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ authorship }) => (
    <div data-testid="authorship">{authorship ? authorship.label : 'none'}</div>
  ),
}));
vi.mock('./ArtifactViewerBody', () => ({ ArtifactViewerBody: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';

const artifact = (capabilities) => ({
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Launch brief',
  type: 'document',
  ext: '.html',
  path: '/artifacts/launch/index.html',
  canonicalPath: '/artifacts/launch/index.html',
  capabilities,
});

const shown = () => screen.getByTestId('authorship').textContent;

describe('viewer authorship tag', () => {
  beforeEach(() => {
    workspaceMock.capabilities = null;
  });

  it('uses the card\'s capabilities while the workspace has none', () => {
    render(<ArtifactViewer open artifact={artifact({ role: 'reviewer' })} onClose={vi.fn()} />);
    expect(shown()).toBe('Another member');
  });

  it('follows the workspace once it answers', () => {
    workspaceMock.capabilities = { role: 'owner', canEdit: true };
    render(<ArtifactViewer open artifact={artifact({ role: 'reviewer' })} onClose={vi.fn()} />);
    expect(shown()).toBe('none');
  });

  it('shows the ownerless tag from the workspace', () => {
    workspaceMock.capabilities = { role: 'reviewer', canEdit: false, ownerUnknown: true };
    render(<ArtifactViewer open artifact={artifact({ role: 'owner' })} onClose={vi.fn()} />);
    expect(shown()).toBe('Unknown owner');
  });

  it('shows nothing when neither side has capabilities', () => {
    render(<ArtifactViewer open artifact={artifact(undefined)} onClose={vi.fn()} />);
    expect(shown()).toBe('none');
  });
});

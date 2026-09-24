import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
const previewArtifact = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(),
  previewArtifact,
  unpublishArtifact: vi.fn(),
  artifactServeUrl: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactDraftText,
  loadArtifactDraftDocument,
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: true,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'https://cowork.example',
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
vi.mock('./ArtifactViewerHeader', () => ({ ArtifactViewerHeader: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';

const artifact = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Launch brief',
  type: 'document',
  ext: '.html',
  path: '/artifacts/launch/index.html',
  canonicalPath: '/artifacts/launch/index.html',
  draftUrl: '/api/v1/artifacts/drafts/proj-1/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/index.html',
  capabilities: { role: 'owner', canEdit: true },
};

describe('ArtifactViewer preview error notice', () => {
  beforeEach(() => {
    loadArtifactDraftDocument.mockReset();
    loadArtifactDraftDocument.mockResolvedValue({
      content: '<html><head></head><body>Hi</body></html>',
      contentType: 'text/html; charset=utf-8',
      isHtml: true,
    });
    previewArtifact.mockReset();
    previewArtifact.mockResolvedValue({ content: 'hello preview text', truncated: false, mime: 'text/markdown' });
  });

  it('announces a preview error without hiding the page that produced it', async () => {
    // The page rendered; only its script died. Replacing the canvas with an
    // error would hide exactly what the user is trying to understand.
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
    const frame = await screen.findByTitle('Launch brief');

    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        source: 'anton-preview',
        type: 'error',
        message: "SecurityError: Failed to read the 'localStorage' property",
        file: 'a.html',
        line: 44,
      },
    }));

    // By text, not by role: ArtifactViewer already has two elements with
    // role="status" (lines 899 and 943), so a role query becomes ambiguous
    // as soon as either condition changes. The accessible name of a div with
    // this role is not computed from its content, so { name } would not help.
    expect(await screen.findByText(/The preview reported an error/))
      .toHaveTextContent("SecurityError: Failed to read the 'localStorage' property");
    expect(screen.getByTitle('Launch brief')).toBeInTheDocument();
  });

  it('counts the errors beyond the first', async () => {
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
    const frame = await screen.findByTitle('Launch brief');
    const post = (message) => fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'anton-preview', type: 'error', message, file: 'a.html', line: 1 },
    }));

    post('first');
    post('second');

    expect(await screen.findByText(/The preview reported an error/))
      .toHaveTextContent('(+1 more)');
  });

  it('ignores preview messages for a text artifact, which never mounts an iframe', async () => {
    // No iframe means iframeRef.current is permanently null, which used to
    // make the sender check degrade to "accept anyone" — the hook must not
    // even be listening in this case.
    const textArtifact = {
      ...artifact,
      ext: '.md',
      path: '/artifacts/launch/notes.md',
      canonicalPath: '/artifacts/launch/notes.md',
      draftUrl: '',
    };
    render(<ArtifactViewer open artifact={textArtifact} onClose={vi.fn()} />);
    await screen.findByText('hello preview text');
    expect(screen.queryByTitle('Launch brief')).not.toBeInTheDocument();

    fireEvent(window, new MessageEvent('message', {
      source: window,
      data: {
        source: 'anton-preview',
        type: 'error',
        message: 'should never surface',
        file: 'a.html',
        line: 1,
      },
    }));

    expect(screen.queryByText(/The preview reported an error/)).not.toBeInTheDocument();
  });
});

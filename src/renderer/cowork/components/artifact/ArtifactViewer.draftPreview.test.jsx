import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  artifactServeUrl: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn() }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactDraftText: vi.fn(),
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

function htmlDoc(content = '<html><head></head><body>Hi</body></html>') {
  return { content, contentType: 'text/html; charset=utf-8', isHtml: true };
}

describe('ArtifactViewer draft HTML preview (org-mode 401 fix)', () => {
  beforeEach(() => {
    loadArtifactDraftDocument.mockReset();
  });

  it('fetches the draft through authFetch and renders it via srcdoc, not src', async () => {
    loadArtifactDraftDocument.mockResolvedValue(htmlDoc());

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).toHaveAttribute('srcdoc');
    expect(frame).not.toHaveAttribute('src');
    expect(loadArtifactDraftDocument).toHaveBeenCalledWith(
      expect.stringContaining(artifact.draftUrl),
    );
  });

  it('injects a base href pointing at the draft directory', async () => {
    loadArtifactDraftDocument.mockResolvedValue(htmlDoc());

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame.getAttribute('srcdoc')).toContain(
      '<base href="https://cowork.example/api/v1/artifacts/drafts/proj-1/'
      + 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/">',
    );
  });

  it('delivers HTML over 200KB to srcdoc whole, without the text-preview cap', async () => {
    const big = `<html><head></head><body>${'x'.repeat(250_000)}END</body></html>`;
    loadArtifactDraftDocument.mockResolvedValue(htmlDoc(big));

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame.getAttribute('srcdoc')).toContain('END</body>');
  });

  it('requests the comment-layer flag in the fetch URL for an artifact with a stable key', async () => {
    loadArtifactDraftDocument.mockResolvedValue(htmlDoc());

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    await screen.findByTitle('Launch brief');
    expect(loadArtifactDraftDocument).toHaveBeenCalledWith(
      expect.stringContaining('__antonComments=1'),
    );
  });

  it('shows an error instead of an empty iframe when the fetch fails', async () => {
    loadArtifactDraftDocument.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByTitle('Launch brief')).not.toBeInTheDocument();
  });

  it('names a 403 as no-access rather than a generic failure', async () => {
    loadArtifactDraftDocument.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    expect(await screen.findByText('You do not have access to this draft.')).toBeInTheDocument();
  });

  it('names a 401 as an expired session rather than a generic failure', async () => {
    loadArtifactDraftDocument.mockRejectedValue(Object.assign(new Error('nope'), { status: 401 }));

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    expect(await screen.findByText('Your session expired — reload the page and try again.'))
      .toBeInTheDocument();
  });

  it('falls back to src for a non-HTML draft content type instead of srcdoc', async () => {
    loadArtifactDraftDocument.mockResolvedValue({
      content: 'plain body',
      contentType: 'application/octet-stream',
      isHtml: false,
    });

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).toHaveAttribute('src');
    expect(frame).not.toHaveAttribute('srcdoc');
  });

  it('never grants the srcdoc iframe allow-same-origin', async () => {
    loadArtifactDraftDocument.mockResolvedValue(htmlDoc());

    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  /*
   * data: and cross-origin draft URLs never reach loadArtifactDraftDocument —
   * a data: URL makes no network request at all (nothing for a credential to
   * protect), and a genuinely different origin must never receive the web
   * Keycloak bearer that authFetch would attach. Both keep using the old
   * direct src= navigation exactly as before this PR.
   */
  it('renders an embedded data: draft URL via src, without fetching', async () => {
    const dataArtifact = {
      ...artifact,
      draftUrl: 'data:text/html;charset=utf-8,%3Ch1%3EHi%3C%2Fh1%3E',
    };

    render(<ArtifactViewer open artifact={dataArtifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).toHaveAttribute('src', dataArtifact.draftUrl);
    expect(frame).not.toHaveAttribute('srcdoc');
    expect(loadArtifactDraftDocument).not.toHaveBeenCalled();
  });

  it('renders a cross-origin absolute draft URL via src, without fetching (no credential leak)', async () => {
    const crossOriginArtifact = {
      ...artifact,
      draftUrl: 'https://evil.example/index.html',
    };

    render(<ArtifactViewer open artifact={crossOriginArtifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).toHaveAttribute('src');
    expect(frame.getAttribute('src')).toContain('https://evil.example/index.html');
    expect(frame).not.toHaveAttribute('srcdoc');
    expect(loadArtifactDraftDocument).not.toHaveBeenCalled();
  });
});

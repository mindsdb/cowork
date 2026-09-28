import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

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
// Shows what the viewer hands the header, so this file stays about the wiring
// from the hook to the header. The button and its popover are covered in
// ArtifactViewerHeader.previewErrors.test.jsx.
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ diagnostics }) => (
    <div data-testid="header-diagnostics" data-dismissed={String(diagnostics.dismissed)}>
      <ul>
        {diagnostics.errors.map((error, index) => <li key={index}>{error.message}</li>)}
      </ul>
      <button type="button" onClick={diagnostics.dismiss}>Dismiss</button>
    </div>
  ),
}));
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

const postFromPreview = (source, data) => fireEvent(window, new MessageEvent('message', {
  source,
  data: { source: 'anton-preview', ...data },
}));
const scriptError = (message) => ({ type: 'error', message, file: 'a.html', line: 1 });
const headerDiagnostics = () => screen.getByTestId('header-diagnostics');
const headerErrors = () => within(headerDiagnostics()).queryAllByRole('listitem')
  .map((item) => item.textContent);

describe('ArtifactViewer preview errors', () => {
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

  it('hands a preview error to the header without hiding the page that produced it', async () => {
    // The page rendered; only its script died. Replacing the canvas with an
    // error would hide exactly what the user is trying to understand.
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
    const frame = await screen.findByTitle('Launch brief');

    postFromPreview(frame.contentWindow, {
      ...scriptError("SecurityError: Failed to read the 'localStorage' property"),
      line: 44,
    });

    await vi.waitFor(() => expect(headerErrors())
      .toEqual(["SecurityError: Failed to read the 'localStorage' property"]));
    expect(screen.getByTitle('Launch brief')).toBeInTheDocument();
    // ENG-3002: the header is the only place the message appears. The banner
    // that used to sit between the header and the page repeated it.
    expect(screen.getAllByText(/Failed to read the 'localStorage' property/)).toHaveLength(1);
  });

  it('hands the header every error, not just the first', async () => {
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
    const frame = await screen.findByTitle('Launch brief');

    postFromPreview(frame.contentWindow, scriptError('first'));
    postFromPreview(frame.contentWindow, scriptError('second'));

    await vi.waitFor(() => expect(headerErrors()).toEqual(['first', 'second']));
  });

  it('counts a blocked stylesheet as one error, not two', async () => {
    /* The shape web showed on every HTML preview: one blocked <link> sends a
       policy report and a failed-load report for the same URL. */
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
    const frame = await screen.findByTitle('Launch brief');
    const url = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';

    postFromPreview(frame.contentWindow, { type: 'csp', violatedDirective: 'style-src-elem', blockedURI: url });
    postFromPreview(frame.contentWindow, { type: 'resource', tagName: 'LINK', url });

    await vi.waitFor(() => expect(headerErrors())
      .toEqual([`Blocked by the page security policy (style-src-elem): ${url}`]));
  });

  it("wires the header's Dismiss to the hook", async () => {
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
    const frame = await screen.findByTitle('Launch brief');
    postFromPreview(frame.contentWindow, scriptError('boom'));
    await vi.waitFor(() => expect(headerErrors()).toEqual(['boom']));
    expect(headerDiagnostics()).toHaveAttribute('data-dismissed', 'false');

    fireEvent.click(within(headerDiagnostics()).getByRole('button', { name: 'Dismiss' }));

    expect(headerDiagnostics()).toHaveAttribute('data-dismissed', 'true');
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

    postFromPreview(window, scriptError('should never surface'));

    expect(headerErrors()).toEqual([]);
  });
});

/*
 * Desktop counterpart to ArtifactViewer.draftPreview.test.jsx (ENG-2818).
 *
 * That file mocks the host as web, where nothing attaches the Keycloak bearer
 * to an iframe navigation, so the draft must be fetched and handed over via
 * `srcdoc`. This file pins the other half of the rule: on Desktop against the
 * local loopback the main process injects the bearer into iframe navigations
 * at the network layer, so the viewer navigates instead — and must, because a
 * `srcdoc` document inherits the shell's CSP and drops the artifact's CDN
 * scripts, web fonts and remote images.
 *
 * A separate file rather than a case in the existing one: `vi.mock` is hoisted
 * per module registry, so the host's platform cannot vary between tests there.
 */
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
const loadArtifactDraftText = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(),
  previewArtifact: vi.fn(),
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
    isElectron: true,
    isWeb: false,
    isLocalApiOrigin: () => true,
    getApiOrigin: () => 'http://127.0.0.1:26866',
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

describe('ArtifactViewer draft HTML preview on Desktop (ENG-2818)', () => {
  beforeEach(() => {
    loadArtifactDraftDocument.mockReset();
    loadArtifactDraftDocument.mockResolvedValue({
      content: '<html><head></head><body>Hi</body></html>',
      contentType: 'text/html; charset=utf-8',
      isHtml: true,
    });
  });

  /*
   * The defect this file exists for. Under `srcdoc` the document inherits the
   * shell's `script-src 'self' 'unsafe-inline'`, so an artifact's
   * `<script src="https://cdn.jsdelivr.net/...">` never loads and its charts
   * render blank while the surrounding inline-scripted content looks fine.
   * A navigated document carries its own policy.
   */
  it('navigates the iframe instead of inheriting the shell CSP through srcdoc', async () => {
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).toHaveAttribute('src');
    expect(frame).not.toHaveAttribute('srcdoc');
  });

  it('does not fetch the draft at all — the navigation carries the bearer itself', async () => {
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    await screen.findByTitle('Launch brief');
    expect(loadArtifactDraftDocument).not.toHaveBeenCalled();
  });

  it('navigates to the draft URL made absolute against the loopback API origin', async () => {
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame.getAttribute('src')).toContain(
      `http://127.0.0.1:26866${artifact.draftUrl}`,
    );
  });

  it('still requests the comment layer on the navigated URL', async () => {
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame.getAttribute('src')).toContain('__antonComments=1');
  });

  /*
   * Restoring navigation must not widen the sandbox: the artifact is
   * LLM-generated code and stays in an opaque origin, as it was under srcdoc.
   */
  it('never grants the navigated iframe allow-same-origin', async () => {
    render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });
});

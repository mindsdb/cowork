// The URL the "open in a browser tab" control hands to the OS (ENG-2819).
//
// ArtifactViewerHeader.browserTab.test.jsx already covers whether the control
// is offered and whether a click reaches its handler. It cannot cover this:
// it renders the header with a stubbed callback, so the URL the viewer derives
// never appears in it. That gap is the whole bug — the button was wired
// correctly and emitted a URL Electron cannot open.
//
// `serveUrl` and `draftUrl` arrive origin-relative from the server. Web
// survived that because `window.open` resolves against the page; an Electron
// renderer is loaded from file://, so main's URL parse throws and it opens
// nothing. So every assertion here is about the URL being absolute.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const API_ORIGIN = 'http://127.0.0.1:26866';

const openExternal = vi.hoisted(() => vi.fn(async () => {}));
const publishState = vi.hoisted(() => ({ publishedUrl: '' }));
const headerProps = vi.hoisted(() => ({ current: null }));

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

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  // Resolves rather than returning undefined: an artifact with a local path
  // mounts a preview on open, and the viewer chains off this directly.
  mountArtifactPreview: vi.fn(async () => ({ kind: 'file', url: '', artifactDir: '' })),
  previewArtifact: vi.fn(async () => ({ content: '' })),
  unpublishArtifact: vi.fn(),
  artifactServeUrl: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  loadArtifactDraftText: vi.fn(async () => ({ content: '' })),
  loadArtifactDraftDocument: vi.fn(async () => ({
    content: '<html><head></head><body>Hi</body></html>',
    contentType: 'text/html; charset=utf-8',
    isHtml: true,
  })),
}));
// Desktop: this is the shell where a relative URL cannot resolve.
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isWeb: false,
    isMac: () => false,
    isLocalApiOrigin: () => true,
    getApiOrigin: () => API_ORIGIN,
    openExternal,
    openPath: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({
    publishedUrl: publishState.publishedUrl,
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
// Capture the props rather than render the real header: the assertions are
// about the URL the viewer derives, not about the chrome around it.
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: (props) => {
    headerProps.current = props;
    return null;
  },
}));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';

const baseArtifact = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Launch brief',
  type: 'document',
  ext: '.html',
  path: '/artifacts/launch/index.html',
  canonicalPath: '/artifacts/launch/index.html',
  capabilities: { role: 'owner', canEdit: true },
};

const SERVE_PATH = '/api/v1/artifacts/serve/launch/index.html';
const DRAFT_PATH =
  '/api/v1/artifacts/drafts/proj-1/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/index.html';

// Render, then fire the control's own handler through the captured props.
function openInBrowserTab(artifact) {
  render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
  const actions = headerProps.current?.actions;
  expect(actions?.canOpenInBrowserTab).toBe(true);
  actions.onOpenInBrowserTab();
  return openExternal.mock.calls.at(-1)?.[0];
}

describe('open in a browser tab — the URL handed to the OS', () => {
  beforeEach(() => {
    openExternal.mockClear();
    headerProps.current = null;
    publishState.publishedUrl = '';
  });

  it('absolutizes a relative serveUrl', () => {
    // Fails before the fix: emits the bare '/api/v1/...' path, which main
    // cannot parse, so nothing opens and no error is raised.
    const url = openInBrowserTab({ ...baseArtifact, serveUrl: SERVE_PATH });

    expect(url).toBe(`${API_ORIGIN}${SERVE_PATH}`);
  });

  it('absolutizes a relative draftUrl when there is no serveUrl', () => {
    const url = openInBrowserTab({ ...baseArtifact, draftUrl: DRAFT_PATH });

    expect(url).toBe(`${API_ORIGIN}${DRAFT_PATH}`);
  });

  it('leaves a published URL alone — it already carries its own origin', () => {
    // Regression guard for ENG-2321's Cloud behaviour, and for the artifact
    // this ticket does not cover: a published URL must not be re-prefixed.
    publishState.publishedUrl = 'https://artifacts.mindshub.ai/a/launch';

    const url = openInBrowserTab({ ...baseArtifact, serveUrl: SERVE_PATH });

    expect(url).toBe('https://artifacts.mindshub.ai/a/launch');
  });

  it('does not double-prefix a serveUrl that is already absolute', () => {
    const absolute = 'https://cowork.example/api/v1/artifacts/serve/launch/index.html';

    const url = openInBrowserTab({ ...baseArtifact, serveUrl: absolute });

    expect(url).toBe(absolute);
  });

  it('emits a URL the main process can actually parse', () => {
    // The assertion the original test could not make. `new URL(value)` with no
    // base is exactly what src/main/external-url.ts does before handing the
    // value to shell.openExternal; it throwing is the bug, in one line.
    const url = openInBrowserTab({ ...baseArtifact, serveUrl: SERVE_PATH });

    expect(() => new URL(url)).not.toThrow();
    expect(new URL(url).protocol).toBe('http:');
  });
});

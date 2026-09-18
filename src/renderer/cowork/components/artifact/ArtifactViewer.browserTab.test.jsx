// What the "open in a browser tab" control actually opens (ENG-2819).
//
// ArtifactViewerHeader.browserTab.test.jsx covers whether the control is
// offered and whether a click reaches its handler. It renders the header with
// a stubbed callback, so what the viewer *does* with that click never appears
// in it — which is the gap the bug lived in.
//
// The rule these assertions encode: on desktop an unpublished artifact must go
// to the OS as a local file, never over the served URL. The loopback server
// requires a bearer token that main injects into the app window's own session,
// and `shell.openExternal` launches a separate browser process that carries no
// such header — so the served URL answers 401 there however well-formed it is.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const LOOPBACK = 'http://127.0.0.1:26866';
const WEB_ORIGIN = 'https://cowork.example';

const openExternal = vi.hoisted(() => vi.fn(async () => {}));
const openPath = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const publishState = vi.hoisted(() => ({ publishedUrl: '' }));
const headerProps = vi.hoisted(() => ({ current: null }));
const bodyProps = vi.hoisted(() => ({ current: null }));
// Mutable so one file can exercise both shells; `vi.mock` is hoisted once.
const shell = vi.hoisted(() => ({ electron: true }));

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
  mountArtifactPreview: vi.fn(async () => ({
    kind: 'file',
    url: `${LOOPBACK}/api/v1/artifacts/serve/launch/index.html`,
    artifactDir: '/Users/someone/projects/launch/.anton/artifacts/launch',
  })),
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
vi.mock('../../../platform/host', () => ({
  host: {
    get isElectron() { return shell.electron; },
    get isWeb() { return !shell.electron; },
    isMac: () => false,
    // Desktop always addresses loopback; the web shell never does.
    isLocalApiOrigin: () => shell.electron,
    getApiOrigin: () => (shell.electron ? LOOPBACK : WEB_ORIGIN),
    openExternal,
    openPath,
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
// about what the viewer does with the click, not the chrome around it.
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: (props) => {
    headerProps.current = props;
    return null;
  },
}));
// The viewer's error state reaches the reader through the body's `preview`
// prop; capture it rather than hunt for the rendered string.
vi.mock('./ArtifactViewerBody', () => ({
  ArtifactViewerBody: (props) => {
    bodyProps.current = props;
    return null;
  },
}));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';

const LOCAL_PATH = '/Users/someone/projects/launch/.anton/artifacts/launch/index.html';
const SERVE_PATH = '/api/v1/artifacts/serve/launch/index.html';
const DRAFT_PATH =
  '/api/v1/artifacts/drafts/proj-1/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/index.html';

const baseArtifact = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Launch brief',
  type: 'document',
  ext: '.html',
  path: LOCAL_PATH,
  canonicalPath: LOCAL_PATH,
  capabilities: { role: 'owner', canEdit: true },
};

// Render, then fire the control's own handler through the captured props.
function clickBrowserTab(artifact) {
  render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} />);
  const actions = headerProps.current?.actions;
  expect(actions?.canOpenInBrowserTab).toBe(true);
  return actions.onOpenInBrowserTab();
}

beforeEach(() => {
  openExternal.mockClear();
  openPath.mockClear();
  openPath.mockResolvedValue({ ok: true });
  headerProps.current = null;
  bodyProps.current = null;
  publishState.publishedUrl = '';
  shell.electron = true;
  // The viewer fetches a draft preview on open; keep it off the network.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});

describe('open in a browser tab — desktop', () => {
  it('hands an unpublished artifact to the OS as a local file, not over the served URL', async () => {
    // AC1. Fails before the fix: called openExternal with the served URL,
    // which an external browser cannot authenticate against (401).
    await clickBrowserTab({ ...baseArtifact, serveUrl: SERVE_PATH });

    expect(openPath).toHaveBeenCalledWith(LOCAL_PATH);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('still opens the public link for a published artifact', async () => {
    // Regression guard: published URLs are absolute, public, and need no
    // credential — the one case that always worked must keep working.
    publishState.publishedUrl = 'https://artifacts.mindshub.ai/a/launch';

    await clickBrowserTab({ ...baseArtifact, serveUrl: SERVE_PATH });

    expect(openExternal).toHaveBeenCalledWith('https://artifacts.mindshub.ai/a/launch');
    expect(openPath).not.toHaveBeenCalled();
  });

  it('surfaces an error when the OS refuses the file', async () => {
    openPath.mockResolvedValue({ ok: false, reason: 'No application knows how to open this.' });

    await clickBrowserTab({ ...baseArtifact, serveUrl: SERVE_PATH });

    await waitFor(() => {
      expect(bodyProps.current?.preview?.error).toBe('No application knows how to open this.');
    });
  });
});

describe('open in a browser tab — web / org', () => {
  beforeEach(() => { shell.electron = false; });

  it('opens an unpublished artifact at an absolute draft URL', async () => {
    // No local file exists on this shell, so the URL is the only route.
    // `serveUrl` is always empty in org mode, so the draft URL is what remains.
    await clickBrowserTab({ ...baseArtifact, draftUrl: DRAFT_PATH });

    expect(openPath).not.toHaveBeenCalled();
    const url = openExternal.mock.calls.at(-1)?.[0];
    expect(url).toBe(`${WEB_ORIGIN}${DRAFT_PATH}`);
    expect(() => new URL(url)).not.toThrow();
  });

  it('still opens the public link for a published artifact', async () => {
    publishState.publishedUrl = 'https://artifacts.mindshub.ai/a/launch';

    await clickBrowserTab({ ...baseArtifact, draftUrl: DRAFT_PATH });

    expect(openExternal).toHaveBeenCalledWith('https://artifacts.mindshub.ai/a/launch');
  });

  it('does not double-prefix a URL that already carries an origin', async () => {
    const absolute = `${WEB_ORIGIN}${DRAFT_PATH}`;

    await clickBrowserTab({ ...baseArtifact, draftUrl: absolute });

    expect(openExternal).toHaveBeenCalledWith(absolute);
  });
});

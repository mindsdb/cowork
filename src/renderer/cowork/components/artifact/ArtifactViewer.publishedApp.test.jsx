import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { getOrgMode, setOrgMode } from '../../../lib/orgMode';

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
const createDraftLink = vi.hoisted(() => vi.fn());
const headerProps = vi.hoisted(() => ({ current: null }));
const fetchAuthenticatedBlob = vi.hoisted(() => vi.fn());
const fetchAuthenticatedResponse = vi.hoisted(() => vi.fn());

vi.mock('../../lib/authenticatedResource', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAuthenticatedBlob,
  fetchAuthenticatedResponse,
}));

vi.mock('../../api', () => ({
  fetchPublishStats: vi.fn(),
  setPublishTracking: vi.fn(),
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  artifactServeUrl: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
// The real artifactRef: a card without a full identity must stay on srcdoc.
vi.mock('../../lib/artifactWorkspaceApi', async (importOriginal) => ({
  artifactRef: (await importOriginal()).artifactRef,
  loadArtifactStats: vi.fn(),
  setArtifactTracking: vi.fn(),
  loadArtifactDraftText,
  loadArtifactDraftDocument,
  createDraftLink,
}));
const checkConfigured = vi.hoisted(() => vi.fn());
const getAccessToken = vi.hoisted(() => vi.fn(async () => 'kc-token'));
const publishedFrameCredential = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/viewSession', () => ({ publishedFrameCredential }));
const hooks = vi.hoisted(() => {
  const enabled = {};
  // Options are each hook's last argument: useInlineArtifactState takes
  // (iframeRef, artifact, options), the others (iframeRef, options).
  return { enabled, track: (name, real) => (...args) => { enabled[name] = args[args.length - 1]?.enabled; return real(...args); } };
});
vi.mock('./usePreviewCheckTarget', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, usePreviewCheckTarget: hooks.track('check', real.usePreviewCheckTarget) };
});
vi.mock('./usePreviewDiagnostics', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, usePreviewDiagnostics: hooks.track('diagnostics', real.usePreviewDiagnostics) };
});
vi.mock('./usePreviewView', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, usePreviewView: hooks.track('view', real.usePreviewView) };
});
vi.mock('./usePreviewFit', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, usePreviewFit: hooks.track('fit', real.usePreviewFit) };
});
vi.mock('./useInlineArtifactState', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, useInlineArtifactState: hooks.track('inline', real.useInlineArtifactState) };
});
vi.mock('../../../platform/host', async (importOriginal) => ({
  getAccessToken,
  host: {
    isElectron: false,
    isWeb: true,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'https://cowork.example',
    openExternal: vi.fn(),
    openPath: vi.fn(),
    openPendingTab: (await importOriginal()).openPendingTab,
    checkConfigured,
  },
}));
const published = vi.hoisted(() => ({ url: '', accessMode: 'public', artifactKey: '' }));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({
    publishedUrl: published.url,
    accessMode: published.accessMode,
    artifactKey: published.artifactKey,
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
  useArtifactCommentLayer: (ref, options) => {
    hooks.enabled.comments = options?.enabled;
    return {
    mode: false, anchorStates: {}, onIframeLoad: vi.fn(), exitMode: vi.fn(),
    toggleMode: vi.fn(), focus: vi.fn(), hlOn: vi.fn(), hlOff: vi.fn(),
    };
  },
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
// Captured, not rendered: the reload test drives the header's own handler.
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: (props) => {
    headerProps.current = props;
    return null;
  },
}));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';
import { publishedAppUrl } from './htmlPreviewSource';
import { mountArtifactPreview } from '../../api';

// A full-stack app on an org deployment (ENG-4687): the server can't start its
// backend (preview-mount is desktop-only), so the preview frames the app at its
// published address, where it already runs.
const app = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Team Shared Todo',
  type: 'fullstack-stateful-app',
  ext: '.html',
  path: '/artifacts/team-shared-todo/static/index.html',
  canonicalPath: '/artifacts/team-shared-todo/static/index.html',
  draftUrl: '/api/v1/artifacts/drafts/proj-1/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/static/index.html',
  capabilities: { role: 'owner', canEdit: true },
};
const LIVE = 'https://view-pr-cowork-1.dev.mindshub.test/view/8620653c9/b527cf6e';

let previous;
beforeEach(() => {
  previous = getOrgMode();
  setOrgMode(true);
  published.url = '';
  published.accessMode = 'public';
  published.artifactKey = 'artifact/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  publishedFrameCredential.mockReset();
  vi.mocked(mountArtifactPreview).mockReset();
});
afterEach(() => {
  setOrgMode(previous);
  cleanup();
});

const ORIGIN = 'https://f5h8n2w6-staging.mindshub.co';
const frameOf = () => screen.findByTitle('Team Shared Todo');

describe('ArtifactViewer: a full-stack app on an org deployment', () => {
  it('frames the app on its artifact host, never the desktop-only preview mount', async () => {
    published.url = LIVE;
    publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp: Math.floor(Date.now() / 1000) + 3600 });
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    expect((await frameOf()).getAttribute('src')).toBe(`${ORIGIN}/_t/v1.p.s/`);
    expect(publishedFrameCredential).toHaveBeenCalledWith(LIVE, getAccessToken, expect.any(AbortSignal));
    expect(mountArtifactPreview).not.toHaveBeenCalled();
  });

  it('frames a public app by its link key, versioned', async () => {
    published.url = LIVE;
    publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'k3m7q2xwp6n4tahd5rzc2bvy7e', exp: null });
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    expect((await frameOf()).getAttribute('src')).toMatch(new RegExp(`^${ORIGIN.replace(/[.]/g, '\\.')}/_t/k3m7q2xwp6n4tahd5rzc2bvy7e/\\?v=`));
  });

  it("uses the card's address before the publish state has loaded", async () => {
    publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp: null });
    render(<ArtifactViewer open artifact={{ ...app, publishedUrl: LIVE }} onClose={vi.fn()} />);

    await frameOf();
    expect(publishedFrameCredential).toHaveBeenCalledWith(LIVE, getAccessToken, expect.any(AbortSignal));
  });

  it('says it shows once published instead of erroring, when it has no address yet', async () => {
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    expect(await screen.findByText(/This app shows here once it's published/)).toBeInTheDocument();
    expect(screen.queryByTitle('Team Shared Todo')).toBeNull();
    expect(publishedFrameCredential).not.toHaveBeenCalled();
  });

  it('frames nothing but an https page', async () => {
    published.url = 'javascript:alert(1)';
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    expect(await screen.findByText(/This app shows here once it's published/)).toBeInTheDocument();
    expect(publishedFrameCredential).not.toHaveBeenCalled();
  });

  it('says why there is no preview, with the published page', async () => {
    published.url = LIVE;
    publishedFrameCredential.mockResolvedValue({ error: 'no_access' });
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    expect(await screen.findByText(/You don't have access to this app's published page/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open the published page/ })).toBeInTheDocument();
    expect(screen.queryByTitle('Team Shared Todo')).toBeNull();
  });

  it('loads again from the notice after a transient failure', async () => {
    published.url = LIVE;
    publishedFrameCredential.mockResolvedValueOnce({ error: 'retry' })
      .mockResolvedValueOnce({ origin: ORIGIN, credential: 'v1.p.s', exp: null });
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    const reload = await screen.findByRole('button', { name: /Reload preview/ });
    act(() => { reload.click(); });
    expect((await frameOf()).getAttribute('src')).toContain(`${ORIGIN}/_t/v1.p.s/`);
    expect(publishedFrameCredential).toHaveBeenCalledTimes(2);
  });

  it('keeps every frame message hook off for the app, whose frame holds only its own code', async () => {
    published.url = LIVE;
    publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp: null });
    // Inline metadata, so only the frame's missing shim can switch it off.
    render(<ArtifactViewer open artifact={{ ...app, display: 'inline' }} onClose={vi.fn()} />);

    await frameOf();
    expect(hooks.enabled).toMatchObject({ diagnostics: false, view: false, fit: false, inline: false, check: false });
  });

  it('turns the agent preview check off, as for a live app, so it reports unavailable', async () => {
    published.url = LIVE;
    publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp: null });
    render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);

    await frameOf();
    expect(hooks.enabled.check).toBe(false);
  });

  it('opens comments without a reload and without the comment bridge', async () => {
    // Restricted and published: comments are enabled without a workspace.
    published.url = LIVE;
    published.accessMode = 'restricted';
    // The comment key arrives after the frame loaded, the case that reloads a
    // draft. The viewer also derives a key from a full artifact id, so this
    // artifact's id gives none and the key comes only from usePublish.
    published.artifactKey = '';
    const lateKey = { ...app, id: 'team-shared-todo' };
    publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp: null });
    const { rerender } = render(<ArtifactViewer open artifact={lateKey} onClose={vi.fn()} />);
    await frameOf();

    published.artifactKey = 'artifact/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    rerender(<ArtifactViewer open artifact={lateKey} onClose={vi.fn()} />);
    act(() => { headerProps.current.review.onToggle(); });

    await waitFor(() => expect(headerProps.current.review.open).toBe(true));
    expect(hooks.enabled.comments).toBe(false);
    expect(publishedFrameCredential).toHaveBeenCalledTimes(1);
  });

  describe('when the token is about to expire', () => {
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
    afterEach(() => { vi.useRealTimers(); });

    it('covers the frame 90 seconds before, and Reload brings a new token', async () => {
      published.url = LIVE;
      const exp = Math.floor(Date.now() / 1000) + 3600;
      publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp });
      render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);
      await frameOf();

      // Seconds of slack on both sides: exp is rounded down to a second, and
      // the fake clock moves with real time while the viewer loads.
      act(() => { vi.advanceTimersByTime(3600_000 - 100_000); });
      expect(screen.queryByTestId('published-session-ended')).toBeNull();
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(screen.getByTestId('published-session-ended')).toBeInTheDocument();

      act(() => { screen.getByRole('button', { name: /Reload preview/ }).click(); });
      await waitFor(() => expect(screen.queryByTestId('published-session-ended')).toBeNull());
      expect(publishedFrameCredential).toHaveBeenCalledTimes(2);
    });

    it('checks the deadline again when the tab comes back', async () => {
      published.url = LIVE;
      const exp = Math.floor(Date.now() / 1000) + 3600;
      publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp });
      render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);
      await frameOf();

      // A sleeping laptop: the clock moves on, the timer has not fired.
      vi.setSystemTime(Date.now() + 3600_000);
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(screen.getByTestId('published-session-ended')).toBeInTheDocument();
    });

    it('checks the deadline again when the window regains focus', async () => {
      published.url = LIVE;
      const exp = Math.floor(Date.now() / 1000) + 3600;
      publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp });
      render(<ArtifactViewer open artifact={app} onClose={vi.fn()} />);
      await frameOf();

      vi.setSystemTime(Date.now() + 3600_000);
      act(() => { window.dispatchEvent(new Event('focus')); });
      expect(screen.getByTestId('published-session-ended')).toBeInTheDocument();
    });
  });
});

describe('publishedAppUrl', () => {
  it.each([
    [LIVE, LIVE],
    ['http://view.example/x', ''],
    ['javascript:alert(1)', ''],
    ['data:text/html,hi', ''],
    // Cowork's own API origin: never framed with allow-same-origin.
    ['https://cowork.example/api/v1/anything', ''],
    ['', ''],
    [undefined, ''],
  ])('%s → %s', (value, expected) => {
    expect(publishedAppUrl(value)).toBe(expected);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { setDraftLinks } from '../../../lib/draftLinks';

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

vi.mock('../../api', () => ({
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
  loadArtifactDraftText,
  loadArtifactDraftDocument,
  createDraftLink,
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

    expect(await screen.findByText('boom (HTTP 500)')).toBeInTheDocument();
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

/*
 * The text branch (.md/.txt/.csv) had no coverage at all, which is how it kept
 * two defects the draft-HTML branch above does not have: it showed
 * whatever it caught, so Chromium's "Failed to fetch" reached the modal on a
 * CSV, and it had no embedded/cross-origin fallback, so a data: draft failed
 * for CSV where the same URL renders fine as HTML.
 */
describe('ArtifactViewer draft text preview', () => {
  const csvArtifact = {
    ...artifact,
    title: 'Signups',
    ext: '.csv',
    path: '/artifacts/launch/signups.csv',
    canonicalPath: '/artifacts/launch/signups.csv',
    draftUrl: '/api/v1/artifacts/drafts/proj-1/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/signups.csv',
  };

  const csvBody = (content = 'id,name\n1,Ada\n') => ({ content, truncated: false, mime: 'text/csv' });

  beforeEach(() => {
    loadArtifactDraftText.mockReset();
    loadArtifactDraftDocument.mockReset();
  });

  it('renders the CSV as a table', async () => {
    loadArtifactDraftText.mockResolvedValue(csvBody());

    render(<ArtifactViewer open artifact={csvArtifact} onClose={vi.fn()} />);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'name' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Ada' })).toBeInTheDocument();
  });

  it('never shows the browser text when the fetch fails at the network layer', async () => {
    loadArtifactDraftText.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<ArtifactViewer open artifact={csvArtifact} onClose={vi.fn()} />);

    expect(await screen.findByText(
      'Could not reach the server to load this preview. Check the connection, then reload.',
    )).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  it('names a 403 as no-access, the same as the draft-HTML branch', async () => {
    loadArtifactDraftText.mockRejectedValue(
      Object.assign(new Error('Could not load private draft (403)'), { status: 403 }),
    );

    render(<ArtifactViewer open artifact={csvArtifact} onClose={vi.fn()} />);

    expect(await screen.findByText('You do not have access to this draft.')).toBeInTheDocument();
  });

  it('names a 401 as an expired session, the same as the draft-HTML branch', async () => {
    loadArtifactDraftText.mockRejectedValue(
      Object.assign(new Error('Could not load private draft (401)'), { status: 401 }),
    );

    render(<ArtifactViewer open artifact={csvArtifact} onClose={vi.fn()} />);

    expect(await screen.findByText('Your session expired — reload the page and try again.'))
      .toBeInTheDocument();
  });

  it('keeps the loader phrasing, which already names the status', async () => {
    loadArtifactDraftText.mockRejectedValue(
      Object.assign(new Error('Could not load private draft (404)'), { status: 404 }),
    );

    render(<ArtifactViewer open artifact={csvArtifact} onClose={vi.fn()} />);

    expect(await screen.findByText('Could not load private draft (404)')).toBeInTheDocument();
  });

  it('fetches a same-origin draft with credentials', async () => {
    loadArtifactDraftText.mockResolvedValue(csvBody());

    render(<ArtifactViewer open artifact={csvArtifact} onClose={vi.fn()} />);

    await screen.findByRole('table');
    expect(loadArtifactDraftText).toHaveBeenCalledWith(
      csvArtifact.draftUrl,
      { withCredentials: true },
    );
  });

  /*
   * The text path's equivalent of the draft-HTML branch's plain `src=`
   * navigation: read it, just without the bearer. Refusing outright is what
   * made a data: CSV fail where a data: HTML draft renders.
   */
  it.each([
    ['an embedded data:', 'data:text/csv;charset=utf-8,id%2Cname%0A1%2CAda'],
    ['a cross-origin', 'https://cdn.example/signups.csv'],
  ])('reads %s draft URL without credentials', async (_label, draftUrl) => {
    loadArtifactDraftText.mockResolvedValue(csvBody());

    render(<ArtifactViewer open artifact={{ ...csvArtifact, draftUrl }} onClose={vi.fn()} />);

    await screen.findByRole('table');
    expect(loadArtifactDraftText).toHaveBeenCalledWith(draftUrl, { withCredentials: false });
  });
});

/*
 * With draft links on (the deployment's flag from /health), org web navigates
 * the frame to a signed link on the draft host instead of fetching the HTML
 * into srcdoc, so the draft follows that host's CSP and CDN scripts, fonts and
 * images load.
 */
describe('ArtifactViewer draft preview through a signed link', () => {
  const LINK = 'https://draft-staging.mindshub.co/_t/v1.first.sig/index.html';
  const NEXT_LINK = 'https://draft-staging.mindshub.co/_t/v1.second.sig/index.html';
  const linked = { ...artifact, projectId: 'proj-1' };
  let iframeLoading;

  beforeEach(() => {
    loadArtifactDraftDocument.mockReset();
    createDraftLink.mockReset();
    headerProps.current = null;
    setDraftLinks(true);
    // The frames here point at a live draft host: keep happy-dom from loading them.
    iframeLoading = window.happyDOM.settings.disableIframePageLoading;
    window.happyDOM.settings.disableIframePageLoading = true;
  });

  // Unmount first: a mounted viewer would rerun its preview effect on the
  // store's reset and fetch into srcdoc with a mock already reset. Spies are
  // restored here, so a failed expectation never leaves window.open replaced.
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setDraftLinks(false);
    window.happyDOM.settings.disableIframePageLoading = iframeLoading;
  });

  it('navigates the frame to a fresh link and never fetches the draft into srcdoc', async () => {
    createDraftLink.mockResolvedValue({ url: LINK, expiresAt: 1_900_000_000 });

    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).not.toHaveAttribute('srcdoc');
    const src = new URL(frame.getAttribute('src'));
    expect(`${src.origin}${src.pathname}`).toBe(LINK);
    expect(src.searchParams.get('v')).toBeTruthy();
    expect(src.searchParams.get('__antonComments')).toBe('1');
    expect(createDraftLink).toHaveBeenCalledWith('proj-1', artifact.id);
    expect(loadArtifactDraftDocument).not.toHaveBeenCalled();
  });

  it('opens a chat card, which carries no capabilities, through a link too', async () => {
    createDraftLink.mockResolvedValue({ url: LINK, expiresAt: 1_900_000_000 });
    const chatCard = { ...linked };
    delete chatCard.capabilities;

    render(<ArtifactViewer open artifact={chatCard} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).not.toHaveAttribute('srcdoc');
    expect(createDraftLink).toHaveBeenCalledWith('proj-1', artifact.id);
  });

  it('keeps the frame sandboxed without allow-same-origin', async () => {
    createDraftLink.mockResolvedValue({ url: LINK, expiresAt: 1_900_000_000 });

    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-forms allow-modals');
  });

  // Saving in Edit reloads the preview through this handler.
  it('asks for a new link when the preview reloads', async () => {
    createDraftLink
      .mockResolvedValueOnce({ url: LINK, expiresAt: 1_900_000_000 })
      .mockResolvedValueOnce({ url: NEXT_LINK, expiresAt: 1_900_000_100 });

    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);
    await screen.findByTitle('Launch brief');
    act(() => { headerProps.current.actions.onReload(); });

    await waitFor(() => {
      expect(screen.getByTitle('Launch brief').getAttribute('src')).toContain('/_t/v1.second.sig/');
    });
    expect(createDraftLink).toHaveBeenCalledTimes(2);
  });

  // The comment layer is in the first link already: the artifact's identity,
  // which a link needs, also gives its comment key.
  it('asks for no new link when comments are toggled after the preview loads', async () => {
    createDraftLink.mockResolvedValue({ url: LINK, expiresAt: 1_900_000_000 });

    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);
    const first = (await screen.findByTitle('Launch brief')).getAttribute('src');
    act(() => { headerProps.current.review.onToggle(); });
    await act(async () => { await Promise.resolve(); });
    act(() => { headerProps.current.review.onToggle(); });
    await act(async () => { await Promise.resolve(); });

    expect(createDraftLink).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('Launch brief').getAttribute('src')).toBe(first);
  });

  it('keeps the srcdoc path when the deployment issues no links', async () => {
    setDraftLinks(false);
    loadArtifactDraftDocument.mockResolvedValue(htmlDoc());

    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).toHaveAttribute('srcdoc');
    expect(createDraftLink).not.toHaveBeenCalled();
  });

  it('shows the server error instead of an empty frame when no link is issued', async () => {
    createDraftLink.mockRejectedValue(Object.assign(new Error('Artifact not found'), { status: 404 }));

    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);

    expect(await screen.findByText('Artifact not found (HTTP 404)')).toBeInTheDocument();
    expect(screen.queryByTitle('Launch brief')).not.toBeInTheDocument();
  });

  it.each([
    ['another host', 'https://evil.example/_t/v1.a.b/index.html'],
    ['a path that names another host', 'https://draft-staging.mindshub.co//evil.example/x'],
    ['a backslash path', 'https://draft-staging.mindshub.co/\\evil.example/x'],
    ['a path outside /_t/', 'https://draft-staging.mindshub.co/index.html'],
    ['plain http', 'http://draft-staging.mindshub.co/_t/v1.a.b/index.html'],
    ['not a URL', 'javascript:alert(1)'],
  ])('refuses a link outside the draft hosts: %s', async (_label, url) => {
    createDraftLink.mockResolvedValue({ url, expiresAt: 1 });

    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);

    expect(await screen.findByText('The server returned no draft link.')).toBeInTheDocument();
    expect(screen.queryByTitle('Launch brief')).not.toBeInTheDocument();
  });

  it('keeps a card without a full identity on srcdoc', async () => {
    loadArtifactDraftDocument.mockResolvedValue(htmlDoc());
    // A card from before identities were widened: a short id, no stable id.
    const shortCard = { ...linked, id: 'aaaaaaaa' };

    render(<ArtifactViewer open artifact={shortCard} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame).toHaveAttribute('srcdoc');
    expect(createDraftLink).not.toHaveBeenCalled();
  });

  it('keeps the preview on screen when the pop-up is blocked', async () => {
    createDraftLink.mockResolvedValue({ url: LINK, expiresAt: 1 });
    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);
    await screen.findByTitle('Launch brief');
    vi.spyOn(window, 'open').mockReturnValue(null);

    await act(async () => { await headerProps.current.actions.onOpenInBrowserTab(); });

    expect(screen.getByTitle('Launch brief')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('The browser blocked the new tab.');
  });

  it('never shows a tab error of one artifact on the next one', async () => {
    let rejectFirst;
    createDraftLink
      .mockResolvedValueOnce({ url: LINK, expiresAt: 1 })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValue({ url: NEXT_LINK, expiresAt: 2 });
    const tab = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValueOnce(tab).mockReturnValueOnce(null);
    const { rerender } = render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);
    await screen.findByTitle('Launch brief');
    let pending;
    act(() => { pending = headerProps.current.actions.onOpenInBrowserTab(); });
    // A second click is blocked, so this artifact has a notice before the switch.
    await act(async () => { await headerProps.current.actions.onOpenInBrowserTab(); });
    expect(await screen.findByText(/The browser blocked the new tab\./)).toBeInTheDocument();
    const other = {
      ...linked,
      id: 'bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb',
      title: 'Other brief',
      path: '/artifacts/other/index.html',
      canonicalPath: '/artifacts/other/index.html',
      draftUrl: '/api/v1/artifacts/drafts/proj-1/bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb/index.html',
    };
    rerender(<ArtifactViewer open artifact={other} onClose={vi.fn()} />);
    await screen.findByTitle('Other brief');
    expect(screen.queryByText(/The browser blocked the new tab\./)).not.toBeInTheDocument();

    await act(async () => {
      rejectFirst(Object.assign(new Error('Draft links are not available'), { status: 404 }));
      await pending;
    });

    expect(screen.queryByText('Draft links are not available (HTTP 404)')).not.toBeInTheDocument();
    expect(screen.getByTitle('Other brief')).toBeInTheDocument();
  });

  it('accepts a draft host in any case and with its default port', async () => {
    createDraftLink.mockResolvedValue({
      url: 'https://DRAFT-STAGING.mindshub.co:443/_t/v1.a.b/index.html',
      expiresAt: 1,
    });

    render(<ArtifactViewer open artifact={linked} onClose={vi.fn()} />);

    const frame = await screen.findByTitle('Launch brief');
    expect(frame.getAttribute('src')).toMatch(/^https:\/\/draft-staging\.mindshub\.co\/_t\/v1\.a\.b\/index\.html\?/);
  });
});

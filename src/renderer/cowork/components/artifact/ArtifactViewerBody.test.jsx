import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sourceEditor = vi.hoisted(() => ({ props: null }));
vi.mock('./workspace/ArtifactSourceEditor', () => ({
  ArtifactSourceEditor: (props) => {
    if (props.active) sourceEditor.props = props;
    return <div data-testid="source-editor">Editor</div>;
  },
}));
const comparison = vi.hoisted(() => ({ props: null }));
vi.mock('./workspace/ArtifactComparison', () => ({
  ArtifactComparison: (props) => { comparison.props = props; return null; },
}));
const commentsChrome = vi.hoisted(() => ({ panel: null, toolbar: null }));
vi.mock('./comments', () => ({
  CommentsPanel: (props) => { commentsChrome.panel = props; return <div data-testid="comments-inbox" />; },
  CommentsToolbar: (props) => { commentsChrome.toolbar = props; return <div data-testid="comments-toolbar" />; },
}));
const statsPanel = vi.hoisted(() => ({ props: null }));
vi.mock('./stats/StatsPanel', () => ({
  StatsPanel: (props) => {
    statsPanel.props = props;
    return <div data-testid="stats-panel" />;
  },
}));
vi.mock('./workspace/TextSelectionComment', () => ({
  TextSelectionComment: () => <div data-testid="text-selection-comment" />,
}));

import { ArtifactViewerBody } from './ArtifactViewerBody';
import { host } from '../../../platform/host';

function renderBody(
  mode, previewOverrides = {}, workspaceOverrides = {}, stats = undefined, reviewOverrides = {}, layers = null,
) {
  const workspace = {
    mode,
    source: {
      artifactId: 'artifact-1',
      path: 'deck.html',
      contentType: 'html',
    },
    draft: '<h1>Deck</h1>',
    setDraft: vi.fn(),
    save: vi.fn(),
    status: 'ready',
    capabilities: { canAddressWithAgent: true },
    comparison: null,
    repair: null,
    setComparison: vi.fn(),
    restoreRevision: vi.fn(),
    decideRepair: vi.fn(),
    load: vi.fn(),
    ...workspaceOverrides,
  };
  const preview = {
    draftUrl: '/drafts/deck.html',
    error: '',
    setError: vi.fn(),
    isText: false,
    loading: false,
    text: null,
    textContentRef: { current: null },
    captureTextSelection: vi.fn(),
    textExtension: '.html',
    artifact: { path: '/artifacts/deck.html' },
    csv: null,
    onDownload: vi.fn(),
    onOpenOS: vi.fn(),
    url: 'about:blank#deck-preview',
    kind: 'static',
    iframeRef: { current: null },
    title: 'Deck preview',
    iframeReady: true,
    setIframeReady: vi.fn(),
    onReload: vi.fn(),
    ...previewOverrides,
  };
  const review = {
    layer: {
      onIframeLoad: vi.fn(),
      anchorStates: {},
      hlOn: vi.fn(),
      hlOff: vi.fn(),
      focus: vi.fn(),
    },
    open: false,
    enabled: false,
    inboxOpen: false,
    setInboxOpen: vi.fn(),
    markersShown: true,
    setMarkersShown: vi.fn(),
    onToggle: vi.fn(),
    userDir: '',
    reportId: '',
    controller: { threads: [], setStatus: vi.fn().mockResolvedValue(true) },
    onAddressWithAgent: vi.fn(),
    onCreate: vi.fn(),
    textSelection: null,
    setTextSelection: vi.fn(),
    ...reviewOverrides,
  };

  return <ArtifactViewerBody
    layers={layers}
    workspace={workspace}
    preview={preview}
    review={review}
    stats={stats}
    agentReview={{ busy: false, setBusy: vi.fn() }}
  />;
}

describe('ArtifactViewerBody HTML mode retention', () => {
  let idleCallback;

  beforeEach(() => {
    idleCallback = null;
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
      idleCallback = callback;
      return 1;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prepares the visual editor after preview paint and swaps modes without remounting', () => {
    const { rerender } = render(renderBody('preview'));
    const previewFrame = screen.getByTitle('Deck preview');
    expect(screen.queryByTestId('source-editor')).toBeNull();

    act(() => idleCallback());
    const editor = screen.getByTestId('source-editor');
    expect(editor.parentElement.hidden).toBe(true);

    rerender(renderBody('edit'));

    expect(screen.getByTitle('Deck preview')).toBe(previewFrame);
    expect(editor.parentElement.hidden).toBe(false);
    expect(previewFrame.parentElement.hidden).toBe(true);
  });

  // The workspace source loads separately from the preview, so on a slow
  // connection it arrives after the page painted. Recognizing the HTML source
  // must not move the preview into a new parent and reload it (ENG-3070).
  it('keeps the painted preview when the HTML source arrives late', () => {
    const { rerender } = render(renderBody('preview', {}, { source: null }));
    const previewFrame = screen.getByTitle('Deck preview');

    rerender(renderBody('preview'));
    act(() => idleCallback());

    expect(screen.getByTitle('Deck preview')).toBe(previewFrame);
    expect(screen.getByTestId('source-editor').parentElement.hidden).toBe(true);
  });
});

describe('ArtifactViewerBody agent repair decisions', () => {
  const setup = (decideRepair) => {
    const tree = renderBody('preview');
    const workspace = tree.props.workspace;
    workspace.decideRepair = decideRepair;
    workspace.repair = { id: 'repair-1', commentThreadId: 'thread-1' };
    workspace.currentRevision = { id: 'rev-9' };
    return tree;
  };

  it('does not resolve the comment when the decision was ignored', async () => {
    // The whole of ENG-2327: both call sites read a null return as success, so
    // accept closed the review comment for a decision that never happened.
    const tree = setup(vi.fn().mockResolvedValue({ decided: false, reason: 'missing-repair' }));
    render(tree);

    await act(async () => { await comparison.props.onAccept(); });

    expect(tree.props.review.controller.setStatus).not.toHaveBeenCalled();
  });

  it('resolves the comment once the decision has landed', async () => {
    const tree = setup(vi.fn().mockResolvedValue({ decided: true, repair: {} }));
    render(tree);

    await act(async () => { await comparison.props.onAccept(); });

    expect(tree.props.review.controller.setStatus)
      .toHaveBeenCalledWith('thread-1', 'resolved');
  });

  it('holds the dialog open until the restore lands', async () => {
    // It rewrites the artifact, so closing on click left a beat where nothing
    // on screen said the confirm had taken.
    const conflict = Object.assign(new Error('Artifact changed'), { status: 409 });
    let settle;
    const pending = new Promise((resolve) => { settle = resolve; });
    const decideRepair = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockReturnValueOnce(pending);
    const tree = setup(decideRepair);
    render(tree);
    await act(async () => { await comparison.props.onReject(); });

    const confirm = await screen.findByRole('button', { name: /Restore anyway/i });
    await act(async () => { confirm.click(); });

    // Still open while the restore is in flight.
    expect(screen.getByText(/discard everything written since/i)).toBeTruthy();

    await act(async () => { settle({ decided: true }); await pending; });

    expect(screen.queryByText(/discard everything written since/i)).toBeNull();
  });

  it('keeps a failed restore in the dialog that asked for it', async () => {
    const conflict = Object.assign(new Error('Artifact changed'), { status: 409 });
    const second = Object.assign(new Error('This artifact changed after the agent edit'), { status: 409 });
    const decideRepair = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(second);
    const tree = setup(decideRepair);
    render(tree);
    await act(async () => { await comparison.props.onReject(); });

    const confirm = await screen.findByRole('button', { name: /Restore anyway/i });
    await act(async () => { confirm.click(); });

    expect(screen.getByText(/changed after the agent edit/i)).toBeTruthy();
    expect(screen.getByText(/discard everything written since/i)).toBeTruthy();
  });

  it('asks before restoring over work written after the agent edit', async () => {
    const conflict = Object.assign(new Error('Artifact changed'), { status: 409 });
    const decideRepair = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue({ decided: true });
    const tree = setup(decideRepair);
    render(tree);

    await act(async () => { await comparison.props.onReject(); });

    // The first attempt carries no confirmed head, so the server refuses it.
    expect(decideRepair).toHaveBeenCalledWith('rejected');
    expect(await screen.findByText(/discard everything written since/i)).toBeTruthy();
  });
});

describe('ArtifactViewerBody stats panel', () => {
  const controller = {
    data: { total_views: 1 },
    loading: false,
    error: null,
    trackingBusy: false,
    reload: vi.fn(),
    setTracking: vi.fn(),
  };

  it('docks the Stats panel beside the stage while it is open', () => {
    const onClose = vi.fn();
    render(renderBody('preview', {}, {}, {
      open: true,
      controller,
      accessMode: 'restricted',
      accessLoaded: true,
      onClose,
    }));

    expect(screen.getByTestId('stats-panel')).toBeInTheDocument();
    expect(statsPanel.props).toMatchObject({
      data: controller.data,
      loading: false,
      error: null,
      trackingBusy: false,
      accessMode: 'restricted',
      accessLoaded: true,
      onRetry: controller.reload,
      onToggleTracking: controller.setTracking,
      onClose,
    });
  });

  it('renders no Stats panel while it is closed', () => {
    render(renderBody('preview', {}, {}, {
      open: false,
      controller,
      accessMode: 'public',
      accessLoaded: false,
      onClose: vi.fn(),
    }));

    expect(screen.queryByTestId('stats-panel')).toBeNull();
  });

  it('keeps the text selection composer away from the Stats panel', () => {
    const selection = { quote: 'Deck', start: 0, end: 4 };
    const stats = { open: false, controller, accessMode: 'public', accessLoaded: true, onClose: vi.fn() };
    // The composer belongs to Comments being on.
    const { rerender } = render(renderBody('review', {}, {}, stats, { textSelection: selection, open: true }));
    expect(screen.getByTestId('text-selection-comment')).toBeInTheDocument();

    rerender(renderBody('review', {}, {}, { ...stats, open: true }, { textSelection: selection, open: true }));
    expect(screen.getByTestId('stats-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('text-selection-comment')).toBeNull();
  });
});

// The Comments toggle opens the toolbar pill and the inbox together, and
// closing either one turns Comments off, the toggle included.
describe('ArtifactViewerBody comments chrome', () => {
  const commentsOn = {
    open: true, enabled: true, inboxOpen: true, userDir: 'u', reportId: 'r',
  };

  it('shows the toolbar with the inbox', () => {
    render(renderBody('preview', {}, {}, undefined, commentsOn));

    expect(screen.getByTestId('comments-inbox')).toBeInTheDocument();
    expect(screen.getByTestId('comments-toolbar')).toBeInTheDocument();
    expect(commentsChrome.toolbar).not.toHaveProperty('onToggleInbox');
  });

  it('turns Comments off from the inbox close', () => {
    const onToggle = vi.fn();
    render(renderBody('preview', {}, {}, undefined, { ...commentsOn, onToggle }));

    act(() => commentsChrome.panel.onClose());

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('switches comment placement from the Navigate / Comment pill', () => {
    const setPlacing = vi.fn();
    render(renderBody('preview', {}, {}, undefined, {
      ...commentsOn,
      layer: { onIframeLoad: vi.fn(), anchorStates: {}, hlOn: vi.fn(), hlOff: vi.fn(), focus: vi.fn(), setPlacing, mode: false },
    }));

    act(() => commentsChrome.toolbar.onChangeMode(true));

    expect(setPlacing).toHaveBeenCalledWith(true);
  });
});

// One side panel for Live edit, the inbox and Stats (ENG-4455): it stays
// mounted while any is open and swaps only its content, sliding in with the
// first and out with the last.
describe('ArtifactViewerBody side panel', () => {
  afterEach(() => vi.useRealTimers());

  const commentsOn = { open: true, enabled: true, inboxOpen: true, userDir: 'u', reportId: 'r' };
  const statsController = { data: null, loading: true, error: null, reload: vi.fn(), setTracking: vi.fn() };
  const statsOn = { open: true, controller: statsController, accessMode: 'public', accessLoaded: true, onClose: vi.fn() };
  const panel = () => screen.getByTestId('viewer-side-panel');

  it('keeps the same panel across Comments, Stats and Live edit, swapping only its content', () => {
    const view = render(renderBody('preview', {}, {}, undefined, commentsOn));
    const node = panel();
    expect(node).toHaveAttribute('data-mode', 'comments');
    expect(within(node).getByTestId('comments-inbox')).toBeInTheDocument();

    view.rerender(renderBody('preview', {}, {}, statsOn, {}));
    expect(panel()).toBe(node);
    expect(node).toHaveAttribute('data-mode', 'stats');
    expect(node).not.toHaveClass('is-leaving');
    expect(within(node).getByTestId('stats-panel')).toBeInTheDocument();
    expect(within(node).queryByTestId('comments-inbox')).toBeNull();

    view.rerender(renderBody('edit'));
    expect(panel()).toBe(node);
    expect(node).toHaveAttribute('data-mode', 'source');
    expect(within(node).getByTestId('live-edit-slot')).toBeInTheDocument();
    expect(within(node).queryByTestId('stats-panel')).toBeNull();
  });

  it('slides out with what it held when the last panel closes', () => {
    vi.useFakeTimers();
    const view = render(renderBody('preview', {}, {}, undefined, commentsOn));
    expect(panel()).not.toHaveClass('is-leaving');

    view.rerender(renderBody('preview', {}, {}, undefined, { ...commentsOn, open: false, inboxOpen: false }));
    expect(panel()).toHaveClass('is-leaving');
    expect(screen.getByTestId('comments-inbox')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(160); });
    expect(screen.queryByTestId('viewer-side-panel')).toBeNull();
  });

  it('gives the editor the Live edit panel to render its controls into', () => {
    const onExitSource = vi.fn();
    render(renderBody('preview', {}, {}, undefined, {}, { source: true, onExitSource, editActions: null }));

    const slot = screen.getByTestId('live-edit-slot');
    expect(panel()).toContainElement(slot);
    expect(sourceEditor.props.controlsTarget).toBe(slot);

    act(() => { screen.getByRole('button', { name: 'Close Live edit panel' }).click(); });
    expect(onExitSource).toHaveBeenCalledTimes(1);
  });

  it('shows no panel on the plain preview', () => {
    render(renderBody('preview'));
    expect(screen.queryByTestId('viewer-side-panel')).toBeNull();
  });
});

describe('ArtifactViewerBody published app preview', () => {
  const PAGE = 'https://f5h8n2w6-staging.mindshub.test/_t/v1.p.s/';
  const PUBLISHED = 'https://view.staging.mindshub.ai/a/k3m7q2xwp6n4tahd5rzc2bvy7e/';

  it("gives the app's frame what the published page's frame has", () => {
    render(renderBody('preview', { kind: 'published', url: PAGE }));
    const frame = screen.getByTitle('Deck preview');
    expect(frame.getAttribute('sandbox').split(' ')).toEqual([
      'allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups',
      'allow-popups-to-escape-sandbox', 'allow-modals', 'allow-downloads',
    ]);
    expect(frame.getAttribute('allow')).toBe('fullscreen; clipboard-write; autoplay');
  });

  it('gives other previews no allow attribute and their old sandbox', () => {
    render(renderBody('preview', { kind: 'static' }));
    const frame = screen.getByTitle('Deck preview');
    expect(frame.getAttribute('allow')).toBeNull();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-forms allow-modals');
  });

  it('offers a reload and the published page when the preview may load later', () => {
    const openExternal = vi.spyOn(host, 'openExternal').mockImplementation(() => {});
    const onReload = vi.fn();
    render(renderBody('preview', {
      error: "The app's preview couldn't load. Try again in a moment.",
      publishedFailure: { reason: 'retry', url: PUBLISHED },
      onReload,
    }));
    expect(screen.getByText("The app's preview couldn't load. Try again in a moment.")).toBeInTheDocument();
    screen.getByRole('button', { name: /Reload preview/ }).click();
    expect(onReload).toHaveBeenCalledOnce();
    screen.getByRole('button', { name: /Open the published page/ }).click();
    expect(openExternal).toHaveBeenCalledWith(PUBLISHED);
    openExternal.mockRestore();
  });

  it('offers only the published page when a reload would not help', () => {
    render(renderBody('preview', {
      error: "You don't have access to this app's published page.",
      publishedFailure: { reason: 'no_access', url: PUBLISHED },
    }));
    expect(screen.queryByRole('button', { name: /Reload preview/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Open the published page/ })).toBeInTheDocument();
  });

  it('covers the frame with a reload once the session has ended, and takes the frame out of input', () => {
    const onReload = vi.fn();
    render(renderBody('preview', { kind: 'published', url: PAGE, sessionEnded: true, onReload }));
    expect(screen.getByText("This preview's session has ended. Reload to keep using the app.")).toBeInTheDocument();
    expect(screen.getByTestId('published-session-ended')).toBeInTheDocument();
    expect(screen.getByTitle('Deck preview').hasAttribute('inert')).toBe(true);
    const reload = screen.getByRole('button', { name: /Reload preview/ });
    expect(document.activeElement).toBe(reload);
    reload.click();
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('moves focus to Reload when it was on the page body', () => {
    render(renderBody('preview', { kind: 'published', url: PAGE, sessionEnded: true }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Reload preview/ }));
  });

  it('moves focus to Reload when it was in the frame', () => {
    const iframeRef = { current: null };
    const { rerender } = render(renderBody('preview', { kind: 'published', url: PAGE, sessionEnded: false, iframeRef }));
    const frame = screen.getByTitle('Deck preview');
    frame.focus();
    expect(document.activeElement).toBe(frame);
    rerender(renderBody('preview', { kind: 'published', url: PAGE, sessionEnded: true, iframeRef }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Reload preview/ }));
  });

  it('keeps focus in an input outside the frame when the overlay mounts', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      const iframeRef = { current: null };
      const { rerender } = render(renderBody('preview', { kind: 'published', url: PAGE, sessionEnded: false, iframeRef }));
      input.focus();
      rerender(renderBody('preview', { kind: 'published', url: PAGE, sessionEnded: true, iframeRef }));
      expect(screen.getByTestId('published-session-ended')).toBeInTheDocument();
      expect(document.activeElement).toBe(input);
    } finally {
      input.remove();
    }
  });

  it('leaves the frame live while the session runs', () => {
    render(renderBody('preview', { kind: 'published', url: PAGE, sessionEnded: false }));
    expect(screen.getByTitle('Deck preview').hasAttribute('inert')).toBe(false);
  });
});

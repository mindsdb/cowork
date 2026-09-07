import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./workspace/ArtifactSourceEditor', () => ({
  ArtifactSourceEditor: () => <div data-testid="source-editor">Editor</div>,
}));
const comparison = vi.hoisted(() => ({ props: null }));
vi.mock('./workspace/ArtifactComparison', () => ({
  ArtifactComparison: (props) => { comparison.props = props; return null; },
}));
vi.mock('./comments', () => ({
  CommentsPanel: () => null,
  CommentsToolbar: () => null,
}));
vi.mock('./workspace/TextSelectionComment', () => ({
  TextSelectionComment: () => null,
}));

import { ArtifactViewerBody } from './ArtifactViewerBody';

function renderBody(mode, previewOverrides = {}) {
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
  };

  return <ArtifactViewerBody
    workspace={workspace}
    preview={preview}
    review={review}
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

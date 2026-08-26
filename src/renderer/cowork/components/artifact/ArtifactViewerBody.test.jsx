import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./workspace/ArtifactSourceEditor', () => ({
  ArtifactSourceEditor: () => <div data-testid="source-editor">Editor</div>,
}));
vi.mock('./workspace/ArtifactComparison', () => ({
  ArtifactComparison: () => null,
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
    controller: { threads: [] },
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

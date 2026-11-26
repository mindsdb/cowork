// ENG-4684: an inline artifact's live page in its chat card. The page loads
// through the viewer's loader (mocked here: htmlPreviewSource.test.js and the
// viewer's draft-preview suites cover it), so this covers what the inline
// frame adds: its sandbox, its height, the theme it is told, and when it is
// mounted at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const loadHtmlPreview = vi.fn();
vi.mock('./htmlPreviewSource', () => ({
  loadHtmlPreview: (...a) => loadHtmlPreview(...a),
  loadHtmlRevision: vi.fn(async () => ({ doc: '<p>chart then</p>' })),
  usesDraftLink: () => false,
  withdrawDraftLinks: vi.fn(async () => false),
}));

import {
  ArtifactInlinePreview,
  INLINE_MAX_HEIGHT,
  INLINE_MIN_HEIGHT,
  INLINE_SANDBOX,
  clampInlineHeight,
} from './ArtifactInlinePreview';
import { PREVIEW_PARENT_SOURCE } from './usePreviewView';
import { widgetsOnScreen } from '../../lib/voice/screenWidgets';

const artifact = {
  title: 'Revenue by month',
  path: '/proj/.anton/artifacts/revenue-1a2b/index.html',
  ext: '.html',
  display: 'inline',
  mtime: 42,
};

// happy-dom has no IntersectionObserver: install one the test drives.
let observers = [];
class FakeObserver {
  constructor(cb, options) { this.cb = cb; this.options = options; observers.push(this); }
  observe(el) { this.el = el; }
  disconnect() { this.disconnected = true; }
}
const setInView = (inView) => act(() => {
  observers.filter((o) => !o.disconnected).forEach((o) => o.cb([{ isIntersecting: inView, target: o.el }]));
});

const frame = () => screen.getByTitle('Revenue by month');
const box = () => screen.getByTestId('artifact-inline-preview');
const fromWindow = (source, data) => act(() => {
  window.dispatchEvent(new MessageEvent('message', { data, source }));
});

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  loadHtmlPreview.mockReset();
  loadHtmlPreview.mockResolvedValue({ kind: 'static', url: '', doc: '<p>chart</p>', port: null, expiresAt: null });
  document.body.dataset.theme = 'light';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.body.dataset.theme;
});

describe('clampInlineHeight', () => {
  it('keeps a reported height inside the inline range', () => {
    expect(clampInlineHeight(300.2)).toBe(301);
    expect(clampInlineHeight(20)).toBe(INLINE_MIN_HEIGHT);
    expect(clampInlineHeight(5000)).toBe(INLINE_MAX_HEIGHT);
  });

  it('ignores a report that is not a sane height', () => {
    expect(clampInlineHeight(0)).toBeNull();
    expect(clampInlineHeight(-4)).toBeNull();
    expect(clampInlineHeight('300')).toBeNull();
    expect(clampInlineHeight(Number.NaN)).toBeNull();
    expect(clampInlineHeight(1e9)).toBeNull();
  });
});

describe('ArtifactInlinePreview', () => {
  it('loads and mounts nothing until the card is near the viewport', async () => {
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} />);
    expect(loadHtmlPreview).not.toHaveBeenCalled();
    expect(screen.queryByTitle('Revenue by month')).toBeNull();

    setInView(true);
    await waitFor(() => expect(frame()).toBeInTheDocument());
    expect(loadHtmlPreview).toHaveBeenCalledTimes(1);
    expect(loadHtmlPreview.mock.calls[0][0]).toMatchObject({
      artifact,
      actionPath: artifact.path,
      hasActionPath: true,
      cacheVersion: '42',
    });
  });

  it('frames the page with scripts only: no same-origin, popups, forms or modals', async () => {
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} />);
    setInView(true);
    await waitFor(() => expect(frame()).toBeInTheDocument());
    expect(INLINE_SANDBOX).toBe('allow-scripts');
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame().getAttribute('srcdoc')).toBe('<p>chart</p>');
  });

  it('navigates the frame when the loader hands back a URL', async () => {
    loadHtmlPreview.mockResolvedValue({ kind: 'static', url: 'about:blank#inline-42', doc: '', port: null, expiresAt: null });
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} />);
    setInView(true);
    await waitFor(() => expect(frame()).toHaveAttribute('src', 'about:blank#inline-42'));
    expect(frame()).not.toHaveAttribute('srcdoc');
  });

  it('tells the page the theme on load and again when the app theme changes', async () => {
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} />);
    setInView(true);
    await waitFor(() => expect(frame()).toBeInTheDocument());
    const post = vi.spyOn(frame().contentWindow, 'postMessage');

    fireEvent.load(frame());
    expect(post).toHaveBeenCalledWith({ source: PREVIEW_PARENT_SOURCE, type: 'theme', mode: 'light' }, '*');

    post.mockClear();
    await act(async () => { document.body.dataset.theme = 'dark'; });
    await waitFor(() => expect(post).toHaveBeenCalledWith({ source: 'anton-preview-parent', type: 'theme', mode: 'dark' }, '*'));
  });

  it('grows to the height its own page reports, clamped', async () => {
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} />);
    setInView(true);
    await waitFor(() => expect(frame()).toBeInTheDocument());
    expect(box().style.height).toBe(`${INLINE_MIN_HEIGHT}px`);

    const own = frame().contentWindow;
    fromWindow(own, { source: 'anton-preview', type: 'size', height: 160, content: 342, locked: false });
    expect(box().style.height).toBe('342px');

    fromWindow(own, { source: 'anton-preview', type: 'size', height: 342, content: 9000, locked: false });
    expect(box().style.height).toBe(`${INLINE_MAX_HEIGHT}px`);
  });

  it('ignores a size report from any window but its own frame', async () => {
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} />);
    setInView(true);
    await waitFor(() => expect(frame()).toBeInTheDocument());

    fromWindow(window, { source: 'anton-preview', type: 'size', height: 160, content: 500 });
    fromWindow(null, { source: 'anton-preview', type: 'size', height: 160, content: 500 });
    // Right window, wrong channel.
    fromWindow(frame().contentWindow, { source: 'someone-else', type: 'size', height: 160, content: 500 });
    expect(box().style.height).toBe(`${INLINE_MIN_HEIGHT}px`);
  });

  it('unmounts far from the viewport, keeps its height, and reuses the page on return', async () => {
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} />);
    setInView(true);
    await waitFor(() => expect(frame()).toBeInTheDocument());
    fromWindow(frame().contentWindow, { source: 'anton-preview', type: 'size', height: 160, content: 400 });

    setInView(false);
    expect(screen.queryByTitle('Revenue by month')).toBeNull();
    expect(box().style.height).toBe('400px');

    setInView(true);
    await waitFor(() => expect(frame()).toBeInTheDocument());
    expect(loadHtmlPreview).toHaveBeenCalledTimes(1);
  });

  it('hands up where the user is in its own page, for Preview to open on', async () => {
    const onView = vi.fn();
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} onView={onView} />);
    setInView(true);
    await waitFor(() => expect(frame()).toBeInTheDocument());
    const view = { source: 'anton-preview', type: 'view', hash: '#slide-3', scrollX: 0, scrollY: 40, inputs: [{ type: 'key', key: 'ArrowRight' }] };
    fromWindow(window, view);
    expect(onView).not.toHaveBeenCalledWith(expect.objectContaining({ hash: '#slide-3' }));
    fromWindow(frame().contentWindow, view);
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({
      hash: '#slide-3', scrollY: 40, inputs: [{ type: 'key', key: 'ArrowRight', shiftKey: false }],
    }));
  });

  it('says why when the page cannot be loaded', async () => {
    loadHtmlPreview.mockRejectedValue(Object.assign(new Error('Could not load the draft.'), { stage: 'draft' }));
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} />);
    setInView(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the draft.');
    expect(screen.queryByTitle('Revenue by month')).toBeNull();
  });
});

// ENG-4684: a voice call's operator sees the live frame while it is mounted.
describe('ArtifactInlinePreview on screen for the voice operator', () => {
  it('registers the live frame with its page text and Submit, and only while mounted', async () => {
    const widget = { ...artifact, display: 'widget' };
    const { unmount } = render(<ArtifactInlinePreview artifact={widget} title={widget.title} onSubmit={vi.fn()} />);
    expect(widgetsOnScreen()).toEqual([]);
    setInView(true);
    await screen.findByTitle('Revenue by month');
    expect(widgetsOnScreen()).toEqual([
      expect.objectContaining({ title: 'Revenue by month', display: 'widget', excerpt: 'chart', submittable: true }),
    ]);
    unmount();
    expect(widgetsOnScreen()).toEqual([]);
  });

  it('leaves out a frame showing an earlier revision', async () => {
    render(<ArtifactInlinePreview artifact={artifact} title={artifact.title} revisionId="rev-1" />);
    setInView(true);
    await screen.findByTitle('Revenue by month');
    expect(widgetsOnScreen()).toEqual([]);
  });
});

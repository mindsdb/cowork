import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useArtifactCommentLayer } from './useArtifactCommentLayer';

// A harness, not a mock: a srcdoc-loaded iframe's contentWindow is exactly
// what the real draft preview hands this hook now that ArtifactViewer's
// draft-HTML branch renders the fetched document via `srcdoc` instead of
// navigating `src` (docs/artifact-collaboration-workflow/
// task-org-draft-preview-401.md). The bridge's trust check keys on
// `ev.source === iframe.contentWindow`, never on origin — an opaque srcdoc
// origin must not change that.
function Harness({ threads }) {
  const iframeRef = useRef(null);
  useArtifactCommentLayer(iframeRef, { threads, viewer: { id: 'u1' }, enabled: true });
  return <iframe ref={iframeRef} title="Draft preview" srcDoc="<html></html>" />;
}

/* The comment layer with no iframe mounted, as a text, image or document
   preview has it. */
function FramelessHarness({ handlers }) {
  const iframeRef = useRef(null);
  useArtifactCommentLayer(iframeRef, { threads: [], viewer: { id: 'u1' }, enabled: true, ...handlers });
  return null;
}

describe('useArtifactCommentLayer postMessage bridge', () => {
  it('answers a ready announcement from a srcdoc iframe with the current thread list', () => {
    const threads = [{ id: 't1', status: 'open', created_at: '2026-01-01T00:00:00Z' }];
    render(<Harness threads={threads} />);
    const frame = screen.getByTitle('Draft preview');
    const postMessageSpy = vi.spyOn(frame.contentWindow, 'postMessage');

    fireEvent(window, new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'anton-comments', type: 'ready' },
    }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'anton-comments',
        type: 'list',
        comments: [expect.objectContaining({ id: 't1' })],
      }),
      '*',
    );
  });

  it('ignores a same-shaped message whose source is not this iframe', () => {
    const threads = [{ id: 't1', status: 'open', created_at: '2026-01-01T00:00:00Z' }];
    render(<Harness threads={threads} />);
    const frame = screen.getByTitle('Draft preview');
    const postMessageSpy = vi.spyOn(frame.contentWindow, 'postMessage');

    fireEvent(window, new MessageEvent('message', {
      source: window,
      data: { source: 'anton-comments', type: 'ready' },
    }));

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('ignores create, delete and status messages from a foreign window when no iframe is mounted', () => {
    const handlers = { onCreate: vi.fn(), onDeleteThread: vi.fn(), onStatus: vi.fn() };
    render(<FramelessHarness handlers={handlers} />);
    const foreign = { postMessage: vi.fn() };

    for (const data of [
      { source: 'anton-comments', type: 'create', selector: '#total', text: 'Change this' },
      { source: 'anton-comments', type: 'delete', id: 't1' },
      { source: 'anton-comments', type: 'status', id: 't1', status: 'resolved' },
    ]) {
      fireEvent(window, new MessageEvent('message', { source: foreign, data }));
      fireEvent(window, new MessageEvent('message', { source: null, data }));
    }

    expect(handlers.onCreate).not.toHaveBeenCalled();
    expect(handlers.onDeleteThread).not.toHaveBeenCalled();
    expect(handlers.onStatus).not.toHaveBeenCalled();
  });
});

// Images (ENG-4410): the layer's pasted Files reach the viewer checked, and
// the images the threads name are read here and pushed down as Blobs.
describe('useArtifactCommentLayer images', () => {
  const ID = '0123456789abcdef0123456789abcdef.png';

  function ImageHarness({ threads = [], handlers = {}, loadImage = null }) {
    const iframeRef = useRef(null);
    useArtifactCommentLayer(iframeRef, {
      threads, viewer: { id: 'u1' }, enabled: true, markersVisible: true, loadImage, ...handlers,
    });
    return <iframe ref={iframeRef} title="Draft preview" srcDoc="<html></html>" />;
  }

  const fromLayer = (frame, data) => fireEvent(window, new MessageEvent('message', {
    source: frame.contentWindow,
    data: { source: 'anton-comments', ...data },
  }));

  it('hands a create its images, keeping only raster images within the limits', () => {
    const onCreate = vi.fn();
    render(<ImageHarness handlers={{ onCreate }} />);
    const frame = screen.getByTitle('Draft preview');
    const png = new File(['png'], 'shot.png', { type: 'image/png' });
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });

    fromLayer(frame, { type: 'create', selector: '#a', text: 'see', images: [png, svg, 'not a file'] });

    expect(onCreate).toHaveBeenCalledWith({ selector: '#a', text: 'see', images: [png] });
  });

  it('hands a reply its images', () => {
    const onReply = vi.fn();
    render(<ImageHarness handlers={{ onReply }} />);
    const frame = screen.getByTitle('Draft preview');
    const png = new File(['png'], 'shot.png', { type: 'image/png' });

    fromLayer(frame, { type: 'reply', id: 't1', text: '', images: [png] });

    expect(onReply).toHaveBeenCalledWith('t1', '', [png]);
  });

  it('reads the images the threads name and pushes them to the layer', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const loadImage = vi.fn(async () => blob);
    const threads = [{
      id: 't1', status: 'open', created_at: '2026-01-01T00:00:00Z',
      payload: { text: `look\n\n![s.png](cowork-image:${ID})`, replies: [] },
    }];
    render(<ImageHarness threads={threads} loadImage={loadImage} />);
    const frame = screen.getByTitle('Draft preview');
    const post = vi.spyOn(frame.contentWindow, 'postMessage');

    await vi.waitFor(() => expect(loadImage).toHaveBeenCalledWith(ID));
    fromLayer(frame, { type: 'ready' });

    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'anton-comments', type: 'images', images: { [ID]: blob } }),
      '*',
    ));
    expect(loadImage).toHaveBeenCalledTimes(1);
  });
});

// Opening Comments from its tab starts in Comment mode (ENG-4455). The page
// reloads with the layer, so the request waits for the layer's 'ready'.
describe('useArtifactCommentLayer enterModeWhenReady', () => {
  function ModeHarness({ onLayer }) {
    const iframeRef = useRef(null);
    onLayer(useArtifactCommentLayer(iframeRef, { threads: [], viewer: { id: 'u1' }, enabled: true }));
    return <iframe ref={iframeRef} title="Draft preview" srcDoc="<html></html>" />;
  }
  const fromFrame = (frame, data) => fireEvent(window, new MessageEvent('message', {
    source: frame.contentWindow,
    data: { source: 'anton-comments', ...data },
  }));
  const modeMessages = (spy) => spy.mock.calls.map(([msg]) => msg.type).filter((type) => type.endsWith('-mode'));

  it('enters Comment mode once the layer is ready, and stops asking once it is in it', () => {
    let layer;
    render(<ModeHarness onLayer={(value) => { layer = value; }} />);
    const frame = screen.getByTitle('Draft preview');
    const spy = vi.spyOn(frame.contentWindow, 'postMessage');

    layer.enterModeWhenReady();
    fromFrame(frame, { type: 'ready' });
    expect(modeMessages(spy)).toEqual(['enter-mode', 'enter-mode']);

    fromFrame(frame, { type: 'mode', active: true });
    fromFrame(frame, { type: 'ready' });
    expect(modeMessages(spy)).toEqual(['enter-mode', 'enter-mode']);
  });

  it('drops the request when the user picks Navigate first', () => {
    let layer;
    render(<ModeHarness onLayer={(value) => { layer = value; }} />);
    const frame = screen.getByTitle('Draft preview');
    const spy = vi.spyOn(frame.contentWindow, 'postMessage');

    layer.enterModeWhenReady();
    layer.setPlacing(false);
    fromFrame(frame, { type: 'ready' });
    expect(modeMessages(spy)).toEqual(['enter-mode', 'exit-mode']);
  });

  it('asks the next page for Comment mode, and nothing of the page going away', () => {
    let layer;
    render(<ModeHarness onLayer={(value) => { layer = value; }} />);
    const frame = screen.getByTitle('Draft preview');
    const spy = vi.spyOn(frame.contentWindow, 'postMessage');

    layer.enterModeOnNextLoad();
    expect(modeMessages(spy)).toEqual([]);

    fromFrame(frame, { type: 'ready' });
    expect(modeMessages(spy)).toEqual(['enter-mode']);
  });
});

import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MIN_FIT_SCALE, usePreviewFit } from './usePreviewFit';

// A page cut off in the preview with nothing to scroll is given the height it
// asks for and scaled to fit (ENG-4455).
function Harness({ onFit, enabled = true, resetKey = 'a' }) {
  const iframeRef = useRef(null);
  onFit(usePreviewFit(iframeRef, { enabled, resetKey }));
  return <div><iframe ref={iframeRef} title="Preview" srcDoc="<html></html>" /></div>;
}

function setup(props = {}) {
  let fit;
  const view = render(<Harness onFit={(value) => { fit = value; }} {...props} />);
  const frame = screen.getByTitle('Preview');
  const send = (data, source = frame.contentWindow) => act(() => {
    fireEvent(window, new MessageEvent('message', { source, data: { source: 'anton-preview', ...data } }));
  });
  return { get fit() { return fit; }, send, view, frame };
}

describe('usePreviewFit', () => {
  it('fits a page taller than its frame that hides its overflow, centred and scaled', () => {
    const t = setup();
    t.send({ type: 'size', width: 1200, height: 600, content: 800, locked: true });

    expect(t.fit.scale).toBeCloseTo(0.75);
    expect(t.fit.style).toEqual({ height: '800px', transform: 'scale(0.75)', transformOrigin: 'top center' });
  });

  it('leaves alone a page that scrolls, one that fits, and one that would be too small to read', () => {
    const t = setup();
    t.send({ type: 'size', width: 1200, height: 600, content: 2000, locked: false });
    expect(t.fit.style).toBeNull();
    t.send({ type: 'size', width: 1200, height: 600, content: 600, locked: true });
    expect(t.fit.style).toBeNull();
    t.send({ type: 'size', width: 1200, height: 600, content: Math.ceil(600 / MIN_FIT_SCALE) + 50, locked: true });
    expect(t.fit.style).toBeNull();
  });

  it('keeps its fit while fitted, and starts over with a new document', () => {
    const t = setup();
    t.send({ type: 'size', width: 1200, height: 600, content: 800, locked: true });
    // Its own report at the fitted height does not move it.
    t.send({ type: 'size', width: 1200, height: 800, content: 900, locked: true });
    expect(t.fit.scale).toBeCloseTo(0.75);

    t.send({ type: 'document-start' });
    expect(t.fit.style).toBeNull();
  });

  it('starts over when the document changes', () => {
    const t = setup();
    t.send({ type: 'size', width: 1200, height: 600, content: 800, locked: true });
    t.view.rerender(<Harness onFit={() => {}} resetKey="b" />);
    t.view.rerender(<Harness onFit={(value) => { Object.assign(t, { latest: value }); }} resetKey="b" />);
    expect(t.latest.style).toBeNull();
  });

  it('hears only its own frame, and only sound numbers', () => {
    const t = setup();
    t.send({ type: 'size', width: 1200, height: 600, content: 800, locked: true }, window);
    expect(t.fit.style).toBeNull();
    t.send({ type: 'size', width: 1200, height: 'tall', content: 800, locked: true });
    t.send({ type: 'size', width: 1200, height: 600, content: Infinity, locked: true });
    t.send({ type: 'size', width: 1200, height: 600, content: 800, locked: 'yes' });
    expect(t.fit.style).toBeNull();
  });

  it('does nothing while off', () => {
    const t = setup({ enabled: false });
    t.send({ type: 'size', width: 1200, height: 600, content: 800, locked: true });
    expect(t.fit.style).toBeNull();
  });
});

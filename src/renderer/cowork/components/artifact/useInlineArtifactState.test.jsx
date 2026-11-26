// ENG-4684: the state bridge of an inline frame. The page's state is saved as
// the artifact's state.json through the editor's source save, handed back to
// each new document, and its Submit reaches the chat.
import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadArtifactSource: vi.fn(),
  saveArtifactSource: vi.fn(),
}));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  canUseArtifactWorkspace: (a) => !!a?.id,
  loadArtifactSource: (...a) => api.loadArtifactSource(...a),
  saveArtifactSource: (...a) => api.saveArtifactSource(...a),
}));

import {
  INLINE_STATE_DEBOUNCE_MS,
  INLINE_STATE_MAX_BYTES,
  clearInlineStateCache,
  latestInlineState,
  saveInlineState,
  serializeInlineState,
  useInlineArtifactState,
} from './useInlineArtifactState';

const artifact = { id: '0123456789abcdef0123456789abcdef', projectId: 'p1', slug: 'budget' };

function Harness({ onSubmit, enabled = true, card = artifact }) {
  const iframeRef = useRef(null);
  useInlineArtifactState(iframeRef, card, { enabled, onSubmit });
  return <iframe ref={iframeRef} title="frame" srcDoc="<p></p>" />;
}

const frameWindow = () => document.querySelector('iframe').contentWindow;
const fromWindow = (source, data) => act(() => {
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'anton-preview', ...data }, source }));
});
const conflict = (id) => Object.assign(new Error('stale'), { status: 409, detail: { currentRevision: { id } } });

beforeEach(() => {
  vi.useFakeTimers();
  clearInlineStateCache();
  api.loadArtifactSource.mockReset();
  api.saveArtifactSource.mockReset();
  api.saveArtifactSource.mockImplementation(async (_a, body) => ({ revision: { id: `after-${body.expectedRevisionId}` } }));
});
afterEach(() => { vi.useRealTimers(); });

describe('serializeInlineState', () => {
  it('is the JSON text, or null past 32 KB or when not JSON-safe', () => {
    expect(serializeInlineState({ a: 1 })).toBe('{"a":1}');
    expect(serializeInlineState(undefined)).toBe('null');
    expect(serializeInlineState('x'.repeat(INLINE_STATE_MAX_BYTES))).toBeNull();
    const loop = {}; loop.self = loop;
    expect(serializeInlineState(loop)).toBeNull();
  });
});

describe('saveInlineState', () => {
  it('saves state.json through the source save, at the revision it knows', async () => {
    await expect(saveInlineState(artifact, '{}', 'r1')).resolves.toBe('after-r1');
    expect(api.saveArtifactSource).toHaveBeenCalledWith(artifact, {
      path: 'state.json', content: '{}', expectedRevisionId: 'r1', summary: 'Inline state',
    });
  });

  it('takes the current revision from a 409 and tries once more', async () => {
    api.saveArtifactSource.mockRejectedValueOnce(conflict('r9'));
    await expect(saveInlineState(artifact, '{}', 'r1')).resolves.toBe('after-r9');
    expect(api.saveArtifactSource).toHaveBeenCalledTimes(2);
    expect(api.saveArtifactSource.mock.calls[1][1].expectedRevisionId).toBe('r9');
  });

  it('gives up after the one retry, and on any other failure', async () => {
    api.saveArtifactSource.mockRejectedValue(conflict('r9'));
    await expect(saveInlineState(artifact, '{}', 'r1')).rejects.toThrow('stale');
    expect(api.saveArtifactSource).toHaveBeenCalledTimes(2);

    api.saveArtifactSource.mockReset();
    api.saveArtifactSource.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    await expect(saveInlineState(artifact, '{}', 'r1')).rejects.toThrow('nope');
    expect(api.saveArtifactSource).toHaveBeenCalledTimes(1);
  });
});

describe('useInlineArtifactState', () => {
  it('saves a burst of state once, after the quiet spell, at the loaded revision', async () => {
    api.loadArtifactSource.mockResolvedValue({ content: '{"n":0}', revision: { id: 'r1' } });
    render(<Harness />);
    const post = vi.spyOn(frameWindow(), 'postMessage');
    fromWindow(frameWindow(), { type: 'document-start' });
    await act(async () => {});
    expect(api.loadArtifactSource).toHaveBeenCalledWith(artifact, 'state.json');
    expect(post).toHaveBeenCalledWith({ source: 'anton-preview-parent', type: 'state', state: { n: 0 } }, '*');

    fromWindow(frameWindow(), { type: 'state', state: { n: 1 } });
    fromWindow(frameWindow(), { type: 'state', state: { n: 2 } });
    await act(async () => { vi.advanceTimersByTime(INLINE_STATE_DEBOUNCE_MS - 1); });
    expect(api.saveArtifactSource).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(api.saveArtifactSource).toHaveBeenCalledTimes(1);
    expect(api.saveArtifactSource.mock.calls[0][1]).toEqual({
      path: 'state.json', content: '{"n":2}', expectedRevisionId: 'r1', summary: 'Inline state',
    });
  });

  it('ignores state from any window but its own frame, and state over 32 KB', async () => {
    render(<Harness />);
    fromWindow(window, { type: 'state', state: { n: 1 } });
    fromWindow(null, { type: 'state', state: { n: 1 } });
    fromWindow(frameWindow(), { type: 'state', state: 'x'.repeat(INLINE_STATE_MAX_BYTES) });
    await act(async () => { vi.advanceTimersByTime(INLINE_STATE_DEBOUNCE_MS * 2); });
    expect(api.saveArtifactSource).not.toHaveBeenCalled();
  });

  it('posts nothing when the artifact has no state.json yet', async () => {
    api.loadArtifactSource.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    render(<Harness />);
    const post = vi.spyOn(frameWindow(), 'postMessage');
    fromWindow(frameWindow(), { type: 'document-start' });
    await act(async () => {});
    expect(post).not.toHaveBeenCalled();
  });

  it('hands a submit to the chat and saves what it sent at once', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fromWindow(frameWindow(), { type: 'submit', state: { budget: 5 }, message: 'Use this' });
    expect(onSubmit).toHaveBeenCalledWith({ state: { budget: 5 }, message: 'Use this' });
    await act(async () => {});
    expect(api.saveArtifactSource).toHaveBeenCalledTimes(1);
    expect(api.saveArtifactSource.mock.calls[0][1].content).toBe('{"budget":5}');

    fromWindow(frameWindow(), { type: 'submit', state: { budget: 6 } });
    expect(onSubmit).toHaveBeenLastCalledWith({ state: { budget: 6 }, message: '' });
  });

  it('submits without saving for a card with no full identity', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} card={{ slug: 'old' }} />);
    fromWindow(frameWindow(), { type: 'document-start' });
    fromWindow(frameWindow(), { type: 'submit', state: [1] });
    await act(async () => { vi.advanceTimersByTime(INLINE_STATE_DEBOUNCE_MS); });
    expect(onSubmit).toHaveBeenCalledWith({ state: [1], message: '' });
    expect(api.loadArtifactSource).not.toHaveBeenCalled();
    expect(api.saveArtifactSource).not.toHaveBeenCalled();
  });

  it('listens to nothing while disabled', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} enabled={false} />);
    fromWindow(frameWindow(), { type: 'submit', state: {} });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// The chat card's frame and the viewer's, side by side on one artifact.
function TwoFrames({ second = true, onSubmit }) {
  const a = useRef(null);
  const b = useRef(null);
  useInlineArtifactState(a, artifact, { enabled: true, onSubmit });
  useInlineArtifactState(b, artifact, { enabled: second });
  return (
    <>
      <iframe ref={a} title="inline" srcDoc="<p></p>" />
      {second && <iframe ref={b} title="viewer" srcDoc="<p></p>" />}
    </>
  );
}
const frames = () => [...document.querySelectorAll('iframe')].map((f) => f.contentWindow);
const stateMessage = (state) => ({ source: 'anton-preview-parent', type: 'state', state });

describe('useInlineArtifactState: shared between frames', () => {
  it('hands a change still in its quiet spell to another frame that starts, over an older state.json', async () => {
    let read;
    api.loadArtifactSource.mockReturnValue(new Promise((resolve) => { read = resolve; }));
    render(<TwoFrames />);
    const [inline, viewer] = frames();
    fromWindow(inline, { type: 'state', state: { picked: ['a', 'b'] } });
    expect(latestInlineState(artifact)).toEqual({ picked: ['a', 'b'] });
    expect(api.saveArtifactSource).not.toHaveBeenCalled();

    const post = vi.spyOn(viewer, 'postMessage');
    fromWindow(viewer, { type: 'document-start' });
    expect(post).toHaveBeenCalledWith(stateMessage({ picked: ['a', 'b'] }), '*');

    // The read comes back with what the server had before: it is not newer.
    await act(async () => { read({ content: '{"picked":[]}', revision: { id: 'r1' } }); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(latestInlineState(artifact)).toEqual({ picked: ['a', 'b'] });
  });

  it('shows a change made in one frame in the other one already open, once', async () => {
    api.loadArtifactSource.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    render(<TwoFrames />);
    const [inline, viewer] = frames();
    const toInline = vi.spyOn(inline, 'postMessage');
    const toViewer = vi.spyOn(viewer, 'postMessage');
    fromWindow(viewer, { type: 'state', state: { tab: 2 } });
    expect(toInline).toHaveBeenCalledWith(stateMessage({ tab: 2 }), '*');
    expect(toViewer).not.toHaveBeenCalled();
    // The inline page echoes it: nothing goes round again, nothing saves twice.
    fromWindow(inline, { type: 'state', state: { tab: 2 } });
    expect(toViewer).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(INLINE_STATE_DEBOUNCE_MS); });
    expect(api.saveArtifactSource).toHaveBeenCalledTimes(1);
  });

  it('takes the read state.json when no frame changed anything', async () => {
    api.loadArtifactSource.mockResolvedValue({ content: '{"n":7}', revision: { id: 'r1' } });
    render(<TwoFrames second={false} />);
    fromWindow(frames()[0], { type: 'document-start' });
    await act(async () => {});
    expect(latestInlineState(artifact)).toEqual({ n: 7 });
  });

  it('hands the state again after a kept place was replayed, from its own frame only', async () => {
    api.loadArtifactSource.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    render(<TwoFrames />);
    const [inline, viewer] = frames();
    fromWindow(inline, { type: 'state', state: { checked: [1] } });
    const post = vi.spyOn(viewer, 'postMessage');
    fromWindow(window, { type: 'view-restored', status: 'ok' });
    expect(post).not.toHaveBeenCalled();
    fromWindow(viewer, { type: 'view-restored', status: 'ok' });
    expect(post).toHaveBeenCalledWith(stateMessage({ checked: [1] }), '*');
  });

  // ENG-4684: Preview flickered without end. Each page set a default as it
  // started and set again whatever it was handed (its render saves), and each
  // frame's report was handed to the other, where it was set again.
  it('does not bounce a state between two frames whose pages set again what they are handed', async () => {
    api.loadArtifactSource.mockResolvedValue({ content: '{"picked":[]}', revision: { id: 'r1' } });
    render(<TwoFrames />);
    const [inline, viewer] = frames();
    // Both pages set again what they are handed, as the shim reports it.
    const queue = [];
    for (const win of [inline, viewer]) {
      vi.spyOn(win, 'postMessage').mockImplementation((data) => {
        if (data?.type === 'state') queue.push([win, { type: 'state', state: data.state, handed: true }]);
      });
    }
    const drain = async () => {
      for (let n = 0; queue.length; n += 1) {
        if (n > 50) throw new Error('the state is bouncing between the frames');
        fromWindow(...queue.shift());
      }
      await act(async () => {});
    };
    fromWindow(inline, { type: 'state', state: { picked: ['li'] }, handed: true });
    await drain();

    // Preview: the viewer's page sets its default before its state reaches it.
    inline.postMessage.mockClear();
    viewer.postMessage.mockClear();
    fromWindow(viewer, { type: 'document-start' });
    fromWindow(viewer, { type: 'state', state: { picked: ['ana', 'li'] }, handed: false });
    await drain();
    await act(async () => { vi.advanceTimersByTime(INLINE_STATE_DEBOUNCE_MS); });
    expect(latestInlineState(artifact)).toEqual({ picked: ['li'] });
    expect(inline.postMessage).not.toHaveBeenCalled();
    expect(viewer.postMessage).toHaveBeenCalledTimes(1);
    expect(viewer.postMessage).toHaveBeenCalledWith(stateMessage({ picked: ['li'] }), '*');
    expect(api.saveArtifactSource.mock.calls.map(([, body]) => body.content)).toEqual(['{"picked":["li"]}']);

    // A tick in the viewer reaches the card, once.
    fromWindow(viewer, { type: 'state', state: { picked: [] }, handed: true });
    await drain();
    expect(inline.postMessage).toHaveBeenCalledTimes(1);
    expect(viewer.postMessage).toHaveBeenCalledTimes(1);
    expect(latestInlineState(artifact)).toEqual({ picked: [] });
  });

  it('lets a default set while state.json is read wait for the read, which wins', async () => {
    let read;
    api.loadArtifactSource.mockReturnValue(new Promise((resolve) => { read = resolve; }));
    render(<Harness />);
    const post = vi.spyOn(frameWindow(), 'postMessage');
    fromWindow(frameWindow(), { type: 'document-start' });
    fromWindow(frameWindow(), { type: 'state', state: { picked: ['all'] }, handed: false });
    expect(latestInlineState(artifact)).toBeUndefined();
    await act(async () => { read({ content: '{"picked":["li"]}', revision: { id: 'r1' } }); });
    expect(post).toHaveBeenCalledWith(stateMessage({ picked: ['li'] }), '*');
    expect(latestInlineState(artifact)).toEqual({ picked: ['li'] });
    await act(async () => { vi.advanceTimersByTime(INLINE_STATE_DEBOUNCE_MS * 2); });
    expect(api.saveArtifactSource).not.toHaveBeenCalled();
  });

  it('keeps a default set while state.json is read when there is none', async () => {
    let fail;
    api.loadArtifactSource.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    render(<Harness />);
    fromWindow(frameWindow(), { type: 'document-start' });
    fromWindow(frameWindow(), { type: 'state', state: { picked: ['all'] }, handed: false });
    await act(async () => { fail(Object.assign(new Error('missing'), { status: 404 })); });
    expect(latestInlineState(artifact)).toEqual({ picked: ['all'] });
    await act(async () => { vi.advanceTimersByTime(INLINE_STATE_DEBOUNCE_MS); });
    expect(api.saveArtifactSource.mock.calls[0][1].content).toBe('{"picked":["all"]}');
  });

  it('saves a submit from a frame with no chat to send it to, and does not throw', async () => {
    render(<TwoFrames />);
    const [, viewer] = frames();
    expect(() => fromWindow(viewer, { type: 'submit', state: { ok: true } })).not.toThrow();
    await act(async () => {});
    expect(api.saveArtifactSource).toHaveBeenCalledTimes(1);
  });
});

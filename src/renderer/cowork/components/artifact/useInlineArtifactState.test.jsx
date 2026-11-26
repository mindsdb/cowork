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

import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { KEEP_PLACE_MS, PREVIEW_PARENT_SOURCE, normalizePreviewView, postPreviewState, postPreviewTheme, usePreviewView } from './usePreviewView';

let hook = null;

function Harness({ resetKey = 'a', scopeKey = 'x' }) {
  const iframeRef = useRef(null);
  const state = usePreviewView(iframeRef, { enabled: true, resetKey, scopeKey });
  hook = state;
  return (
    <>
      <iframe ref={iframeRef} title="Draft preview" srcDoc="<html></html>" />
      <output data-testid="seq">{state.seq}</output>
      <output data-testid="view">{JSON.stringify(state.view)}</output>
    </>
  );
}

function send(source, data) {
  fireEvent(window, new MessageEvent('message', {
    source,
    data: { source: 'anton-preview', ...data },
  }));
}

const VIEW = {
  type: 'view',
  hash: '#slide-3',
  scrollX: 0,
  scrollY: 120,
  container: null,
  inputs: [
    { type: 'key', key: 'ArrowRight', shiftKey: false },
    { type: 'click', path: '#deck/nav:0/button:1', label: 'Next' },
  ],
  overflow: false,
  heading: 'Pricing',
};

const view = () => JSON.parse(screen.getByTestId('view').textContent);

describe('normalizePreviewView', () => {
  it('keeps a well-formed view, field by field', () => {
    expect(normalizePreviewView({ ...VIEW, extra: 'x', source: 'anton-preview' })).toEqual({
      hash: '#slide-3',
      scrollX: 0,
      scrollY: 120,
      container: null,
      inputs: VIEW.inputs,
      overflow: false,
      heading: 'Pricing',
    });
  });

  it('is not a view unless the type says so', () => {
    expect(normalizePreviewView({ ...VIEW, type: 'error' })).toBeNull();
    expect(normalizePreviewView(null)).toBeNull();
    expect(normalizePreviewView('view')).toBeNull();
  });

  it('drops the whole view when one input is malformed', () => {
    // A replay with a step missing would land on the wrong slide.
    for (const bad of [
      { type: 'key', key: 'Delete' },
      { type: 'key', key: 'toString' },
      { type: 'click', path: 'div:0/../button:1' },
      { type: 'click', path: 'div:0/#x' },
      { type: 'click', path: 'a"]:0' },
      { type: 'click', path: 'div:0/'.repeat(40) + 'p:0' },
      { type: 'click', path: 7 },
      { type: 'eval', code: 'x' },
      'ArrowRight',
    ]) {
      expect(normalizePreviewView({ ...VIEW, inputs: [VIEW.inputs[0], bad] })).toBeNull();
    }
  });

  it('caps and coerces every other field', () => {
    const out = normalizePreviewView({
      type: 'view',
      hash: 'no-hash-sign',
      scrollX: -5,
      scrollY: Number.POSITIVE_INFINITY,
      container: { path: '#pane', top: '300', left: 4.6 },
      inputs: [{ type: 'click', path: 'main:0', label: `${'x'.repeat(500)}` }],
      heading: `  Big   ${'h'.repeat(500)} `,
    });
    expect(out.hash).toBe('');
    expect(out.scrollX).toBe(0);
    expect(out.scrollY).toBe(0);
    expect(out.container).toEqual({ path: '#pane', top: 0, left: 5 });
    expect(out.inputs[0].label).toHaveLength(80);
    expect(out.heading).toHaveLength(120);
    expect(out.heading.startsWith('Big h')).toBe(true);
    expect(normalizePreviewView({ ...VIEW, hash: `#${'a'.repeat(600)}` }).hash).toBe('');
  });

  it('replays nothing when the shim ran out of room', () => {
    const many = Array.from({ length: 51 }, () => ({ type: 'key', key: 'ArrowRight' }));
    expect(normalizePreviewView({ ...VIEW, inputs: many })).toMatchObject({ inputs: [], overflow: true });
    expect(normalizePreviewView({ ...VIEW, overflow: true })).toMatchObject({ inputs: [], overflow: true });
  });
});

describe('usePreviewView', () => {
  it('keeps the latest view from the preview frame', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');
    send(frame.contentWindow, VIEW);
    expect(view()).toMatchObject({ hash: '#slide-3', heading: 'Pricing' });
    expect(screen.getByTestId('seq').textContent).toBe('1');

    // The same view again is not a change.
    send(frame.contentWindow, VIEW);
    expect(screen.getByTestId('seq').textContent).toBe('1');
  });

  it('ignores a view from any other window, or without the shim\'s tag', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');
    send(window, VIEW);
    send(null, VIEW);
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: VIEW }));
    expect(view()).toBeNull();
    expect(screen.getByTestId('seq').textContent).toBe('0');
  });

  it('forgets the view when the preview loads a new document', () => {
    const rendered = render(<Harness />);
    const frame = screen.getByTitle('Draft preview');
    send(frame.contentWindow, VIEW);
    send(frame.contentWindow, { type: 'document-start' });
    expect(view()).toBeNull();
    expect(screen.getByTestId('seq').textContent).toBe('2');

    send(frame.contentWindow, VIEW);
    rendered.rerender(<Harness resetKey="b" />);
    expect(view()).toBeNull();
  });
});

// Keeping the place across a reload the viewer makes (ENG-4383).
describe('usePreviewView keepPlace', () => {
  const PLACE = normalizePreviewView(VIEW);
  const setup = () => {
    const rendered = render(<Harness />);
    const frame = screen.getByTitle('Draft preview');
    const post = vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
    const restores = () => post.mock.calls.map(([message]) => message);
    return { rendered, frame, restores };
  };
  const seq = () => screen.getByTestId('seq').textContent;

  it('sends the kept view down to the reloaded document, once, and keeps it', () => {
    const { rendered, frame, restores } = setup();
    send(frame.contentWindow, VIEW);
    act(() => hook.keepPlace());
    // The reload changes the preview URL: the kept place is not dropped.
    rendered.rerender(<Harness resetKey="b" />);
    expect(view()).toEqual(PLACE);

    send(frame.contentWindow, { type: 'document-start' });
    expect(restores()).toEqual([{ source: 'anton-preview-parent', type: 'restore', view: PLACE }]);
    expect(view()).toEqual(PLACE);
    expect(seq()).toBe('1');

    // The shim says it landed, then reports where it is: not a move of the
    // user's, so an open editor keeps its own slide.
    send(frame.contentWindow, { type: 'view-restored', status: 'ok' });
    send(frame.contentWindow, { ...VIEW, scrollY: 140 });
    expect(view().scrollY).toBe(140);
    expect(seq()).toBe('1');

    // A later document (the user's own Reload) starts over.
    send(frame.contentWindow, { type: 'document-start' });
    expect(restores()).toHaveLength(1);
    expect(view()).toBeNull();
  });

  it('restores the editor\'s place when one is passed', () => {
    const { frame, restores } = setup();
    send(frame.contentWindow, VIEW);
    const editor = { ...VIEW, inputs: [], heading: 'Editor slide' };
    act(() => hook.keepPlace(editor));
    send(frame.contentWindow, { type: 'document-start' });
    expect(restores()[0].view).toMatchObject({ inputs: [], heading: 'Editor slide' });
  });

  it('keeps nothing it would not accept from the frame', () => {
    const { frame, restores } = setup();
    act(() => hook.keepPlace({ ...VIEW, inputs: [{ type: 'key', key: 'Delete' }] }));
    send(frame.contentWindow, { type: 'document-start' });
    act(() => hook.keepPlace());
    send(frame.contentWindow, { type: 'document-start' });
    expect(restores()).toEqual([]);
  });

  it('starts over when the restore missed', () => {
    const { frame } = setup();
    send(frame.contentWindow, VIEW);
    act(() => hook.keepPlace());
    send(frame.contentWindow, { type: 'document-start' });
    send(frame.contentWindow, { type: 'view-restored', status: 'mismatch' });
    // The shim reloads its document.
    send(frame.contentWindow, { type: 'document-start' });
    expect(view()).toBeNull();
  });

  it('ignores a restore answer from another window', () => {
    const { frame } = setup();
    send(frame.contentWindow, VIEW);
    act(() => hook.keepPlace());
    send(frame.contentWindow, { type: 'document-start' });
    send(window, { type: 'view-restored', status: 'invalid' });
    expect(view()).toEqual(PLACE);
  });

  it('forgets a kept place on the user\'s own reload, another artifact, or after a while', () => {
    const { rendered, frame, restores } = setup();
    send(frame.contentWindow, VIEW);
    act(() => hook.keepPlace());
    act(() => hook.forgetPlace());
    send(frame.contentWindow, { type: 'document-start' });

    send(frame.contentWindow, VIEW);
    act(() => hook.keepPlace());
    rendered.rerender(<Harness scopeKey="y" />);
    send(frame.contentWindow, { type: 'document-start' });

    send(frame.contentWindow, VIEW);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    act(() => hook.keepPlace());
    clock.mockReturnValue(now + KEEP_PLACE_MS + 1);
    send(frame.contentWindow, { type: 'document-start' });
    clock.mockRestore();

    expect(restores()).toEqual([]);
  });

  it('settles whenRestored once the restore is answered', async () => {
    const { frame } = setup();
    await expect(hook.whenRestored()).resolves.toBeUndefined();
    send(frame.contentWindow, VIEW);
    act(() => hook.keepPlace());
    let done = false;
    hook.whenRestored().then(() => { done = true; });
    send(frame.contentWindow, { type: 'document-start' });
    await Promise.resolve();
    expect(done).toBe(false);
    send(frame.contentWindow, { type: 'view-restored', status: 'ok' });
    await Promise.resolve();
    expect(done).toBe(true);
  });
});

// ENG-4684: the app's theme goes down the same channel as `restore`.
describe('postPreviewTheme', () => {
  it('posts the theme with the parent tag', () => {
    const win = { postMessage: vi.fn() };
    postPreviewTheme(win, 'dark');
    expect(win.postMessage).toHaveBeenCalledWith({ source: PREVIEW_PARENT_SOURCE, type: 'theme', mode: 'dark' }, '*');
    postPreviewTheme(win, 'anything-else');
    expect(win.postMessage).toHaveBeenLastCalledWith({ source: 'anton-preview-parent', type: 'theme', mode: 'light' }, '*');
  });

  it('skips a frame with no window yet', () => {
    expect(() => postPreviewTheme(null, 'dark')).not.toThrow();
    expect(() => postPreviewTheme({}, 'dark')).not.toThrow();
  });
});

// ENG-4684: an inline page's saved state goes down the same channel.
describe('postPreviewState', () => {
  it('posts the state with the parent tag', () => {
    const win = { postMessage: vi.fn() };
    postPreviewState(win, { budget: 1200 });
    expect(win.postMessage).toHaveBeenCalledWith({ source: PREVIEW_PARENT_SOURCE, type: 'state', state: { budget: 1200 } }, '*');
  });

  it('skips a frame with no window yet', () => {
    expect(() => postPreviewState(null, {})).not.toThrow();
    expect(() => postPreviewState({}, {})).not.toThrow();
  });
});

import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { normalizePreviewView, usePreviewView } from './usePreviewView';

function Harness({ resetKey = 'a' }) {
  const iframeRef = useRef(null);
  const state = usePreviewView(iframeRef, { enabled: true, resetKey });
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

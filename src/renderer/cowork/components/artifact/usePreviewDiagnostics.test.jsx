import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePreviewDiagnostics } from './usePreviewDiagnostics';

function Harness({ resetKey = 'a' }) {
  const iframeRef = useRef(null);
  const diagnostics = usePreviewDiagnostics(iframeRef, { enabled: true, resetKey });
  return (
    <>
      <iframe ref={iframeRef} title="Draft preview" srcDoc="<html></html>" />
      <output data-testid="count">{diagnostics.errors.length}</output>
      <output data-testid="first">{diagnostics.errors[0]?.message || ''}</output>
      <output data-testid="dismissed">{String(diagnostics.dismissed)}</output>
      <button type="button" onClick={diagnostics.dismiss}>Dismiss</button>
    </>
  );
}

function send(frame, data) {
  fireEvent(window, new MessageEvent('message', {
    source: frame.contentWindow,
    data: { source: 'anton-preview', ...data },
  }));
}

describe('usePreviewDiagnostics', () => {
  it('keeps an error that arrives before the frame load event', () => {
    // The failure this exists for happens during parse: the reset must key on
    // the shim's document-start, never on the iframe's load.
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'document-start' });
    send(frame, { type: 'error', message: 'SecurityError: localStorage', file: 'a.html', line: 44 });
    fireEvent.load(frame);

    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('clears the list when a new document announces itself', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'error', message: 'old', file: 'a.html', line: 1 });
    send(frame, { type: 'document-start' });

    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('clears the list when the previewed document changes', () => {
    const view = render(<Harness resetKey="a" />);
    const frame = screen.getByTitle('Draft preview');
    send(frame, { type: 'error', message: 'old', file: 'a.html', line: 1 });

    view.rerender(<Harness resetKey="b" />);

    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('ignores a same-shaped message from another window', () => {
    render(<Harness />);
    fireEvent(window, new MessageEvent('message', {
      source: window,
      data: { source: 'anton-preview', type: 'error', message: 'spoof', file: '', line: 0 },
    }));

    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('ignores a message that arrives while the iframe ref is still null', () => {
    // No frame to compare against means no legitimate source for the
    // message, so it must be rejected rather than accepted by default.
    function NoFrameHarness() {
      const iframeRef = useRef(null);
      const diagnostics = usePreviewDiagnostics(iframeRef, { enabled: true, resetKey: 'a' });
      return <output data-testid="count">{diagnostics.errors.length}</output>;
    }
    render(<NoFrameHarness />);

    fireEvent(window, new MessageEvent('message', {
      source: window,
      data: { source: 'anton-preview', type: 'error', message: 'spoof', file: '', line: 0 },
    }));

    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('collapses a repeated error and keeps distinct ones', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'error', message: 'boom', file: 'a.html', line: 1 });
    send(frame, { type: 'error', message: 'boom', file: 'a.html', line: 1 });
    send(frame, { type: 'error', message: 'boom', file: 'a.html', line: 2 });

    expect(screen.getByTestId('count').textContent).toBe('2');
  });

  it('renders a resource failure as a readable sentence', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'resource', tagName: 'SCRIPT', url: 'https://cdn.example/echarts.js' });

    expect(screen.getByTestId('first').textContent)
      .toBe('Failed to load script https://cdn.example/echarts.js');
  });

  it('renders a policy violation as a readable sentence', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'csp', violatedDirective: 'script-src', blockedURI: 'https://cdn.example/x.js' });

    expect(screen.getByTestId('first').textContent)
      .toBe('Blocked by the page security policy (script-src): https://cdn.example/x.js');
  });

  it('ignores a message type outside the known four', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'not-a-real-type', message: 'should not show' });

    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('drops a resource failure with no url instead of showing a bare sentence', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'resource', tagName: 'SCRIPT' });

    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('drops a csp violation with no directive and no blocked URI', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'csp', violatedDirective: '', blockedURI: '' });

    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('caps a message at 300 characters, matching the server cap', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');

    send(frame, { type: 'error', message: 'x'.repeat(500), file: 'a.html', line: 1 });

    expect(screen.getByTestId('first').textContent.length).toBe(300);
  });

  it('keeps the same errors array identity for a burst of document-start on an already-empty list', () => {
    // A page looping postMessage({type:'document-start'}) used to call
    // setErrors([]) unconditionally, allocating a fresh array every time and
    // forcing the whole viewer to re-render on every message. Asserting on
    // identity rather than render count sidesteps React's documented "may
    // still render this one component once before bailing out" nuance for
    // the very first no-op update.
    const seenArrays = [];
    function IdentityHarness() {
      const iframeRef = useRef(null);
      const diagnostics = usePreviewDiagnostics(iframeRef, { enabled: true, resetKey: 'a' });
      seenArrays.push(diagnostics.errors);
      return <iframe ref={iframeRef} title="Identity preview" srcDoc="<html></html>" />;
    }
    render(<IdentityHarness />);
    const frame = screen.getByTitle('Identity preview');
    const baselineIndex = seenArrays.length - 1;
    const baselineArray = seenArrays[baselineIndex];

    send(frame, { type: 'document-start' });
    send(frame, { type: 'document-start' });
    send(frame, { type: 'document-start' });

    // Only what got captured from here on is in scope: mount itself already
    // allocates one array (unrelated to this fix), which is exactly why the
    // baseline is taken after mount rather than compared against it.
    seenArrays.slice(baselineIndex + 1).forEach((arr) => expect(arr).toBe(baselineArray));
  });

  it('stays dismissed across a document-start restart, but not for a new error', () => {
    // document-start is the shim re-announcing the same resetKey (no reload,
    // no save) — a dismissal survives that. A save changes resetKey instead,
    // which is covered separately below and does clear the dismissal.
    render(<Harness />);
    const frame = screen.getByTitle('Draft preview');
    send(frame, { type: 'error', message: 'boom', file: 'a.html', line: 1 });

    act(() => { screen.getByText('Dismiss').click(); });
    expect(screen.getByTestId('dismissed').textContent).toBe('true');

    send(frame, { type: 'document-start' });
    send(frame, { type: 'error', message: 'boom', file: 'a.html', line: 1 });
    expect(screen.getByTestId('dismissed').textContent).toBe('true');

    send(frame, { type: 'error', message: 'another', file: 'a.html', line: 9 });
    expect(screen.getByTestId('dismissed').textContent).toBe('false');
  });

  it('clears a dismissal when resetKey changes, even for the same failure', () => {
    // A save bumps the cache-busting nonce, which changes resetKey — unlike
    // document-start, this is not treated as "the same document restarting".
    const view = render(<Harness resetKey="a" />);
    const frame = screen.getByTitle('Draft preview');
    send(frame, { type: 'error', message: 'boom', file: 'a.html', line: 1 });
    act(() => { screen.getByText('Dismiss').click(); });
    expect(screen.getByTestId('dismissed').textContent).toBe('true');

    view.rerender(<Harness resetKey="b" />);
    send(frame, { type: 'error', message: 'boom', file: 'a.html', line: 1 });

    expect(screen.getByTestId('dismissed').textContent).toBe('false');
  });
});

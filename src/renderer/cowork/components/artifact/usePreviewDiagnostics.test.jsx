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

  it('stays dismissed until a new error appears', () => {
    // The viewer reloads the frame after every save; a banner the user closed
    // must not come back for the same unchanged failure.
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
});

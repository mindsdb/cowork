import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const xterm = vi.hoisted(() => ({ onData: null as ((data: string) => void) | null }));
const api = vi.hoisted(() => ({
  terminal: vi.fn(async () => ({ status: 'running', items: [], first_seq: 0, next_seq: 0 })),
  startTerminal: vi.fn(),
  terminalInput: vi.fn(async (_id: string, _terminalId: string, _data: string) => ({ process_id: 'p1', status: 'running', items: [], first_seq: 0, next_seq: 0 })),
  resizeTerminal: vi.fn(),
  openStream: vi.fn(() => vi.fn()),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    loadAddon() {}
    open() {}
    focus() {}
    attachCustomKeyEventHandler() {}
    onData(handler: (data: string) => void) { xterm.onData = handler; }
    hasSelection() { return false; }
    getSelection() { return ''; }
    write() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('./api', () => ({
  codingApi: api,
  openCodingTerminalStream: api.openStream,
}));

import { TerminalScreen } from './TerminalScreen';


function decodeBase64(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0)));
}

function receivedInput(): string {
  return api.terminalInput.mock.calls.map(([, , data]) => decodeBase64(data)).join('');
}

async function renderScreen(onError = vi.fn()) {
  render(
    <TerminalScreen
      sessionId="task-1"
      terminalId="terminal-1"
      onState={vi.fn()}
      onError={onError}
      isDisconnectExpected={() => false}
    />,
  );
  await waitFor(() => expect(xterm.onData).not.toBeNull());
  return onError;
}


beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockClear());
  xterm.onData = null;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
});


it('delivers fast keystrokes to the shell in order over one request at a time', async () => {
  const settle: Array<() => void> = [];
  api.terminalInput.mockImplementation(() => new Promise((resolve) => {
    settle.push(() => resolve({ process_id: 'p1', status: 'running', items: [], first_seq: 0, next_seq: 0 }));
  }));
  await renderScreen();

  act(() => { for (const character of '0123456789') xterm.onData!(character); });

  expect(api.terminalInput).toHaveBeenCalledTimes(1);
  while (settle.length) {
    await act(async () => { settle.shift()!(); });
  }

  expect(receivedInput()).toBe('0123456789');
  expect(api.terminalInput.mock.calls.length).toBeLessThan(10);
});


it('reports a failed write once and keeps sending later keystrokes', async () => {
  api.terminalInput.mockRejectedValueOnce(new Error('Terminal is gone.'));
  const onError = await renderScreen();

  await act(async () => { xterm.onData!('a'); });
  await act(async () => { xterm.onData!('b'); });

  await waitFor(() => expect(receivedInput()).toBe('ab'));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith('Terminal is gone.');
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const terminalWrite = vi.hoisted(() => vi.fn());
const stream = vi.hoisted(() => ({
  onError: null as (() => void) | null,
  onState: null as ((state: { status: string }) => void) | null,
}));
const api = vi.hoisted(() => ({
  terminal: vi.fn(async () => ({ status: 'stopped', items: [], first_seq: 0, next_seq: 0 })),
  startTerminal: vi.fn(async () => ({ process_id: 'p1', status: 'running', items: [], first_seq: 0, next_seq: 0 })),
  terminalInput: vi.fn(async () => ({ process_id: 'p1', status: 'running', items: [], first_seq: 0, next_seq: 0 })),
  resizeTerminal: vi.fn(async () => ({ process_id: 'p1', status: 'running', items: [], first_seq: 0, next_seq: 0 })),
  stopTerminal: vi.fn(async () => ({ process_id: 'p1', status: 'exited', items: [], first_seq: 0, next_seq: 0, exit_code: 0 })),
  openStream: vi.fn((_id, _after, _onOutput, onState, onError) => {
    stream.onState = onState;
    stream.onError = onError;
    return vi.fn();
  }),
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
    onData() {}
    hasSelection() { return false; }
    getSelection() { return ''; }
    write = terminalWrite;
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('./api', () => ({
  codingApi: api,
  openCodingTerminalStream: api.openStream,
}));

import { TaskTerminal } from './TaskTerminal';


beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockClear());
  terminalWrite.mockClear();
  stream.onError = null;
  stream.onState = null;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
});


it('starts a task-owned shell, reports state, and stops it', async () => {
  const user = userEvent.setup();
  render(<TaskTerminal sessionId="task-1" onClose={vi.fn()} />);

  await waitFor(() => expect(api.startTerminal).toHaveBeenCalledWith('task-1', 80, 24));
  expect(await screen.findByText('Running')).toBeInTheDocument();
  api.stopTerminal.mockImplementationOnce(async () => {
    stream.onState?.({ status: 'running' });
    stream.onError?.();
    return { process_id: 'p1', status: 'exited', items: [], first_seq: 0, next_seq: 0, exit_code: 0 };
  });
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(api.stopTerminal).toHaveBeenCalledWith('task-1');
  expect(await screen.findByText('Exited · 0')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

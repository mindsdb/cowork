import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const terminalWrite = vi.hoisted(() => vi.fn());
const stream = vi.hoisted(() => ({
  onError: null as (() => void) | null,
  onState: null as ((state: { status: string }) => void) | null,
}));
const api = vi.hoisted(() => ({
  terminals: vi.fn(async () => ({ items: [{
    id: 'terminal-1', label: 'Terminal 1', created_at: '2026-08-29T12:00:00Z', status: 'stopped',
  }] })),
  createTerminal: vi.fn(async () => ({
    id: 'terminal-2', label: 'Terminal 2', created_at: '2026-08-29T12:01:00Z', status: 'stopped',
  })),
  renameTerminal: vi.fn(async (_id, terminalId, label) => ({
    id: terminalId, label, created_at: '2026-08-29T12:01:00Z', status: 'running',
  })),
  deleteTerminal: vi.fn(async () => undefined),
  terminal: vi.fn(async (_id: string, _terminalId: string) => ({ status: 'stopped', items: [], first_seq: 0, next_seq: 0 })),
  startTerminal: vi.fn(async (_id, terminalId) => ({ process_id: `p-${terminalId}`, status: 'running', items: [], first_seq: 0, next_seq: 0 })),
  terminalInput: vi.fn(async () => ({ process_id: 'p1', status: 'running', items: [], first_seq: 0, next_seq: 0 })),
  resizeTerminal: vi.fn(async () => ({ process_id: 'p1', status: 'running', items: [], first_seq: 0, next_seq: 0 })),
  stopTerminal: vi.fn(async () => ({ process_id: 'p1', status: 'exited', items: [], first_seq: 0, next_seq: 0, exit_code: 0 })),
  openStream: vi.fn((_id, _terminalId, _after, _onOutput, onState, onError) => {
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
  window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
});


it('starts a task-owned shell, reports state, and stops only the active terminal', async () => {
  const user = userEvent.setup();
  render(<TaskTerminal sessionId="task-1" onClose={vi.fn()} />);

  await waitFor(() => expect(api.startTerminal).toHaveBeenCalledWith('task-1', 'terminal-1', 80, 24, 'auto'));
  expect(await screen.findByRole('tab', { name: 'Terminal 1, Running' })).toBeInTheDocument();
  api.stopTerminal.mockImplementationOnce(async () => {
    stream.onState?.({ status: 'running' });
    stream.onError?.();
    return { process_id: 'p1', status: 'exited', items: [], first_seq: 0, next_seq: 0, exit_code: 0 };
  });
  await user.click(screen.getByRole('button', { name: 'Stop terminal' }));
  expect(api.stopTerminal).toHaveBeenCalledWith('task-1', 'terminal-1');
  expect(await screen.findByRole('tab', { name: 'Terminal 1, Exited with code 0' })).toBeInTheDocument();
});


it('creates independent tabs and renames them inline', async () => {
  const user = userEvent.setup();
  render(<TaskTerminal sessionId="task-1" onClose={vi.fn()} />);
  await screen.findByRole('tab', { name: 'Terminal 1, Running' });

  await user.click(screen.getByRole('button', { name: 'New terminal' }));
  await waitFor(() => expect(api.startTerminal).toHaveBeenCalledWith('task-1', 'terminal-2', 80, 24, 'auto'));
  const second = await screen.findByRole('tab', { name: 'Terminal 2, Running' });
  await user.dblClick(second);
  const rename = screen.getByRole('textbox', { name: 'Rename Terminal 2' });
  await user.clear(rename);
  await user.type(rename, 'Dev server{Enter}');

  expect(api.renameTerminal).toHaveBeenCalledWith('task-1', 'terminal-2', 'Dev server');
  expect(await screen.findByRole('tab', { name: 'Dev server, Running' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Terminal 1, Running' })).toBeInTheDocument();
});


it('restores the last selected terminal for each task', async () => {
  api.terminals.mockResolvedValueOnce({ items: [{
    id: 'terminal-1', label: 'Terminal 1', created_at: '2026-08-29T12:00:00Z', status: 'stopped',
  }, {
    id: 'terminal-2', label: 'Dev server', created_at: '2026-08-29T12:01:00Z', status: 'stopped',
  }] });
  window.localStorage.setItem('mindshub-code-terminal:task-remembered', 'terminal-2');

  render(<TaskTerminal sessionId="task-remembered" onClose={vi.fn()} />);

  await waitFor(() => expect(api.startTerminal).toHaveBeenCalledWith(
    'task-remembered', 'terminal-2', 80, 24, 'auto',
  ));
  expect(screen.getByRole('tab', { name: 'Dev server, Running' })).toHaveAttribute('aria-selected', 'true');
  expect(window.localStorage.getItem('mindshub-code-terminal:task-remembered')).toBe('terminal-2');
});


it('refreshes and focuses a terminal created by a project action', async () => {
  const { rerender } = render(<TaskTerminal sessionId="task-1" onClose={vi.fn()} />);
  await screen.findByRole('tab', { name: 'Terminal 1, Running' });
  api.terminals.mockResolvedValueOnce({ items: [{
    id: 'terminal-1', label: 'Terminal 1', created_at: '2026-08-29T12:00:00Z', status: 'running',
  }, {
    id: 'project-action', label: 'Start preview', created_at: '2026-08-29T12:01:00Z', status: 'running',
  }] });
  api.terminal.mockImplementation(async (_sessionId: string, terminalId: string) => terminalId === 'project-action'
    ? { process_id: 'p-project-action', status: 'running', items: [], first_seq: 0, next_seq: 0 }
    : { status: 'stopped', items: [], first_seq: 0, next_seq: 0 });

  rerender(<TaskTerminal sessionId="task-1" focusTerminalId="project-action" onClose={vi.fn()} />);

  expect(await screen.findByRole('tab', { name: 'Start preview, Running' })).toHaveAttribute('aria-selected', 'true');
  expect(api.terminals).toHaveBeenCalledTimes(2);
  expect(api.startTerminal).not.toHaveBeenCalledWith('task-1', 'project-action', 80, 24, 'auto');
});

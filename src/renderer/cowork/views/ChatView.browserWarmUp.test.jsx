import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const shell = vi.hoisted(() => ({ isWeb: true }));
vi.mock('../../platform/host', () => ({
  host: {
    get isWeb() { return shell.isWeb; },
    get isElectron() { return !shell.isWeb; },
    isMac: () => false,
    isLocalApiOrigin: () => true,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  openExternal: vi.fn(),
  getAccessToken: vi.fn(async () => null),
  get isElectron() { return !shell.isWeb; },
  get isWeb() { return shell.isWeb; },
}));

const provisionBrowser = vi.fn(async () => ({ status: 'starting' }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  provisionBrowser: (...args) => provisionBrowser(...args),
  embedBrowser: vi.fn(() => new Promise(() => {})),
}));

import ChatView from './ChatView';
import { browserStep } from '../lib/browserSession';

// The warm-up debounce lives at module level (it outlives a task switch), so
// each test uses its own task ids.
const task = (id, { browser = false } = {}) => ({
  id,
  title: `Task ${id}`,
  status: 'idle',
  messages: browser
    ? [
      { id: `${id}-u`, role: 'user', content: 'Check the site' },
      { id: `${id}-a`, role: 'assistant', content: 'Done.', steps: [browserStep({ session_id: 't-abc' }, 1)] },
    ]
    : [],
});

describe('ChatView starts the shared browser early on the web', () => {
  beforeEach(() => {
    shell.isWeb = true;
    provisionBrowser.mockClear();
  });
  afterEach(() => {
    shell.isWeb = true;
  });

  it('warms the browser when a task that used it opens', () => {
    render(<ChatView task={task('open-1', { browser: true })} onSend={vi.fn()} browserOn />);
    expect(provisionBrowser).toHaveBeenCalledTimes(1);
  });

  it('does not warm it for a task that never used the browser', () => {
    render(<ChatView task={task('open-2')} onSend={vi.fn()} browserOn />);
    expect(provisionBrowser).not.toHaveBeenCalled();
  });

  it('does nothing while the browser is off', async () => {
    render(<ChatView task={task('off-1', { browser: true })} onSend={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('Reply…'), 'hi');
    expect(provisionBrowser).not.toHaveBeenCalled();
  });

  it('never warms it on typing in a task that never used the browser', async () => {
    render(<ChatView task={task('type-0')} onSend={vi.fn()} browserOn />);
    await userEvent.type(screen.getByPlaceholderText('Reply…'), 'hello there');
    expect(provisionBrowser).not.toHaveBeenCalled();
  });

  it('warms it on typing in a task that used the browser, once per two minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      render(<ChatView task={task('type-1', { browser: true })} onSend={vi.fn()} browserOn />);
      expect(provisionBrowser).toHaveBeenCalledTimes(1);
      // Past the window the open started, so the first keystroke warms again.
      vi.setSystemTime(Date.now() + 2 * 60_000 + 1);
      const box = screen.getByPlaceholderText('Reply…');
      await userEvent.type(box, 'h');
      expect(provisionBrowser).toHaveBeenCalledTimes(2);
      await userEvent.type(box, 'ello there');
      expect(provisionBrowser).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not warm it again on reopening a task within two minutes', () => {
    const { unmount } = render(<ChatView task={task('reopen-1', { browser: true })} onSend={vi.fn()} browserOn />);
    unmount();
    render(<ChatView task={task('reopen-1', { browser: true })} onSend={vi.fn()} browserOn />);
    expect(provisionBrowser).toHaveBeenCalledTimes(1);
  });

  it('warms nothing on the desktop, opening or typing', async () => {
    shell.isWeb = false;
    render(<ChatView task={task('desk-1', { browser: true })} onSend={vi.fn()} browserOn />);
    await userEvent.type(screen.getByPlaceholderText('Reply…'), 'hello');
    expect(provisionBrowser).not.toHaveBeenCalled();
  });
});

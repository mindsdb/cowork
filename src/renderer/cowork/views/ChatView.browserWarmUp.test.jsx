import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  openExternal: vi.fn(),
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

const provisionBrowser = vi.fn(async () => ({ status: 'starting' }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  provisionBrowser: (...args) => provisionBrowser(...args),
  embedBrowser: vi.fn(() => new Promise(() => {})),
}));

import ChatView from './ChatView';
import { browserStep } from '../lib/browserSession';

const VIEW = 'https://cowork.mindshub.ai/browser/sessions/t-abc/view?et=tok';

// The warm-up debounce lives at module level (it outlives a task switch), so
// each test uses its own task ids.
const task = (id, { browser = false } = {}) => ({
  id,
  title: `Task ${id}`,
  status: 'idle',
  messages: browser
    ? [
      { id: `${id}-u`, role: 'user', content: 'Check the site' },
      { id: `${id}-a`, role: 'assistant', content: 'Done.', steps: [browserStep({ session_id: 't-abc', view_url: VIEW, expires_at: 0 }, 1)] },
    ]
    : [],
});

describe('ChatView starts the shared browser early', () => {
  // The browser pane's frame points at a live host: keep happy-dom off it.
  let iframeLoading;
  beforeEach(() => {
    provisionBrowser.mockClear();
    iframeLoading = window.happyDOM.settings.disableIframePageLoading;
    window.happyDOM.settings.disableIframePageLoading = true;
  });
  afterEach(() => {
    window.happyDOM.settings.disableIframePageLoading = iframeLoading;
  });

  it('warms the browser when a task that used it opens', () => {
    render(<ChatView task={task('open-1', { browser: true })} onSend={vi.fn()} browserWarmUp />);
    expect(provisionBrowser).toHaveBeenCalledTimes(1);
  });

  it('does not warm it for a task that never used the browser', () => {
    render(<ChatView task={task('open-2')} onSend={vi.fn()} browserWarmUp />);
    expect(provisionBrowser).not.toHaveBeenCalled();
  });

  it('does nothing while the browser is off', async () => {
    render(<ChatView task={task('off-1', { browser: true })} onSend={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('Reply…'), 'hi');
    expect(provisionBrowser).not.toHaveBeenCalled();
  });

  it('warms it once on the first keystroke in the composer', async () => {
    render(<ChatView task={task('type-1')} onSend={vi.fn()} browserWarmUp />);
    const box = screen.getByPlaceholderText('Reply…');
    await userEvent.type(box, 'h');
    expect(provisionBrowser).toHaveBeenCalledTimes(1);
    await userEvent.type(box, 'ello there');
    expect(provisionBrowser).toHaveBeenCalledTimes(1);
  });

  it('does not warm it again on reopening a task within two minutes', () => {
    const { unmount } = render(<ChatView task={task('reopen-1', { browser: true })} onSend={vi.fn()} browserWarmUp />);
    unmount();
    render(<ChatView task={task('reopen-1', { browser: true })} onSend={vi.fn()} browserWarmUp />);
    expect(provisionBrowser).toHaveBeenCalledTimes(1);
  });
});

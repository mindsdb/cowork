import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const shell = vi.hoisted(() => ({ isWeb: true, inApp: false, shown: [] }));
vi.mock('../../platform/host', () => ({
  host: {
    get isWeb() { return shell.isWeb; },
    get isElectron() { return !shell.isWeb; },
    get supportsInAppBrowser() { return shell.inApp; },
    inAppBrowser: {
      show: async (sessionId) => {
        shell.shown.push(sessionId);
        return { exists: true };
      },
      hide: async () => {},
      setBounds: async () => {},
      onState: () => () => {},
    },
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

const embedBrowser = vi.fn();
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  provisionBrowser: vi.fn(async () => ({ status: 'starting' })),
  embedBrowser: (...args) => embedBrowser(...args),
}));

import ChatView from './ChatView';
import { browserStep } from '../lib/browserSession';

const VIEW = `${window.location.origin}/browser/sessions/t-abc/view?et=tok`;
const step = (sessionId = 't-abc') => browserStep({ session_id: sessionId }, 1);

const pastTurn = [
  { id: 'u1', role: 'user', content: 'Check the site' },
  { id: 'a1', role: 'assistant', content: 'Done.', steps: [step()] },
];
const liveTurn = (sessionId = 't-abc') => ({
  role: '_streaming',
  content: '',
  steps: [step(sessionId)],
  currentThought: null,
  streamStatus: 'in_progress',
});
const task = (id, messages) => ({ id, title: `Task ${id}`, status: 'active', messages });

function pane() {
  return screen.queryByRole('complementary', { name: 'Shared browser' });
}

/* The transcript folds a turn's steps: unfold them if needed, then click the
   Browser step. */
async function clickBrowserStep() {
  if (!screen.queryAllByText('Opened the browser').length) {
    const toggle = screen.getAllByRole('button', { expanded: false }).find((b) => b.closest('.answer-turn'));
    await act(async () => { fireEvent.click(toggle); });
  }
  await act(async () => { fireEvent.click(screen.getAllByText('Opened the browser')[0]); });
}

function setWidth(px) {
  window.happyDOM.setViewport({ width: px });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

describe('ChatView shared browser pane', () => {
  let iframeLoading;
  beforeEach(() => {
    shell.isWeb = true;
    shell.inApp = false;
    shell.shown = [];
    embedBrowser.mockReset();
    embedBrowser.mockResolvedValue({ session_id: 't-abc', view_url: VIEW, ticket_expires_at: 1_900_000_000, lease_expires_at: 1_900_000_780 });
    iframeLoading = window.happyDOM.settings.disableIframePageLoading;
    window.happyDOM.settings.disableIframePageLoading = true;
    setWidth(1400);
  });
  afterEach(() => {
    window.happyDOM.settings.disableIframePageLoading = iframeLoading;
    setWidth(1024);
  });

  it('never opens for a past Browser step while the browser is off, and mints nothing', async () => {
    render(<ChatView task={task('p-off', pastTurn)} onSend={vi.fn()} />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it('opens for a past Browser step only when the person clicks it', async () => {
    render(<ChatView task={task('p-on', pastTurn)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();

    await clickBrowserStep();
    expect(pane()).not.toBeNull();
    expect(embedBrowser).toHaveBeenCalledWith('t-abc');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing on a Browser step click while the browser is off, and never opens the scratchpad', async () => {
    render(<ChatView task={task('p-click-off', pastTurn)} onSend={vi.fn()} />);
    await clickBrowserStep();
    expect(pane()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens for the live turn\'s Browser step', async () => {
    render(<ChatView task={task('live-1', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    expect(embedBrowser).toHaveBeenCalledWith('t-abc');
  });

  it('stays closed after the person closes it mid-turn, through the turn\'s end, until a later turn opens it', async () => {
    const asked = { id: 'u1', role: 'user', content: 'Go' };
    const { rerender } = render(<ChatView task={task('live-2', [asked, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    fireEvent.click(within(pane()).getByRole('button', { name: 'Close browser' }));
    expect(pane()).toBeNull();

    const finished = [asked, { id: 'a1', role: 'assistant', content: 'Done.', steps: [step()] }];
    rerender(<ChatView task={task('live-2', finished)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();

    rerender(<ChatView task={task('live-2', [...finished, { id: 'u2', role: 'user', content: 'Again' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
  });

  it('comes back when the person clicks the Browser step after closing it mid-turn', async () => {
    render(<ChatView task={task('live-3', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    fireEvent.click(within(pane()).getByRole('button', { name: 'Close browser' }));
    expect(pane()).toBeNull();
    await clickBrowserStep();
    expect(pane()).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the browser is switched off, and starts over on a task change', async () => {
    const live = [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()];
    const { rerender } = render(<ChatView task={task('sw-1', live)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    rerender(<ChatView task={task('sw-1', live)} onSend={vi.fn()} browserOn={false} />);
    expect(pane()).toBeNull();

    rerender(<ChatView task={task('sw-1', live)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    rerender(<ChatView task={task('sw-2', pastTurn)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
  });

  it('opens no pane on a desktop shell without the in-app browser', async () => {
    shell.isWeb = false;
    render(<ChatView task={task('desk', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it("opens the app's own browser on a desktop shell that hosts it, with no frame and no viewer link", async () => {
    shell.isWeb = false;
    shell.inApp = true;
    const { container } = render(<ChatView task={task('desk-2', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    expect(container.querySelector('aside[aria-label="Shared browser"] iframe')).toBeNull();
    expect(shell.shown).toEqual(['t-abc']);
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it('keeps the desktop pane shut while the browser is off for the task', async () => {
    shell.isWeb = false;
    shell.inApp = true;
    render(<ChatView task={task('desk-3', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn={false} />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(shell.shown).toEqual([]);
  });

  it('drops the viewer frame while the tab is hidden', async () => {
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    try {
      render(<ChatView task={task('vis-1', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
      await act(async () => {});
      expect(screen.getByTitle('Shared browser')).toBeInTheDocument();
      visibility = 'hidden';
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(screen.queryByTitle('Shared browser')).toBeNull();
    } finally {
      delete document.visibilityState;
    }
  });

  it('floats the pane at 1024 px, leaving the grid and the rail as they are', async () => {
    setWidth(1024);
    const { container } = render(
      <ChatView task={task('w-1', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />,
    );
    await act(async () => {});
    expect(pane()).not.toBeNull();
    expect(container.innerHTML).not.toContain('minmax(440px,50%)');
    expect(container.querySelector('.chat-rail-aside')).not.toHaveClass('hidden');
  });

  it('takes a grid column from 1160 px, with the rail stepping aside', async () => {
    setWidth(1160);
    const { container } = render(
      <ChatView task={task('w-2', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />,
    );
    await act(async () => {});
    expect(container.innerHTML).toContain('minmax(440px,50%)');
    expect(container.querySelector('.chat-rail-aside')).toHaveClass('hidden');
  });
});

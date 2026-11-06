import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

/* The desktop shell's in-app browser bridge, recorded. */
const shell = vi.hoisted(() => ({
  calls: [],
  listeners: new Set(),
  exists: true,
}));

vi.mock('../../../platform/host', () => {
  const record = (name) => (...args) => {
    shell.calls.push([name, ...args]);
    return Promise.resolve(name === 'show' ? { exists: shell.exists } : undefined);
  };
  return {
    host: {
      isWeb: false,
      supportsInAppBrowser: true,
      inAppBrowser: {
        show: record('show'),
        hide: record('hide'),
        setBounds: record('setBounds'),
        back: record('back'),
        forward: record('forward'),
        reload: record('reload'),
        activateTab: record('activateTab'),
        takeOver: record('takeOver'),
        handBack: record('handBack'),
        answerLogin: record('answerLogin'),
        answerDownload: record('answerDownload'),
        onState: (cb) => {
          shell.listeners.add(cb);
          return () => shell.listeners.delete(cb);
        },
      },
    },
  };
});

const embedBrowser = vi.fn();
vi.mock('../../api', () => ({ embedBrowser: (...args) => embedBrowser(...args) }));

import { BrowserPanel } from './BrowserPanel';
import { DOWNLOAD_ARM_MS } from './LocalBrowserStage';
import { Modal } from '../ui/Modal';
import { OutsidePressLayer } from '../ui/OutsidePressLayer';

/* happy-dom has no layout or ResizeObserver: the stage reports a fixed box,
   and the test fires the observer itself. */
let observers = [];
class FakeResizeObserver {
  constructor(cb) {
    this.cb = cb;
    observers.push(this);
  }
  observe() {}
  disconnect() {
    observers = observers.filter((o) => o !== this);
  }
}

let stageBox = { left: 600, top: 56, width: 600, height: 700 };

function state(over = {}) {
  return {
    sessionId: 't-abc',
    open: true,
    url: 'https://shop.example.test/cart',
    title: 'Cart',
    loading: false,
    canGoBack: true,
    canGoForward: false,
    tabs: [{ id: 't1', url: 'https://shop.example.test/cart', title: 'Cart', active: true }],
    control: { holder: 'agent', reason: '', since: 1, seq: 0, by: 'agent' },
    login: null,
    downloads: [],
    ...over,
  };
}

function emit(next) {
  act(() => {
    for (const cb of shell.listeners) cb(next);
  });
}

const calls = (name) => shell.calls.filter(([n]) => n === name);

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  shell.calls = [];
  shell.exists = true;
  observers = [];
  stageBox = { left: 600, top: 56, width: 600, height: 700 };
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function box() {
    return this.classList?.contains('browser-panel__stage') ? { ...stageBox, x: stageBox.left, y: stageBox.top } : { left: 0, top: 0, width: 0, height: 0 };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the desktop browser pane', () => {
  it('mounts no frame and places the native view at the stage', async () => {
    const { container } = render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} />);
    await flush();
    expect(container.querySelector('iframe')).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
    expect(calls('show')).toEqual([['show', 't-abc', { x: 600, y: 56, width: 600, height: 700 }]]);
  });

  it('follows the stage as it resizes, and only when it moved', async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    act(() => observers.forEach((o) => o.cb()));
    expect(calls('setBounds')).toEqual([]);
    stageBox = { left: 400, top: 56, width: 800, height: 700 };
    act(() => observers.forEach((o) => o.cb()));
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(calls('setBounds')).toEqual([['setBounds', { x: 400, y: 56, width: 800, height: 700 }]]);
  });

  it('hides the view when the pane closes or the task changes', async () => {
    const { rerender, unmount } = render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    rerender(<BrowserPanel sessionId="t-other" onClose={vi.fn()} />);
    await flush();
    expect(calls('hide')).toHaveLength(1);
    expect(calls('show').at(-1)[1]).toBe('t-other');
    unmount();
    expect(calls('hide')).toHaveLength(2);
  });

  it('hides the view while a modal is open, and shows it again after', async () => {
    function WithModal() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>toggle</button>
          <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Test modal"><p>Modal body</p></Modal>
          <BrowserPanel sessionId="t-abc" onClose={vi.fn()} />
        </>
      );
    }
    render(<WithModal />);
    await flush();
    expect(calls('show')).toHaveLength(1);
    fireEvent.click(screen.getByText('toggle'));
    await flush();
    expect(calls('hide')).toHaveLength(1);
    fireEvent.click(screen.getByText('toggle'));
    await flush();
    expect(calls('show')).toHaveLength(2);
  });

  it('hides the view while a popover is open', async () => {
    function WithPopover() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>open popover</button>
          {open && <OutsidePressLayer zIndex={10} onPress={() => setOpen(false)} data-testid="layer" />}
          <BrowserPanel sessionId="t-abc" onClose={vi.fn()} />
        </>
      );
    }
    render(<WithPopover />);
    await flush();
    expect(calls('show')).toHaveLength(1);
    fireEvent.click(screen.getByText('open popover'));
    await flush();
    expect(calls('hide')).toHaveLength(1);
    fireEvent.mouseDown(screen.getByTestId('layer'));
    await flush();
    expect(calls('show')).toHaveLength(2);
  });

  it('offers Take over while the agent holds the browser, and Done while the person does', async () => {
    render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} />);
    emit(state());
    expect(screen.getByText('Cowork is using it. Take over to use it yourself.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(calls('takeOver')).toEqual([['takeOver', 't-abc']]);
    emit(state({ control: { holder: 'human', reason: 'Please sign in', since: 2, seq: 1, by: 'agent' } }));
    expect(screen.getByText('Your turn on shop.example.test: Please sign in. Click Done to hand it back to Cowork.')).toBeInTheDocument();
    expect(screen.getByText("Cowork's page reads and screenshots go to the model provider that serves your turn.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(calls('handBack')).toEqual([['handBack', 't-abc']]);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(calls('back')).toEqual([['back', 't-abc']]);
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
  });

  it('ignores state for other tasks', async () => {
    render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} />);
    emit(state({ sessionId: 't-other', control: { holder: 'human', reason: '', since: 2, seq: 1, by: 'person' } }));
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('says the agent opens the browser again when the task\'s browser is closed', async () => {
    shell.exists = false;
    render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText("This task's browser is closed")).toBeInTheDocument();
    expect(screen.getByText('Cowork opens it again when it needs it.')).toBeInTheDocument();
    emit(state());
    await flush();
    expect(calls('show')).toHaveLength(2);
  });

  it('asks the person for a site\'s sign-in in the pane, with the view hidden, and sends only their answer', async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    emit(state({ login: { host: 'intranet.test' }, control: { holder: 'human', reason: 'intranet.test asks for a username and password.', since: 2, seq: 1, by: 'agent' } }));
    await flush();
    expect(calls('hide')).toHaveLength(1);
    expect(screen.getByText('intranet.test asks you to sign in')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(calls('answerLogin')).toEqual([['answerLogin', 't-abc', { username: 'ada', password: 'pw' }]]);
  });

  it('shows the tabs and the latest download', async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    emit(state({
      tabs: [
        { id: 't1', url: 'https://a.test/', title: 'A', active: true },
        { id: 't2', url: 'https://b.test/', title: 'B', active: false },
      ],
      downloads: [{ id: 'd1', name: 'report.pdf', folder: 'Cowork browser', state: 'completed' }],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(calls('activateTab')).toEqual([['activateTab', 't-abc', 't2']]);
    expect(screen.getByText('report.pdf is in Downloads, in Cowork browser.')).toBeInTheDocument();
  });

  it('asks before saving a download that started while the agent held the browser', async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    emit(state({ downloads: [{ id: '0123456789ab', name: 'invoice.pdf', folder: 'Cowork browser', state: 'waiting' }] }));
    expect(screen.getByText('This page wants to download invoice.pdf to Downloads, in Cowork browser.')).toBeInTheDocument();
    // Save takes no click until the prompt has been there a moment.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await act(() => new Promise((resolve) => { setTimeout(resolve, DOWNLOAD_ARM_MS + 50); }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: "Don't save" }));
    expect(calls('answerDownload')).toEqual([
      ['answerDownload', 't-abc', '0123456789ab', true],
      ['answerDownload', 't-abc', '0123456789ab', false],
    ]);
  });

  it('keeps the oldest waiting download on the line when a newer one arrives', async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    emit(state({ downloads: [
      { id: 'bbbbbbbbbbbb', name: 'later.exe', folder: 'Cowork browser', state: 'waiting' },
      { id: 'aaaaaaaaaaaa', name: 'invoice.pdf', folder: 'Cowork browser', state: 'waiting' },
    ] }));
    expect(screen.getByText('This page wants to download invoice.pdf to Downloads, in Cowork browser.')).toBeInTheDocument();
    await act(() => new Promise((resolve) => { setTimeout(resolve, DOWNLOAD_ARM_MS + 50); }));
    fireEvent.click(screen.getByRole('button', { name: "Don't save" }));
    expect(calls('answerDownload')).toEqual([['answerDownload', 't-abc', 'aaaaaaaaaaaa', false]]);
  });

  it.each([
    ['progressing', 'Downloading a.zip…'],
    ['cancelled', "a.zip wasn't saved."],
    ['interrupted', "a.zip didn't download."],
  ])('says what happened to a %s download, with no buttons', async (downloadState, line) => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    emit(state({ downloads: [{ id: 'd1', name: 'a.zip', folder: 'Cowork browser', state: downloadState }] }));
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

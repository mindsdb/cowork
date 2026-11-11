import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

/* The desktop shell's in-app browser bridge, recorded. */
const shell = vi.hoisted(() => ({
  calls: [],
  listeners: new Set(),
  exists: true,
  /* Whether main draws at the bounds the pane sends. */
  drawn: true,
  /* While a list, each show and setBounds call waits in it, in order, for
     the test to answer it. */
  held: null,
}));

vi.mock('../../../platform/host', () => {
  const answer = (name) => {
    if (name === 'show') return { exists: shell.exists, drawn: shell.exists && shell.drawn };
    if (name === 'setBounds') return { drawn: shell.drawn };
    return undefined;
  };
  const record = (name) => (...args) => {
    shell.calls.push([name, ...args]);
    if (shell.held && (name === 'show' || name === 'setBounds')) {
      return new Promise((resolve) => { shell.held.push(resolve); });
    }
    return Promise.resolve(answer(name));
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPanel } from './BrowserPanel';
import { DOWNLOAD_ARM_MS, NOWHERE } from './LocalBrowserStage';
import { DESKTOP_SIGN_INS } from '../../views/settings/BrowserSettingsSection';
import { Modal } from '../ui/Modal';
import { OutsidePressLayer } from '../ui/OutsidePressLayer';
import { ToastProvider, useToastManager } from '../ui/Toast';
import { Select } from '../ui/Select';
import { Combobox } from '../ui/Combobox';
import { raiseNativeOverlay } from '../../lib/nativeOverlay';

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
  shell.drawn = true;
  shell.held = null;
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

  it('reports a stage too small to show, or with no area, as measured, and keeps the task shown', async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    expect(calls('show')).toHaveLength(1);
    // A download prompt pushes the stage under main's floor: main parks the view for it.
    stageBox = { left: 600, top: 116, width: 600, height: 190 };
    act(() => observers.forEach((o) => o.cb()));
    // Code mode hides the Cowork panel with display:none, which leaves the stage 0 by 0.
    stageBox = { left: 0, top: 0, width: 0, height: 0 };
    act(() => observers.forEach((o) => o.cb()));
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(calls('setBounds')).toEqual([
      ['setBounds', { x: 600, y: 116, width: 600, height: 190 }],
      ['setBounds', { x: 0, y: 0, width: 0, height: 0 }],
    ]);

    stageBox = { left: 600, top: 56, width: 600, height: 700 };
    act(() => observers.forEach((o) => o.cb()));
    expect(calls('setBounds')).toEqual([
      ['setBounds', { x: 600, y: 116, width: 600, height: 190 }],
      ['setBounds', { x: 0, y: 0, width: 0, height: 0 }],
      ['setBounds', { x: 600, y: 56, width: 600, height: 700 }],
    ]);
    expect(calls('show')).toHaveLength(1);
    expect(calls('hide')).toEqual([]);
  });

  it('shows the task at a stage that opens with no area, and follows it as it grows', async () => {
    stageBox = { left: 600, top: 56, width: 600, height: 0 };
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    expect(calls('show')).toEqual([['show', 't-abc', { x: 600, y: 56, width: 600, height: 0 }]]);
    stageBox = { left: 600, top: 56, width: 600, height: 700 };
    act(() => observers.forEach((o) => o.cb()));
    expect(calls('setBounds')).toEqual([['setBounds', { x: 600, y: 56, width: 600, height: 700 }]]);
    expect(calls('show')).toHaveLength(1);
  });

  it('hides the view when the pane closes or the task changes', async () => {
    const { rerender, unmount } = render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    expect(calls('hide')).toEqual([]);
    rerender(<BrowserPanel sessionId="t-other" onClose={vi.fn()} />);
    await flush();
    expect(calls('hide')).toHaveLength(1);
    expect(calls('show').at(-1)[1]).toBe('t-other');
    unmount();
    expect(calls('hide')).toHaveLength(2);
  });

  it("hides the view when the task's browser closes, and shows it again when it opens", async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    emit(state());
    await flush();
    expect(calls('hide')).toEqual([]);
    emit(state({ open: false }));
    await flush();
    expect(calls('hide')).toHaveLength(1);
    // A pane that shows no task reports no bounds, while an overlay opens or after it closes.
    let lower;
    act(() => { lower = raiseNativeOverlay(); });
    act(() => lower());
    expect(calls('setBounds')).toEqual([]);
    emit(state());
    await flush();
    expect(calls('show')).toHaveLength(2);
    expect(calls('hide')).toHaveLength(1);
  });

  it('parks the view while a modal is open, keeps the task shown, and places it again after', async () => {
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
    expect(calls('setBounds')).toEqual([['setBounds', NOWHERE]]);
    // The stage moves under the modal: nothing changes for a parked view.
    stageBox = { left: 500, top: 56, width: 700, height: 700 };
    act(() => observers.forEach((o) => o.cb()));
    expect(calls('setBounds')).toHaveLength(1);
    fireEvent.click(screen.getByText('toggle'));
    await flush();
    expect(calls('setBounds')).toEqual([['setBounds', NOWHERE], ['setBounds', { x: 500, y: 56, width: 700, height: 700 }]]);
    expect(calls('show')).toHaveLength(1);
    expect(calls('hide')).toEqual([]);
  });

  it('parks the view at the empty rectangle, which main never draws in', () => {
    /* Every parking test compares against NOWHERE, so this pins its value:
       bounds main could draw in would put the page over the overlay. */
    expect(NOWHERE).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('shows the task parked when the pane opens under an overlay', async () => {
    const lower = raiseNativeOverlay();
    try {
      render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
      await flush();
      expect(calls('show')).toEqual([['show', 't-abc', NOWHERE]]);
      expect(calls('setBounds')).toEqual([]);
    } finally {
      act(() => lower());
    }
    expect(calls('setBounds')).toEqual([['setBounds', { x: 600, y: 56, width: 600, height: 700 }]]);
    expect(calls('show')).toHaveLength(1);
    expect(calls('hide')).toEqual([]);
  });

  it('parks the view while a popover is open', async () => {
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
    expect(calls('setBounds')).toEqual([['setBounds', NOWHERE]]);
    fireEvent.mouseDown(screen.getByTestId('layer'));
    await flush();
    expect(calls('setBounds').at(-1)).toEqual(['setBounds', { x: 600, y: 56, width: 600, height: 700 }]);
    expect(calls('show')).toHaveLength(1);
    expect(calls('hide')).toEqual([]);
  });

  it('parks the view while a toast shows, with the task still shown, and places it again once it is gone', async () => {
    function WithToast() {
      const toasts = useToastManager();
      return (
        <>
          <button type="button" onClick={() => toasts.add({ id: 'oauth', title: 'Reconnect Gmail', timeout: 0 })}>toast</button>
          <button type="button" onClick={() => toasts.close('oauth')}>dismiss</button>
          <BrowserPanel sessionId="t-abc" onClose={vi.fn()} />
        </>
      );
    }
    render(<ToastProvider><WithToast /></ToastProvider>);
    await flush();
    expect(calls('show')).toHaveLength(1);
    fireEvent.click(screen.getByText('toast'));
    await flush();
    expect(screen.getByText('Reconnect Gmail')).toBeInTheDocument();
    // A toast that stays up must not clear the task main shows, or idle close takes it.
    expect(calls('setBounds')).toEqual([['setBounds', NOWHERE]]);
    expect(calls('hide')).toEqual([]);
    fireEvent.click(screen.getByText('dismiss'));
    await vi.waitFor(() => expect(calls('setBounds').at(-1)).toEqual(['setBounds', { x: 600, y: 56, width: 600, height: 700 }]));
    expect(calls('show')).toHaveLength(1);
    expect(calls('hide')).toEqual([]);
  });

  it.each([
    ['Select', () => <Select ariaLabel="Effort" value="low" onValueChange={vi.fn()} options={[{ value: 'low', label: 'low' }, { value: 'high', label: 'high' }]} />],
    ['Combobox', () => <Combobox ariaLabel="Model" value="a" onValueChange={vi.fn()} groups={[{ key: 'g', name: null, items: [{ value: 'a', label: 'Model A' }, { value: 'b', label: 'Model B' }] }]} />],
  ])('parks the view while a %s popup is open', async (_name, picker) => {
    render(<>{picker()}<BrowserPanel sessionId="t-abc" onClose={vi.fn()} /></>);
    await flush();
    expect(calls('show')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    await flush();
    expect(screen.getByRole('option', { name: /high|Model B/ })).toBeInTheDocument();
    expect(calls('setBounds')).toEqual([['setBounds', NOWHERE]]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await vi.waitFor(() => expect(calls('setBounds').at(-1)).toEqual(['setBounds', { x: 600, y: 56, width: 600, height: 700 }]));
    expect(calls('show')).toHaveLength(1);
    expect(calls('hide')).toEqual([]);
  });

  const BIGGER = 'Make the window bigger to see the page';
  const resize = (box) => {
    stageBox = box;
    act(() => observers.forEach((o) => o.cb()));
  };

  it("says to make the window bigger while main doesn't draw at the stage, and stops once it does", async () => {
    // A short window: the stage is drawable, but under main's floor after the UI zoom.
    shell.drawn = false;
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    emit(state());
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
    shell.drawn = true;
    resize({ left: 600, top: 56, width: 600, height: 500 });
    await flush();
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
    // A row above it squeezes the stage again, during the person's take over.
    emit(state({ control: { holder: 'human', reason: '', since: 2, seq: 1, by: 'person' } }));
    shell.drawn = false;
    resize({ left: 600, top: 116, width: 600, height: 190 });
    await flush();
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    shell.drawn = true;
    resize({ left: 600, top: 56, width: 600, height: 700 });
    await flush();
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
  });

  it('never says it while an overlay is up', async () => {
    shell.drawn = false;
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
    let lower = () => {};
    try {
      act(() => { lower = raiseNativeOverlay(); });
      await flush();
      expect(calls('setBounds').at(-1)).toEqual(['setBounds', NOWHERE]);
      expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
    } finally {
      act(() => lower());
    }
    await flush();
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
  });

  it('never says it when the pane opens under an overlay', async () => {
    shell.drawn = false;
    const lower = raiseNativeOverlay();
    try {
      render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
      await flush();
      expect(calls('show')).toEqual([['show', 't-abc', NOWHERE]]);
      expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
    } finally {
      act(() => lower());
    }
  });

  it('never says it while the sign-in form shows', async () => {
    shell.drawn = false;
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
    emit(state({ login: { host: 'intranet.test' }, control: { holder: 'human', reason: 'intranet.test asks for a username and password.', since: 2, seq: 1, by: 'agent' } }));
    await flush();
    expect(calls('setBounds')).toEqual([['setBounds', NOWHERE]]);
    expect(screen.getByText('intranet.test asks you to sign in')).toBeInTheDocument();
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
  });

  it('shows the start page in place of a blank tab, with the view parked, and the page once it has one', async () => {
    const onOpenUrl = vi.fn(async () => {});
    render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} taskKey="t-abc" onSend={vi.fn()} onOpenUrl={onOpenUrl} />);
    await flush();
    emit(state({ url: null, title: '', tabs: [{ id: 't1', url: '', title: '', active: true }] }));
    await flush();
    expect(calls('setBounds')).toEqual([['setBounds', NOWHERE]]);
    fireEvent.change(screen.getByLabelText('What to look up'), { target: { value: 'example.com' } });
    fireEvent.submit(screen.getByLabelText('What to look up').closest('form'));
    await flush();
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com');
    emit(state());
    await flush();
    expect(screen.queryByLabelText('What to look up')).not.toBeInTheDocument();
    expect(calls('setBounds').at(-1)).toEqual(['setBounds', { x: 600, y: 56, width: 600, height: 700 }]);
  });

  it('shows no start page without a way to act on it', async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    emit(state({ url: null }));
    await flush();
    expect(screen.queryByLabelText('What to look up')).not.toBeInTheDocument();
  });

  it("forgets the answer when the task's browser closes, and waits for the show sent on opening again", async () => {
    // A short window squeezes the stage.
    stageBox = { left: 600, top: 56, width: 600, height: 150 };
    shell.drawn = false;
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    emit(state());
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
    emit(state({ open: false }));
    await flush();
    expect(screen.getByText("This task's browser is closed")).toBeInTheDocument();
    /* The window grows while the task's browser is closed, and nothing
       measures the stage then. The show sent on opening again waits, so
       only the old answer could bring the line back. */
    stageBox = { left: 600, top: 56, width: 600, height: 700 };
    shell.held = [];
    emit(state());
    await flush();
    expect(calls('show').at(-1)).toEqual(['show', 't-abc', { x: 600, y: 56, width: 600, height: 700 }]);
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
    await act(async () => shell.held.at(-1)({ exists: true, drawn: false }));
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
  });

  it("forgets the answer when the task changes, and waits for the new task's show", async () => {
    stageBox = { left: 600, top: 56, width: 600, height: 150 };
    shell.drawn = false;
    const { rerender } = render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
    shell.held = [];
    rerender(<BrowserPanel sessionId="t-other" onClose={vi.fn()} />);
    await flush();
    expect(calls('show').at(-1)[1]).toBe('t-other');
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
    await act(async () => shell.held.at(-1)({ exists: true, drawn: false }));
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
  });

  it("never says it for a task main doesn't have, or while the show sent on opening again waits", async () => {
    shell.exists = false;
    shell.drawn = false;
    render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText("This task's browser is closed")).toBeInTheDocument();
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
    // The show it sends on opening again waits, so the line can only come from the closed answer.
    shell.held = [];
    emit(state());
    await flush();
    expect(calls('show')).toHaveLength(2);
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
  });

  it('reads only the answer to the latest placement', async () => {
    shell.held = [];
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    resize({ left: 600, top: 56, width: 600, height: 190 });
    expect(shell.held).toHaveLength(2);
    const [show, squeezed] = shell.held;
    await act(async () => squeezed({ drawn: false }));
    expect(screen.getByText(BIGGER)).toBeInTheDocument();
    // The show's late answer, for bounds main has since replaced, can't clear it.
    await act(async () => show({ exists: true, drawn: true }));
    expect(screen.getByText(BIGGER)).toBeInTheDocument();

    resize({ left: 600, top: 56, width: 600, height: 150 });
    resize({ left: 600, top: 56, width: 600, height: 700 });
    const [, , older, latest] = shell.held;
    await act(async () => latest({ drawn: true }));
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
    // The older placement's late answer can't set it again.
    await act(async () => older({ drawn: false }));
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
  });

  it('reads no answer that comes after the pane moved on to another task', async () => {
    shell.held = [];
    const { rerender } = render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    resize({ left: 600, top: 56, width: 600, height: 190 });
    rerender(<BrowserPanel sessionId="t-other" onClose={vi.fn()} />);
    await flush();
    expect(calls('show').map(([, id]) => id)).toEqual(['t-abc', 't-other']);
    const [oldShow, oldBounds, newShow] = shell.held;
    await act(async () => newShow({ exists: true, drawn: true }));
    // Both late answers belong to the task the pane no longer shows.
    await act(async () => oldBounds({ drawn: false }));
    await act(async () => oldShow({ exists: true, drawn: false }));
    expect(screen.queryByText(BIGGER)).not.toBeInTheDocument();
  });

  it('offers Take over while the agent holds the browser, and Done while the person does', async () => {
    render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} />);
    emit(state());
    expect(screen.getByText('Cowork is using it. Take over to use it yourself.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(calls('takeOver')).toEqual([['takeOver', 't-abc']]);
    emit(state({ control: { holder: 'human', reason: 'Please sign in', since: 2, seq: 1, by: 'agent' } }));
    expect(screen.getByText('Your turn on shop.example.test: Please sign in. Click Done to hand it back to Cowork.')).toBeInTheDocument();
    expect(screen.getByText(`Cowork's page reads and screenshots go to the model provider that serves your turn. ${DESKTOP_SIGN_INS}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(calls('handBack')).toEqual([['handBack', 't-abc']]);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(calls('back')).toEqual([['back', 't-abc']]);
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
  });

  it("says sign-ins stay, in Settings' words, while the person holds the browser", async () => {
    render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} />);
    const providerLine = "Cowork's page reads and screenshots go to the model provider that serves your turn.";
    emit(state());
    expect(screen.getByText(providerLine)).toBeInTheDocument();
    expect(document.querySelector('.browser-panel__note')).not.toHaveTextContent(DESKTOP_SIGN_INS);
    emit(state({ control: { holder: 'human', reason: '', since: 2, seq: 1, by: 'person' } }));
    expect(screen.getByText(`${providerLine} ${DESKTOP_SIGN_INS}`)).toBeInTheDocument();
  });

  it.each([
    ['an opener-written blank popup', 'about:blank', 'Your turn on about:blank: Sign in to continue. Click Done to hand it back to Cowork.', 'about:blank'],
    ['a blank popup whose opener set its fragment', 'about:blank#accounts.mindshub.ai', 'Your turn on about:blank: Sign in to continue. Click Done to hand it back to Cowork.', 'about:blank'],
    ['a blank popup whose opener set its query', 'about:blank?accounts.mindshub.ai', 'Your turn on about:blank: Sign in to continue. Click Done to hand it back to Cowork.', 'about:blank'],
    ['a tab with no address yet', '', 'Your turn on a new tab: Sign in to continue. Click Done to hand it back to Cowork.', 'New tab'],
  ])('never puts text the page chooses where the host goes, for %s', async (_name, url, hint, slot) => {
    render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={vi.fn()} />);
    emit(state({
      url,
      title: 'accounts.mindshub.ai',
      tabs: [{ id: 't1', url, title: 'accounts.mindshub.ai', active: true }],
      control: { holder: 'human', reason: 'Sign in to continue', since: 2, seq: 1, by: 'agent' },
    }));
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(document.querySelector('.browser-panel__site')).toHaveTextContent(slot);
    expect(document.querySelector('.browser-panel__site')).not.toHaveTextContent('accounts.mindshub.ai');
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
    expect(calls('hide')).toHaveLength(1);
    emit(state());
    await flush();
    expect(calls('show')).toHaveLength(2);
  });

  it('asks the person for a site\'s sign-in in the pane, with the view parked, and sends only their answer', async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    await flush();
    emit(state({ login: { host: 'intranet.test' }, control: { holder: 'human', reason: 'intranet.test asks for a username and password.', since: 2, seq: 1, by: 'agent' } }));
    await flush();
    expect(calls('setBounds')).toEqual([['setBounds', NOWHERE]]);
    expect(calls('hide')).toEqual([]);
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

  it("puts a waiting download on its own wrapping row, outside the status line's clip", async () => {
    render(<BrowserPanel sessionId="t-abc" onClose={vi.fn()} />);
    const name = `${'quarterly-statement-for-the-account-'.repeat(4)}2026.pdf`;
    emit(state({ downloads: [{ id: '0123456789ab', name, folder: 'Cowork browser f81d4fae-7de', state: 'waiting' }] }));
    const save = screen.getByRole('button', { name: 'Save' });
    const prompt = save.closest('.browser-panel__download-prompt');
    expect(prompt).not.toBeNull();
    expect(prompt).toHaveTextContent(`This page wants to download ${name} to Downloads, in Cowork browser f81d4fae-7de.`);
    expect(prompt).toContainElement(screen.getByRole('button', { name: "Don't save" }));
    expect(save.closest('.browser-panel__status')).toBeNull();

    /* happy-dom does no layout, so pin the rule that keeps the buttons in
       a 440 px pane: the row wraps, and nothing in it is clipped or kept on
       one line. */
    const css = readFileSync(join(__dirname, 'browser-panel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/\.browser-panel__download-prompt \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule).not.toMatch(/overflow:\s*hidden|nowrap/);
    /* The text starts from a fixed width, not its whole sentence, so it
       wraps on the icon's line rather than leave the icon alone above it. */
    const text = css.match(/\.browser-panel__download-text \{([^}]*)\}/)?.[1] ?? '';
    expect(text).toMatch(/flex:\s*1 1 \d+(\.\d+)?(rem|px)\s*;/);
    expect(text).toMatch(/min-width:\s*0/);
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

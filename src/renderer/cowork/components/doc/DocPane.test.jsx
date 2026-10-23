// DocPane against a mocked docs API: it renders the doc, follows the agent's
// writes live, sends the person's edits as ops, and reports what they look at.
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./docApi');

import DocPane, { headerCorner } from './DocPane';
import * as api from './docApi';
import { host } from '../../../platform/host';
import { COMMIT_MS } from './EditableText';

const doc = (rev = 2, extra = []) => ({
  schema: 'cowork.doc/1',
  id: 'a1',
  title: 'Vendor shortlist',
  rev,
  updated_at: new Date().toISOString(),
  tabs: [{
    id: 't_1',
    title: 'Vendor shortlist',
    blocks: [
      { id: 'b_lead', type: 'paragraph', text: 'Acme is the **pick**.', v: 1, by: 'agent' },
      { id: 'b_task', type: 'task', text: 'Sign by Friday', done: false, indent: 0, v: 1, by: 'agent' },
      ...extra,
    ],
  }],
});

beforeEach(() => {
  api.resetDocApi();
  api.fetchDoc.mockResolvedValue({ doc: doc(), capabilities: { canEdit: true } });
  api.postDocOps.mockImplementation(async (_p, _a, { ops }) => {
    const next = doc(3);
    if (ops[0]?.op === 'update' && ops[0].id === 'b_task') next.tabs[0].blocks[1].done = ops[0].set.done;
    return { doc: next, rev: 3, results: [] };
  });
});

describe('DocPane', () => {
  it('renders the doc as a page', async () => {
    render(<DocPane projectRef="p1" artifactId="a1" />);
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveTextContent('Vendor shortlist');
    expect(screen.getByText('pick').tagName).toBe('STRONG');
    expect(screen.getByRole('checkbox', { name: 'Mark done' })).toBeInTheDocument();
  });

  it('shows the agent writing a section as it lands', async () => {
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await screen.findByRole('textbox', { name: 'Title' });
    act(() => {
      api.stream.handlers.onEvent({
        type: 'doc.updated',
        by: 'agent',
        rev: 3,
        touched: { t_1: ['b_new'] },
        doc: doc(3, [{ id: 'b_new', type: 'heading', level: 2, text: 'Risks', v: 3, by: 'agent' }]),
      });
    });
    expect(await screen.findByText('Risks')).toBeInTheDocument();
    expect(screen.getByText('Agent is writing')).toBeInTheDocument();
    expect(document.querySelector('[data-block-id="b_new"]').className).toContain('doc-block--flash');
  });

  it('ignores the echo of its own write and older revisions', async () => {
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await screen.findByRole('textbox', { name: 'Title' });
    act(() => api.stream.handlers.onEvent({ type: 'doc.updated', by: 'agent', rev: 1, doc: doc(1, [{ id: 'b_old', type: 'paragraph', text: 'Stale', v: 1 }]) }));
    expect(screen.queryByText('Stale')).toBeNull();
  });

  it('sends a person\'s edit as an op and keeps the result', async () => {
    const user = userEvent.setup();
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('checkbox', { name: 'Mark done' }));
    await waitFor(() => expect(api.postDocOps).toHaveBeenCalled());
    const [, , body] = api.postDocOps.mock.calls[0];
    expect(body.ops).toEqual([{ op: 'update', id: 'b_task', set: { done: true } }]);
    expect(body.tab).toBe('t_1');
    expect(await screen.findByRole('checkbox', { name: 'Mark not done' })).toBeInTheDocument();
  });

  it('reports the open doc for the next chat message', async () => {
    const onViewChange = vi.fn();
    render(<DocPane projectRef="p1" artifactId="a1" onViewChange={onViewChange} />);
    // Reported from an effect, which can run just after the page appears.
    await waitFor(() => expect(onViewChange).toHaveBeenLastCalledWith(expect.objectContaining({
      artifactId: 'a1', projectId: 'p1', tab: 't_1', rev: 2, mode: 'edit', title: 'Vendor shortlist',
    })));
  });

  it('is read-only for a viewer who cannot edit', async () => {
    api.fetchDoc.mockResolvedValue({ doc: doc(), capabilities: { canEdit: false } });
    render(<DocPane projectRef="p1" artifactId="a1" />);
    const title = await screen.findByLabelText('Title');
    expect(title.getAttribute('contenteditable')).toBe('false');
    expect(screen.queryByRole('button', { name: /^Options for / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add a block below / })).toBeNull();
  });

  it('claims nothing at rest, and says Saving… from the first keystroke until it is saved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let answer;
      api.postDocOps.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      render(<DocPane projectRef="p1" artifactId="a1" />);
      await screen.findByRole('textbox', { name: 'Title' });
      // A doc is always saved; "Saved just now" stuck there for minutes and
      // showed even while keystrokes were still waiting to be sent.
      expect(screen.queryByText(/^Saved/)).toBeNull();
      expect(screen.queryByText('Saving…')).toBeNull();

      await user.type(screen.getByText('Sign by Friday'), '!');
      expect(screen.getByText('Saving…')).toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(COMMIT_MS); });
      expect(api.postDocOps).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Saving…')).toBeInTheDocument();
      await act(async () => { answer({ doc: doc(3), rev: 3, results: [] }); });
      expect(screen.queryByText('Saving…')).toBeNull();
      expect(screen.queryByText(/^Saved/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not say Saving… for typing that edits nothing', async () => {
    // Found in review: any input under the pane counted, so asking the agent
    // for an edit read as "Saving…".
    const user = userEvent.setup();
    render(<DocPane projectRef="p1" artifactId="a1" onAskAgent={() => {}} />);
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'Options for Paragraph “Acme is the pick.”' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit with agent…' }));
    await user.type(screen.getByPlaceholderText('What should change?'), 'Shorter');
    expect(screen.queryByText('Saving…')).toBeNull();
  });

  it('keeps "Edited … ago" current as time passes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      render(<DocPane projectRef="p1" artifactId="a1" />);
      expect(await screen.findByText('Edited just now')).toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(3 * 60_000 + 1000); });
      expect(document.querySelector('.doc-byline').textContent).toContain('Edited 3m ago');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the doc is gone', async () => {
    api.fetchDoc.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    render(<DocPane projectRef="p1" artifactId="a1" />);
    expect(await screen.findByText('This doc no longer exists.')).toBeInTheDocument();
  });
});

describe('DocPane and the passage the chat sends', () => {
  const twoTabs = () => {
    const d = doc();
    d.tabs.push({ id: 't_2', title: 'Risks', blocks: [{ id: 'b_risk', type: 'paragraph', text: 'Lock-in', v: 1 }] });
    return d;
  };
  /** Picks the first `n` letters of `el`'s first words, as the person dragging over them. */
  function pick(el, n) {
    const range = document.createRange();
    range.setStart(el.firstChild, 0);
    range.setEnd(el.firstChild, n);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
  }
  const lastView = (fn) => fn.mock.calls.at(-1)[0];

  afterEach(() => { window.getSelection().removeAllRanges(); });

  it('reports the passage picked until the caret is back in the page', async () => {
    // Found in review: a passage picked once rode on every later message.
    const onViewChange = vi.fn();
    render(<DocPane projectRef="p1" artifactId="a1" onViewChange={onViewChange} />);
    const lead = (await screen.findByText('pick')).parentElement;
    pick(lead, 4);
    await waitFor(() => expect(lastView(onViewChange).selection).toEqual({ blockIds: ['b_lead'], quote: 'Acme' }));

    const range = document.createRange();
    range.setStart(lead.firstChild, 2);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    await waitFor(() => expect(lastView(onViewChange)).not.toHaveProperty('selection'));
  });

  it('drops the pick when another tab opens, for good', async () => {
    // Found in review: it stayed, and went out with the other tab's id.
    api.fetchDoc.mockResolvedValue({ doc: twoTabs(), capabilities: { canEdit: true } });
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<DocPane projectRef="p1" artifactId="a1" onViewChange={onViewChange} />);
    pick((await screen.findByText('pick')).parentElement, 4);
    await waitFor(() => expect(lastView(onViewChange).selection).toBeDefined());

    await user.click(screen.getByRole('tab', { name: 'Risks' }));
    await waitFor(() => expect(lastView(onViewChange).tab).toBe('t_2'));
    expect(lastView(onViewChange)).not.toHaveProperty('selection');
    await user.click(screen.getByRole('tab', { name: 'Vendor shortlist' }));
    await waitFor(() => expect(lastView(onViewChange).tab).toBe('t_1'));
    expect(lastView(onViewChange)).not.toHaveProperty('selection');
  });
});

describe('DocPane when the app\'s server is unreachable', () => {
  it('keeps an edit made while the server is down and saves it once it answers', async () => {
    // Found killing the server mid-edit: the edit was dropped, and the doc
    // reloaded without it once the server came back.
    const user = userEvent.setup();
    let down = true;
    const sent = [];
    api.postDocOps.mockImplementation(async (_p, _a, body) => {
      sent.push(body.ops);
      if (down) throw new TypeError('Failed to fetch');
      const next = doc(3);
      next.tabs[0].blocks[1].done = true;
      return { doc: next, rev: 3, results: [] };
    });
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('checkbox', { name: 'Mark done' }));
    expect(await screen.findByText(/Your edits are kept here/)).toBeInTheDocument();
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();
    // Still shown as done: the edit is kept, not rolled back.
    expect(screen.getByRole('checkbox', { name: 'Mark not done' })).toBeInTheDocument();

    down = false;
    act(() => api.stream.handlers.onReconnect());
    await waitFor(() => expect(screen.queryByText(/Your edits are kept here/)).toBeNull());
    expect(sent.at(-1)).toEqual([{ op: 'update', id: 'b_task', set: { done: true } }]);
    expect(screen.queryByText('Not saved yet')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Mark not done' })).toBeInTheDocument();
  });

  it('retries on its own while the stream has not noticed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let calls = 0;
      api.postDocOps.mockImplementation(async () => {
        calls += 1;
        if (calls < 3) throw new TypeError('Failed to fetch');
        return { doc: doc(3), rev: 3, results: [] };
      });
      render(<DocPane projectRef="p1" artifactId="a1" />);
      await user.click(await screen.findByRole('checkbox', { name: 'Mark done' }));
      expect(calls).toBe(1);
      expect(await screen.findByText(/Your edits are kept here/)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(calls).toBe(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(calls).toBe(3);
      expect(screen.queryByText(/Your edits are kept here/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says an edit the server failed on was not saved, not that the server cannot be reached', async () => {
    // Found in review: a 5xx said "Can’t reach Cowork’s local server" and
    // promised to save the edit later, then sent it again.
    const user = userEvent.setup();
    api.postDocOps.mockRejectedValue(Object.assign(new Error('Doc request failed (500)'), { status: 500 }));
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('checkbox', { name: 'Mark done' }));
    expect(await screen.findByText('That edit was not saved: Doc request failed (500)')).toBeInTheDocument();
    expect(screen.queryByText(/Can’t reach/)).toBeNull();
    expect(screen.queryByText('Not saved yet')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Mark done' })).toBeInTheDocument();
    expect(api.postDocOps).toHaveBeenCalledTimes(1);
  });

  it('still drops an edit the server refused, and says so', async () => {
    const user = userEvent.setup();
    api.postDocOps.mockRejectedValue(Object.assign(new Error('no such block'), { status: 422, code: 'no_block' }));
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('checkbox', { name: 'Mark done' }));
    expect(await screen.findByText('That edit was not saved: no such block')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mark done' })).toBeInTheDocument());
    expect(api.postDocOps).toHaveBeenCalledTimes(1);
  });
});

describe('DocPane export', () => {
  it('does not claim the file is saved while the save dialog is still open', async () => {
    // Found on the packaged app: "Saved X.docx" showed behind the macOS save
    // dialog, and stayed true-sounding after Cancel.
    const user = userEvent.setup();
    api.downloadDocExport.mockResolvedValue('Vendor-shortlist.docx');
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Word (.docx)' }));
    expect(await screen.findByText('Exporting Vendor-shortlist.docx…')).toBeInTheDocument();
    expect(screen.queryByText(/^Saved/)).toBeNull();
    expect(api.downloadDocExport).toHaveBeenCalledWith('p1', 'a1', 'docx');
  });
});


describe('DocPane adding a tab', () => {
  it('adds one from a doc of one tab, and opens it with its title ready to name', async () => {
    const two = { ...doc(3), tabs: [...doc(3).tabs, { id: 't_new', title: 'Untitled', blocks: [] }] };
    api.postDocOps.mockResolvedValue({ doc: two, rev: 3, results: [] });
    const user = userEvent.setup();
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('button', { name: 'Add tab' }));
    await waitFor(() => expect(api.postDocOps).toHaveBeenCalled());
    expect(api.postDocOps.mock.calls[0][2].ops).toEqual([{ op: 'add_tab', title: 'Untitled' }]);
    expect(await screen.findByRole('tab', { name: 'Untitled', selected: true })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveTextContent('Untitled');
    expect(window.getSelection().toString()).toBe('Untitled');
  });
});


describe('DocPane folding the tabs away', () => {
  const twoTabs = (rev = 2, extra = []) => ({
    ...doc(rev),
    tabs: [...doc(rev).tabs, { id: 't_2', title: 'Risks', blocks: [{ id: 'b_risk', type: 'paragraph', text: 'Slips.', v: 1 }, ...extra] }],
  });
  beforeEach(() => {
    localStorage.removeItem('cowork:doc-tabs-hidden:v1');
    api.fetchDoc.mockResolvedValue({ doc: twoTabs(), capabilities: { canEdit: true } });
  });
  afterEach(() => localStorage.removeItem('cowork:doc-tabs-hidden:v1'));

  it('folds the rail away and brings it back from the header, and keeps the choice for the next doc', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('button', { name: 'Hide tabs' }));
    expect(document.querySelector('.doc-tabs')).toHaveAttribute('data-hidden');
    const show = screen.getByRole('button', { name: 'Show tabs' });
    await waitFor(() => expect(show).toHaveFocus());
    unmount();

    render(<DocPane projectRef="p1" artifactId="a2" />);
    await user.click(await screen.findByRole('button', { name: 'Show tabs' }));
    expect(document.querySelector('.doc-tabs')).not.toHaveAttribute('data-hidden');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Vendor shortlist', selected: true })).toHaveFocus());
    expect(screen.queryByRole('button', { name: /Show tabs/ })).toBeNull();
  });

  it('marks the way back when the agent changes a tab out of sight', async () => {
    const user = userEvent.setup();
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('button', { name: 'Hide tabs' }));
    act(() => api.stream.handlers.onEvent({
      type: 'doc.updated', by: 'agent', rev: 3, touched: { t_2: ['b_new'] },
      doc: twoTabs(3, [{ id: 'b_new', type: 'paragraph', text: 'New risk.', v: 3, by: 'agent' }]),
    }));
    expect(await screen.findByRole('button', { name: 'Show tabs (a tab has changed)' })).toBeInTheDocument();
  });
});

describe('the header in a corner something is drawn over', () => {
  // The desktop app on a Mac, which draws the window's buttons over the page.
  function asMacApp() {
    const wasElectron = host.isElectron;
    host.isElectron = true;
    const isMac = vi.spyOn(host, 'isMac').mockReturnValue(true);
    return () => { host.isElectron = wasElectron; isMac.mockRestore(); };
  }

  it('is the window title bar when it fills the window on a Mac', () => {
    const restore = asMacApp();
    try {
      expect(headerCorner({ fillsWindow: true })).toBe('window');
      expect(headerCorner({ fillsWindow: true, expanded: true })).toBe('window');
    } finally { restore(); }
  });

  it('needs no room where nothing is drawn over the window', () => {
    expect(headerCorner({ fillsWindow: true })).toBeUndefined(); // the web
    const wasElectron = host.isElectron;
    host.isElectron = true; // Windows and Linux draw their title bar above the page
    const isMac = vi.spyOn(host, 'isMac').mockReturnValue(false);
    try {
      expect(headerCorner({ fillsWindow: true })).toBeUndefined();
    } finally { host.isElectron = wasElectron; isMac.mockRestore(); }
  });

  it('leaves room beside the open-sidebar button when expanded', () => {
    expect(headerCorner({ expanded: true })).toBe('main');
    expect(headerCorner({ expanded: false })).toBeUndefined();
  });

  it('keeps where it starts in the window, for the header to clear the shell\'s button', async () => {
    let observed;
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb) { observed = cb; }
      observe() {}
      disconnect() {}
    });
    try {
      render(<DocPane projectRef="p1" artifactId="a1" expanded />);
      await screen.findByRole('textbox', { name: 'Title' });
      const pane = screen.getByRole('region', { name: 'Vendor shortlist' });
      expect(pane).toHaveAttribute('data-corner', 'main');
      vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 20.4 });
      act(() => observed([{ target: pane, contentRect: { width: 1100 } }]));
      expect(pane.style.getPropertyValue('--doc-left')).toBe('20px');
    } finally { vi.unstubAllGlobals(); }
  });

  it('marks the corner on the pane', async () => {
    const restore = asMacApp();
    try {
      render(<DocPane projectRef="p1" artifactId="a1" fillsWindow />);
      await screen.findByRole('textbox', { name: 'Title' });
      expect(screen.getByRole('region', { name: 'Vendor shortlist' })).toHaveAttribute('data-corner', 'window');
    } finally { restore(); }
  });
});

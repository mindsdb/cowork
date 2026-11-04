// The shared page decides who it is talking to: the owner gets the editor, a
// signed-out visitor a way to sign in, everyone else the published page as is.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { boot, pageAddress } from './main.jsx';

const PATH = '/content/215f76ea7/4bbd890f/v/e26210404cd0f3003aac0f842d14cd03/index.html';
const doc = { schema: 'cowork.doc/1', id: 'a1', title: 'Q4 pipeline review', rev: 7,
  tabs: [{ id: 't_1', title: 'Review', blocks: [{ id: 'b_1', type: 'paragraph', text: 'Pipeline is $4.8M.', v: 1, by: 'agent' }] }] };

function win(pathname = PATH) {
  return { location: { pathname }, matchMedia: () => ({ matches: false }) };
}

let styles = [];

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = "<main class='page'><h1>Q4 pipeline review</h1><p>Static copy</p></main>";
  // The stylesheet is injected for the owner: note it and let it "load" at once
  // (happy-dom would otherwise try to fetch it).
  styles = [];
  vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
    styles.push(el);
    el.onload?.();
    return el;
  });
  globalThis.EventSource = class { addEventListener() {} close() {} };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('shared page boot', () => {
  it('knows its own address from the frame it is served in, stage prefix included', () => {
    expect(pageAddress(PATH)).toEqual({
      prefix: '',
      api: '/v1/viewer/artifact-docs/215f76ea7/4bbd890f',
      signIn: '/view/215f76ea7/4bbd890f?signin=1',
    });
    expect(pageAddress(`/Prod${PATH}`).api).toBe('/Prod/v1/viewer/artifact-docs/215f76ea7/4bbd890f');
    expect(pageAddress('/some/other/page.html')).toBeNull();
  });

  it('takes no address that would send the sign-in link off-site', () => {
    expect(pageAddress(`//evil.example${PATH}`)).toBeNull();
    expect(pageAddress(`/evil.example${PATH}`)).toBeNull();
    expect(pageAddress(`/a/b${PATH}`)).toBeNull();
  });

  it('becomes the editor for the signed-in owner', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ doc, rev: 7, ownerOnline: true, capabilities: { canEdit: true } }) }));
    expect(await boot(win())).toBe('editing');
    expect(document.querySelector('main.page').hidden).toBe(true);
    expect(styles.map((l) => [l.rel, l.href])).toEqual([['stylesheet', expect.stringMatching(/doc-editor\.css$/)]]);
    expect(await screen.findByText('Pipeline is $4.8M.')).toBeInTheDocument();
    expect(screen.getByText('You can edit this')).toBeInTheDocument();
  });

  it('follows the system between light and dark', async () => {
    // Found in review: the theme was read once, at boot.
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ doc, rev: 7, ownerOnline: true, capabilities: { canEdit: true } }) }));
    const listeners = [];
    const scheme = { matches: false, addEventListener: (type, fn) => { if (type === 'change') listeners.push(fn); } };
    await boot({ ...win(), matchMedia: () => scheme });
    // Mounted before the test ends, so its stream does not open in the next one.
    await screen.findByText('Pipeline is $4.8M.');
    expect(document.body.dataset.theme).toBe('light');
    scheme.matches = true;
    for (const fn of listeners) fn();
    expect(document.body.dataset.theme).toBe('dark');
  });

  it('offers a signed-out visitor a way to sign in, and changes nothing else', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(await boot(win())).toBe('signed-out');
    const link = screen.getByRole('link', { name: 'Your doc? Sign in to edit' });
    expect(link.getAttribute('href')).toBe('/view/215f76ea7/4bbd890f?signin=1');
    expect(link.getAttribute('target')).toBe('_top');
    expect(document.querySelector('main.page').hidden).toBe(false);
  });

  it('stays the published page for anyone else', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    expect(await boot(win())).toBe('view-only');
    expect(document.querySelector('main.page').hidden).toBe(false);
    expect(screen.queryByRole('link')).toBeNull();
    expect(styles).toEqual([]);
  });

  it('stays the published page, quietly, where the viewer redirects the route away', async () => {
    // Staging before the route is deployed: a catch-all 302s to another site.
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 0, type: 'opaqueredirect', json: async () => null }));
    expect(await boot(win())).toBe('view-only');
    expect(globalThis.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(document.body.textContent).toContain('Static copy');
  });

  it('stays the published page for a doc in a format newer than this editor', async () => {
    // The page editor ships with the app binary; the server writing the doc
    // updates on its own, so it can be ahead.
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ doc: { ...doc, schema: 'cowork.doc/2' }, rev: 7, ownerOnline: true, capabilities: { canEdit: true } }) }));
    expect(await boot(win())).toBe('view-only');
    expect(document.querySelector('main.page').hidden).toBe(false);
    expect(styles).toEqual([]);
  });

  it('asks for a reload once the page\'s grant to the door lapses, keeping what was typed on screen', async () => {
    // The grant is minted when the doc's page loads and lapses after ten
    // minutes unanswered (a laptop asleep, say); the door then refuses
    // everything with this 403, and the page showed "Request failed (403)".
    const user = userEvent.setup();
    const task = { ...doc, tabs: [{ ...doc.tabs[0], blocks: [{ id: 'b_task', type: 'task', text: 'Book the review', done: false, indent: 0, v: 1 }] }] };
    globalThis.fetch = vi.fn(async (url, opts = {}) => (opts.method === 'POST'
      ? { ok: false, status: 403, json: async () => ({ error: 'artifact access required' }) }
      : { ok: true, status: 200, json: async () => ({ doc: task, rev: 7, ownerOnline: true, capabilities: { canEdit: true } }) }));
    const streams = [];
    globalThis.EventSource = class { constructor() { this.closed = false; streams.push(this); } addEventListener() {} close() { this.closed = true; } };
    const reload = vi.fn();
    await boot({ ...win(), top: { location: { reload } } });

    await user.click(await screen.findByRole('checkbox', { name: 'Mark done' }));
    expect(await screen.findByText(/This page has been open a while\. Reload to keep editing\./)).toBeInTheDocument();
    expect(screen.getByText(/Your last change wasn’t saved yet\./)).toBeInTheDocument();
    expect(screen.queryByText(/Request failed/)).toBeNull();
    expect(screen.queryByText(/not saved:/)).toBeNull();
    // Paused, not dropped: still shown as the person left it, and nothing more is sent.
    expect(screen.getByRole('checkbox', { name: 'Mark not done' })).toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(streams.map((st) => st.closed)).toEqual([true]);

    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads its own window when the top one is on another site', async () => {
    const user = userEvent.setup();
    const task = { ...doc, tabs: [{ ...doc.tabs[0], blocks: [{ id: 'b_task', type: 'task', text: 'Book the review', done: false, indent: 0, v: 1 }] }] };
    globalThis.fetch = vi.fn(async (url, opts = {}) => (opts.method === 'POST'
      ? { ok: false, status: 403, json: async () => ({ error: 'artifact access required' }) }
      : { ok: true, status: 200, json: async () => ({ doc: task, rev: 7, ownerOnline: true, capabilities: { canEdit: true } }) }));
    globalThis.EventSource = class { addEventListener() {} close() {} };
    const own = vi.fn();
    const crossOrigin = { location: { reload: () => { throw new DOMException('Blocked a frame', 'SecurityError'); } } };
    await boot({ ...win(), location: { ...win().location, reload: own }, top: crossOrigin });
    await user.click(await screen.findByRole('checkbox', { name: 'Mark done' }));
    await user.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('keeps the grant alive while the page is open and in view', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200,
        json: async () => ({ doc, rev: 7, ownerOnline: true, capabilities: { canEdit: true } }) }));
      await boot(win());
      await screen.findByText('Pipeline is $4.8M.');
      const reads = () => globalThis.fetch.mock.calls.length;
      const before = reads();
      act(() => { vi.advanceTimersByTime(240_000); });
      expect(reads()).toBe(before + 1);
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      act(() => { vi.advanceTimersByTime(240_000); });
      expect(reads()).toBe(before + 1);
    } finally {
      delete document.visibilityState;
      vi.useRealTimers();
    }
  });

  it('is read-only while the owner\'s computer is away', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ doc, rev: 7, ownerOnline: false, capabilities: { canEdit: true } }) }));
    await boot(win());
    expect(await screen.findByText(/Open MindsHub Cowork on your computer to edit/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('View only')).toBeInTheDocument());
    expect(screen.getByLabelText('Title').getAttribute('contenteditable')).toBe('false');
  });
});

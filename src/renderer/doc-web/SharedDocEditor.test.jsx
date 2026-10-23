// The owner's editor on a shared page, over a fake cloud transport (and, for
// an owner who is away, the real one over a fake relay).
import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SharedDocEditor from './SharedDocEditor';
import { createCloudTransport } from './cloudTransport';

const doc = { schema: 'cowork.doc/1', id: 'a1', title: 'Launch plan', rev: 3,
  tabs: [{ id: 't_1', title: 'Launch plan', blocks: [
    { id: 'b_task', type: 'task', text: 'Book the security review', done: true, indent: 0, v: 1, by: 'agent' },
  ] }] };

function transport(postDocOps) {
  return {
    fetchDoc: vi.fn(async () => ({ doc, capabilities: { canEdit: true } })),
    followDoc: vi.fn(() => () => {}),
    postDocOps,
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('SharedDocEditor', () => {
  it('says an edit is waiting for the owner\'s computer until it is applied', async () => {
    // Found on the stand-in: with the desktop away the banner read "That edit
    // was not saved: … It will apply when the app is open", and stayed after
    // the edit had been applied.
    const user = userEvent.setup();
    let defer;
    let applied;
    const t = transport(vi.fn((_p, _a, _body, { onDeferred }) => new Promise((resolve) => {
      defer = () => onDeferred(Object.assign(new Error('MindsHub Cowork on your computer has not saved this yet.'), { code: 'owner_offline' }));
      applied = resolve;
    })));
    const { rerender } = render(<SharedDocEditor transport={t} presence={true} removed={false} />);
    await user.click(await screen.findByRole('checkbox', { name: 'Mark not done' }));
    await waitFor(() => expect(defer).toBeTypeOf('function'));
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    // As the cloud transport does: the owner is reported away, and the edit deferred.
    rerender(<SharedDocEditor transport={t} presence={false} removed={false} />);
    act(() => defer());
    const banner = await screen.findByText(/Your edits are waiting for MindsHub Cowork on your computer/);
    expect(banner.textContent).not.toMatch(/not saved/);
    expect(screen.getByText('Waiting for your computer')).toBeInTheDocument();
    expect(screen.queryByText('Saving…')).toBeNull();
    // Nothing to dismiss: it is still true.
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    // Still shown as the person left it.
    expect(screen.getByRole('checkbox', { name: 'Mark done' })).toBeInTheDocument();

    // Seen again, but the edit not yet applied: still waiting.
    rerender(<SharedDocEditor transport={t} presence={true} removed={false} />);
    expect(screen.getByText(/Your edits are waiting for/)).toBeInTheDocument();
    await act(async () => { applied({ doc: { ...doc, rev: 4, tabs: [{ ...doc.tabs[0], blocks: [{ ...doc.tabs[0].blocks[0], done: false }] }] } }); });
    expect(screen.queryByText(/is waiting for/)).toBeNull();
    expect(screen.queryByText('Waiting for your computer')).toBeNull();
  });

  it('still says plainly when an edit was refused', async () => {
    const user = userEvent.setup();
    const t = transport(vi.fn(async () => { throw Object.assign(new Error('no such block'), { code: 'no_block' }); }));
    render(<SharedDocEditor transport={t} presence={true} removed={false} />);
    await user.click(await screen.findByRole('checkbox', { name: 'Mark not done' }));
    expect(await screen.findByText('That edit was not saved: no such block')).toBeInTheDocument();
  });

  it('is view only when the live copy does not say it may be edited', async () => {
    const t = { ...transport(vi.fn()), fetchDoc: vi.fn(async () => ({ doc, capabilities: { canEdit: false } })) };
    render(<SharedDocEditor transport={t} presence={true} removed={false} />);
    expect(await screen.findByText('View only')).toBeInTheDocument();
    expect(screen.getByLabelText('Title').getAttribute('contenteditable')).toBe('false');
  });
});

/** The page as boot() mounts it: presence comes from the transport. */
function Page({ transport: t }) {
  const [presence, setPresence] = useState(null);
  const [live] = useState(() => t(setPresence));
  return <SharedDocEditor transport={live} presence={presence} removed={false} />;
}

class FakeSource {
  static last = null;
  constructor() { this.handlers = {}; FakeSource.last = this; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  emit(type, data) { this.handlers[type]?.({ data: JSON.stringify(data) }); }
  close() {}
}

describe('SharedDocEditor while the owner\'s computer is away', () => {
  it('keeps what was typed behind the edit that waits, and sends it once that one is applied', async () => {
    // Found in review: the wait for the desktop ended as a refusal, which
    // cleared the queue. Only the first edit reached MindsHub, so everything
    // typed after it was silently dropped.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const sent = [];
    const fetchImpl = vi.fn(async (url, opts = {}) => {
      const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
      if (url.endsWith('/edits') && opts.method === 'POST') {
        sent.push(JSON.parse(opts.body));
        return reply({ id: `e${sent.length}`, status: 'pending', ownerOnline: true }, 202);
      }
      if (/\/edits\/e\d+$/.test(url)) return reply({ id: url.split('/').pop(), status: 'pending' });
      return reply({ doc, rev: 3, ownerOnline: true, capabilities: { canEdit: true } });
    });
    render(<Page transport={(onPresence) => createCloudTransport('/api', { fetchImpl, onPresence, EventSourceImpl: FakeSource })} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Mark not done' }));
    await user.click(screen.getByRole('checkbox', { name: 'Mark done' }));
    expect(sent).toHaveLength(1);

    // Unanswered: the owner is away, and the page says both edits wait.
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(await screen.findByText(/Your edits are waiting for/)).toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mark not done' })).toBeInTheDocument();
    expect(sent).toHaveLength(1);

    // Back: the desktop applies the first edit, mirrors, and reports.
    const appliedDoc = { ...doc, rev: 4, tabs: [{ ...doc.tabs[0], blocks: [{ ...doc.tabs[0].blocks[0], done: false }] }] };
    await act(async () => {
      FakeSource.last.emit('doc.state', { rev: 4, doc: appliedDoc });
      FakeSource.last.emit('doc.edit.result', { id: 'e1', status: 'applied', rev: 4 });
    });
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ ops: [{ op: 'update', id: 'b_task', set: { done: true } }], baseRev: 4 });
    expect(screen.queryByText(/Your edits are waiting for/)).toBeNull();
  });
});

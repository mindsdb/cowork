// The version history's pieces on their own: the menu's rows in every state,
// the confirmation's words and keys, and the note after a restore.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RestoreDialog, RestoredNote, versionItems } from './DocVersions';

const NOW = new Date('2026-10-23T16:05:00Z');
const at = (iso) => iso;
const LIST = {
  current: { rev: 12, at: at('2026-10-23T16:03:00Z'), by: 'user', summary: 'Budget: Retargeting 40 → 32' },
  versions: [
    { rev: 9, at: at('2026-10-23T15:48:00Z'), by: 'user', summary: 'Budget: added row “Podcast ads”' },
    { rev: 2, at: at('2026-10-22T11:04:00Z'), by: 'agent', summary: 'First draft · 4 tabs' },
  ],
};
const rows = (props) => versionItems({ previewing: undefined, onPick: vi.fn(), onCurrent: vi.fn(), now: NOW, ...props });
const keys = (items) => items.map((i) => i.key || (typeof i.heading === 'string' ? i.heading : 'heading'));

describe('the menu\'s rows', () => {
  it('say they are loading, or that they could not be loaded', () => {
    expect(keys(rows({ list: null }))).toEqual(['heading', 'loading']);
    expect(keys(rows({ list: { failed: true } }))).toEqual(['heading', 'failed']);
  });

  it('are the doc now and nothing earlier yet, for a new doc', () => {
    expect(keys(rows({ list: { current: LIST.current, versions: [] } }))).toEqual(['heading', 'current', 'none']);
  });

  it('are the doc now, then each version under its day, then a word on what picking one does', () => {
    const onPick = vi.fn();
    const items = rows({ list: LIST, onPick });
    expect(keys(items)).toEqual(['heading', 'current', 'Today', 'v9', 'Yesterday', 'v2', 'heading']);
    items.find((i) => i.key === 'v2').onClick();
    expect(onPick).toHaveBeenCalledWith(LIST.versions[1]);
  });

  it('mark who made each version, and neither for a version kept before authors were recorded', () => {
    const items = rows({ list: { current: LIST.current, versions: [...LIST.versions, { rev: 1, at: LIST.versions[1].at, by: null, summary: null }] } });
    const { container } = render(<>{items.filter((i) => i.icon).map((i) => <span key={i.key}>{i.icon}</span>)}</>);
    expect([...container.querySelectorAll('svg')].map((svg) => [...svg.classList].find((c) => c.startsWith('lucide-')))).toEqual([
      'lucide-user-round', 'lucide-user-round', 'lucide-sparkles', 'lucide-rotate-ccw-clock',
    ]);
  });

  it('tick the doc now, or mark the version being looked at', () => {
    render(<>{rows({ list: LIST }).find((i) => i.key === 'current').hint}</>);
    expect(document.querySelector('.doc-versions__mark')).not.toBeNull();
    const looking = rows({ list: LIST, previewing: 9 });
    expect(looking.find((i) => i.key === 'current').hint).toBeNull();
    render(<>{looking.find((i) => i.key === 'v9').hint}</>);
    expect(document.querySelector('.doc-versions__look--on')).not.toBeNull();
  });
});

function history(props = {}) {
  return {
    preview: { entry: LIST.versions[0], doc: {} },
    confirming: true,
    restoring: false,
    restore: vi.fn(),
    cancelRestore: vi.fn(),
    ...props,
  };
}

describe('the confirmation', () => {
  it('says when the doc goes back to, who made that version, and that nothing is lost', () => {
    render(<RestoreDialog history={history()} now={NOW} />);
    const dialog = screen.getByRole('dialog', { name: 'Restore this version?' });
    expect(dialog).toHaveTextContent('The doc goes back to how it looked today at 3:48 PM.');
    expect(dialog).toHaveTextContent('3:48 PM · You');
    expect(dialog).toHaveTextContent('Budget: added row “Podcast ads”');
    expect(dialog).toHaveTextContent('Nothing is lost.');
    expect(dialog).not.toHaveTextContent('The shared page updates too.');
  });

  it('says the agent, still writing, will write on over the version restored', () => {
    const { unmount } = render(<RestoreDialog history={history()} agentWriting now={NOW} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Agent is still writing. What it writes next lands on the version you restore.');
    unmount();
    render(<RestoreDialog history={history()} now={NOW} />);
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Agent is still writing');
  });

  it('keeps the agent note once seen, as the agent writes in bursts, until the dialog closes', () => {
    const { rerender } = render(<RestoreDialog history={history()} agentWriting now={NOW} />);
    rerender(<RestoreDialog history={history()} agentWriting={false} now={NOW} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Agent is still writing.');
    rerender(<RestoreDialog history={history({ confirming: false })} agentWriting={false} now={NOW} />);
    rerender(<RestoreDialog history={history()} agentWriting={false} now={NOW} />);
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Agent is still writing.');
  });

  it('says a shared page follows', () => {
    render(<RestoreDialog history={history()} shared now={NOW} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('The shared page updates too.');
  });

  it('restores on Enter, but leaves Enter on a focused button to that button', async () => {
    const h = history();
    render(<RestoreDialog history={h} now={NOW} />);
    await new Promise((r) => setTimeout(r));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(h.restore).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Cancel' }).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.restore).toHaveBeenCalledTimes(1);
  });

  it('shows the restore under way and takes no second one', async () => {
    const h = history({ restoring: true });
    render(<RestoreDialog history={h} now={NOW} />);
    expect(screen.getByRole('button', { name: 'Restoring…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await new Promise((r) => setTimeout(r));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(h.restore).not.toHaveBeenCalled();
  });

  it('is nothing without a version being looked at', () => {
    const { container } = render(<RestoreDialog history={history({ preview: null })} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the note after a restore', () => {
  it('names the version brought back and offers to undo it', async () => {
    const undo = vi.fn();
    render(<RestoredNote history={{ restored: { entry: LIST.versions[1], replacedRev: 12 }, undo }} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent('Restored the version from yesterday at 11:04 AM');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalled();
  });

  it('is nothing before a restore', () => {
    const { container } = render(<RestoredNote history={{ restored: null }} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

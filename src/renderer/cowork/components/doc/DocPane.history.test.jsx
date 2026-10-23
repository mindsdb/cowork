// DocPane's version history against a mocked docs API: the clock lists the
// versions, one is looked at read-only in place of the doc with what differs
// now marked, and it is restored after a confirmation, with Undo after.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./docApi');

import DocPane from './DocPane';
import * as api from './docApi';

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

const doc = (rev, lead, tabs = []) => ({
  schema: 'cowork.doc/1',
  id: 'a1',
  title: 'Launch plan',
  rev,
  updated_at: minutesAgo(2),
  tabs: [
    {
      id: 't_1',
      title: 'Overview',
      blocks: [
        { id: 'b_lead', type: 'paragraph', text: lead, v: rev, by: 'user' },
        { id: 'b_task', type: 'task', text: 'Book the review', done: false, indent: 0, v: 1, by: 'agent' },
      ],
    },
    { id: 't_2', title: 'Budget', blocks: [{ id: 'b_spend', type: 'paragraph', text: 'Spend.', v: 1 }] },
    ...tabs,
  ],
});
const NOW = doc(12, 'We launch on Nov 18.');
const BEFORE = doc(7, 'We launch in November.', [
  { id: 't_3', title: 'Old notes', blocks: [{ id: 'b_old', type: 'paragraph', text: 'Since cut.', v: 3 }] },
]);
const LIST = {
  current: { rev: 12, at: minutesAgo(2), by: 'user', summary: 'Overview: edited “We launch on Nov 18.”' },
  versions: [
    { rev: 7, at: minutesAgo(30), by: 'agent', summary: 'Added the Old notes tab' },
    { rev: 2, at: minutesAgo(60), by: 'agent', summary: 'First draft · 3 tabs' },
  ],
};

beforeEach(() => {
  api.resetDocApi();
  api.fetchDoc.mockResolvedValue({ doc: NOW, capabilities: { canEdit: true } });
  api.fetchDocHistory.mockResolvedValue(LIST);
  api.fetchDocVersion.mockImplementation(async (_p, _a, rev) => (rev === 7 ? BEFORE : doc(2, 'Draft.')));
  api.restoreDocVersion.mockResolvedValue({ doc: doc(13, 'We launch in November.'), replacedRev: 12 });
});

async function openHistory(user) {
  render(<DocPane projectRef="p1" artifactId="a1" />);
  await user.click(await screen.findByRole('button', { name: 'Version history' }));
  return screen.findByRole('menu', { name: 'Version history' });
}

async function lookAtVersion7(user) {
  const menu = await openHistory(user);
  await user.click(await within(menu).findByRole('menuitem', { name: /Added the Old notes tab/ }));
  return screen.findByText(/Viewing/);
}

describe('DocPane version history', () => {
  it('lists the doc now and its versions under the clock, newest first, with who and what changed', async () => {
    const user = userEvent.setup();
    const menu = await openHistory(user);
    expect(api.fetchDocHistory).toHaveBeenCalledWith('p1', 'a1');
    const rows = await within(menu).findAllByRole('menuitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Current version'),
      expect.stringMatching(/· Agent.*Added the Old notes tab/),
      expect.stringMatching(/· Agent.*First draft · 3 tabs/),
    ]);
    expect(rows[0].textContent).toContain('2 min ago');
    expect(within(menu).getByText('Today')).toBeInTheDocument();
  });

  it('shows a version read-only in place of the doc, its tabs, and what reads differently now', async () => {
    const user = userEvent.setup();
    const banner = await lookAtVersion7(user);
    expect(api.fetchDocVersion).toHaveBeenCalledWith('p1', 'a1', 7);
    expect(banner.closest('[role="status"]')).toHaveTextContent(/Viewing Today, .* · Added the Old notes tab/);
    expect(screen.getByText('We launch in November.')).toBeInTheDocument();
    expect(document.querySelector('[data-block-id="b_lead"]').className).toContain('doc-block--changed');
    expect(document.querySelector('[data-block-id="b_task"]').className).not.toContain('doc-block--changed');
    expect(screen.getByRole('tab', { name: 'Old notes' })).toBeInTheDocument(); // a tab since cut
    expect(screen.getByRole('checkbox', { name: 'Mark done' })).toBeDisabled(); // read-only
  });

  it('steps through the versions with the arrows, and goes back to the doc', async () => {
    const user = userEvent.setup();
    await lookAtVersion7(user);
    expect(screen.getByRole('button', { name: 'Newer version' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Older version' }));
    expect(await screen.findByText('Draft.')).toBeInTheDocument();
    expect(api.fetchDocVersion).toHaveBeenLastCalledWith('p1', 'a1', 2);
    expect(screen.getByRole('button', { name: 'Older version' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Back to current' }));
    expect(screen.queryByText(/Viewing/)).toBeNull();
    expect(await screen.findByText('We launch on Nov 18.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mark done' })).toBeEnabled();
  });

  it('restores a version after a confirmation, and undoes it', async () => {
    const user = userEvent.setup();
    await lookAtVersion7(user);
    await user.click(screen.getByRole('button', { name: 'Restore this version' }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this version?' });
    expect(dialog).toHaveTextContent(/The doc goes back to how it looked today at /);
    expect(dialog).toHaveTextContent('Nothing is lost. The current version stays in version history');
    expect(dialog).not.toHaveTextContent('The shared page updates too.'); // not shared
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(api.restoreDocVersion).toHaveBeenCalledWith('p1', 'a1', 7);
    expect(await screen.findByText(/Restored the version from /)).toBeInTheDocument();
    expect(screen.queryByText(/Viewing/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(api.restoreDocVersion).toHaveBeenLastCalledWith('p1', 'a1', 12);
    await waitFor(() => expect(screen.queryByText(/Restored the version from /)).toBeNull());
  });

  it('takes the restored doc from the stream, like any other write', async () => {
    const user = userEvent.setup();
    await lookAtVersion7(user);
    await user.click(screen.getByRole('button', { name: 'Restore this version' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restore' }));
    await screen.findByText(/Restored the version from /);
    api.stream.handlers.onEvent({ type: 'doc.updated', by: 'user', rev: 13, doc: doc(13, 'We launch in November.') });
    expect(await screen.findByText('We launch in November.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mark done' })).toBeEnabled();
  });

  it('says the agent is still writing when it is, before a restore', async () => {
    const user = userEvent.setup();
    await lookAtVersion7(user);
    api.stream.handlers.onEvent({ type: 'doc.updated', by: 'agent', rev: 13, touched: {}, doc: doc(13, 'We launch on Nov 18.') });
    await user.click(screen.getByRole('button', { name: 'Restore this version' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Agent is still writing.');
  });

  it('says why a version could not be opened', async () => {
    api.fetchDocVersion.mockRejectedValueOnce(new Error('that version of the doc is not kept'));
    const user = userEvent.setup();
    const menu = await openHistory(user);
    await user.click(await within(menu).findByRole('menuitem', { name: /Added the Old notes tab/ }));
    expect(await screen.findByText('that version of the doc is not kept')).toBeInTheDocument();
  });

  it('has no clock for someone who cannot edit the doc', async () => {
    api.fetchDoc.mockResolvedValue({ doc: NOW, capabilities: { canEdit: false } });
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await screen.findByText('We launch on Nov 18.');
    expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull();
  });
});

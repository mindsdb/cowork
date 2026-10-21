import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../api', () => ({
  shareLiveApp: vi.fn(),
  fetchLiveAppShares: vi.fn(),
  withdrawLiveAppShare: vi.fn(),
}));

import { LiveAppShareDialog } from './LiveAppShareDialog';
import { fetchLiveAppShares, shareLiveApp, withdrawLiveAppShare } from '../../api';

const app = { slug: 'table-counts', title: 'Table Row Counts', projectId: 'p1', type: 'fullstack-stateless-app' };
const toBen = { shareId: 's1', slug: 'table-counts', email: 'ben@example.com', everyone: false, sharedAt: 't1' };
const toEveryone = { shareId: 's2', slug: 'table-counts', email: null, everyone: true, sharedAt: 't2' };

const renderDialog = () => {
  const onClose = vi.fn();
  render(<LiveAppShareDialog artifact={app} onClose={onClose} />);
  return { dialog: screen.getByRole('dialog'), onClose };
};

// Braces: a function returned from beforeEach runs as its teardown.
beforeEach(() => { fetchLiveAppShares.mockResolvedValue([]); });
afterEach(() => vi.clearAllMocks());

describe('LiveAppShareDialog', () => {
  it('starts on one colleague and waits for an address', () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByRole('radio', { name: 'One colleague' })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: 'ben@example' } });
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeDisabled();
  });

  it('tells the owner, for each audience, that recipients see their email', () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByText(/They see your email beside the app/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Everyone on this stack' }));
    expect(within(dialog).getByText(/including people who join later, sees your email beside the app/)).toBeInTheDocument();
    expect(within(dialog).getByText(/as it is when they duplicate it, including changes you make after sharing/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Stopping a share keeps the copies already made/)).toBeInTheDocument();
  });

  it('shares with one colleague by the trimmed address, and moves focus to Done', async () => {
    shareLiveApp.mockResolvedValue(toBen);
    const { dialog } = renderDialog();

    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: ' ben@example.com ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));

    const message = await within(dialog).findByText(/^Shared with ben@example.com\. It shows under "Shared with you" with your email/);
    expect(shareLiveApp).toHaveBeenCalledWith({ projectId: 'p1', slug: 'table-counts', email: 'ben@example.com' });
    const done = within(dialog).getByRole('button', { name: 'Done' });
    await waitFor(() => expect(done).toHaveFocus());
    expect(done).toHaveAttribute('aria-describedby', message.id);
  });

  it('shares with everyone on the stack, with no address', async () => {
    shareLiveApp.mockResolvedValue(toEveryone);
    const { dialog } = renderDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Everyone on this stack' }));
    expect(within(dialog).queryByLabelText("Colleague's email")).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));

    expect(await within(dialog).findByText(/^Shared with everyone on this stack\./)).toBeInTheDocument();
    expect(shareLiveApp).toHaveBeenCalledWith({ projectId: 'p1', slug: 'table-counts', everyone: true });
  });

  it("shows the server's refusal and keeps the choice open", async () => {
    shareLiveApp.mockRejectedValue(new Error("That's your own address."));
    const { dialog, onClose } = renderDialog();

    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: 'me@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));

    expect(await within(dialog).findByText("That's your own address.")).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Cancel without sharing', () => {
    const { dialog, onClose } = renderDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(shareLiveApp).not.toHaveBeenCalled();
  });

  describe("the app's current shares", () => {
    it('lists each one with "Stop sharing"', async () => {
      fetchLiveAppShares.mockResolvedValue([toEveryone, toBen]);
      const { dialog } = renderDialog();

      const list = await within(dialog).findByRole('region', { name: 'Shared with' });
      expect(fetchLiveAppShares).toHaveBeenCalledWith({ projectId: 'p1', slug: 'table-counts' });
      expect(within(list).getByText('Everyone on this stack')).toBeInTheDocument();
      expect(within(list).getByText('ben@example.com')).toBeInTheDocument();
      expect(within(list).getAllByRole('button', { name: /^Stop sharing with / })).toHaveLength(2);
    });

    it('stops one share and drops it from the list', async () => {
      fetchLiveAppShares.mockResolvedValue([toEveryone, toBen]);
      withdrawLiveAppShare.mockResolvedValue({ ok: true });
      const { dialog } = renderDialog();

      fireEvent.click(await within(dialog).findByRole('button', { name: 'Stop sharing with ben@example.com' }));

      await waitFor(() => expect(within(dialog).queryByText('ben@example.com')).toBeNull());
      expect(withdrawLiveAppShare).toHaveBeenCalledWith('s1');
      const list = within(dialog).getByRole('region', { name: 'Shared with' });
      expect(within(list).getByText('Everyone on this stack')).toBeInTheDocument();
    });

    it("keeps the share and shows the server's sentence when stopping fails", async () => {
      fetchLiveAppShares.mockResolvedValue([toBen]);
      withdrawLiveAppShare.mockRejectedValue(Object.assign(new Error("Couldn't reach the server."), { status: 502 }));
      const { dialog } = renderDialog();

      fireEvent.click(await within(dialog).findByRole('button', { name: 'Stop sharing with ben@example.com' }));

      expect(await within(dialog).findByText("Couldn't reach the server.")).toBeInTheDocument();
      expect(within(dialog).getByText('ben@example.com')).toBeInTheDocument();
    });

    it('drops a share the server says is already gone, since that is what the owner asked for', async () => {
      fetchLiveAppShares.mockResolvedValue([toBen]);
      withdrawLiveAppShare.mockRejectedValue(Object.assign(new Error('This share no longer exists.'), { status: 404 }));
      const { dialog } = renderDialog();

      fireEvent.click(await within(dialog).findByRole('button', { name: 'Stop sharing with ben@example.com' }));

      await waitFor(() => expect(within(dialog).queryByText('ben@example.com')).toBeNull());
      expect(within(dialog).queryByText('This share no longer exists.')).toBeNull();
    });

    it('locks the dialog while a share is stopping, then frees it', async () => {
      fetchLiveAppShares.mockResolvedValue([toEveryone, toBen]);
      let finish;
      withdrawLiveAppShare.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const { dialog, onClose } = renderDialog();

      fireEvent.click(await within(dialog).findByRole('button', { name: 'Stop sharing with ben@example.com' }));

      expect(await within(dialog).findByText('Stopping…')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Share' })).toBeDisabled();
      expect(within(dialog).getByLabelText("Colleague's email")).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Stop sharing with Everyone on this stack' })).toBeDisabled();
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => { finish({ ok: true }); });
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    });

    it('moves focus to the next share after one stops, and says so', async () => {
      fetchLiveAppShares.mockResolvedValue([toBen, toEveryone]);
      withdrawLiveAppShare.mockResolvedValue({ ok: true });
      const { dialog } = renderDialog();

      fireEvent.click(await within(dialog).findByRole('button', { name: 'Stop sharing with ben@example.com' }));

      const next = within(dialog).getByRole('button', { name: 'Stop sharing with Everyone on this stack' });
      await waitFor(() => expect(next).toHaveFocus());
      expect(screen.getByRole('status')).toHaveTextContent('Stopped sharing with ben@example.com.');
    });

    it('moves focus to the email field after the last share stops', async () => {
      fetchLiveAppShares.mockResolvedValue([toBen]);
      withdrawLiveAppShare.mockResolvedValue({ ok: true });
      const { dialog } = renderDialog();

      fireEvent.click(await within(dialog).findByRole('button', { name: 'Stop sharing with ben@example.com' }));

      await waitFor(() => expect(within(dialog).getByLabelText("Colleague's email")).toHaveFocus());
    });

    it('says so when the list could not be loaded, and still shares', async () => {
      fetchLiveAppShares.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
      const { dialog } = renderDialog();

      expect(await within(dialog).findByText(/^Couldn't load who this app is shared with\. Close and reopen this dialog to try again\.$/)).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Colleague's email")).toBeEnabled();
    });
  });
});

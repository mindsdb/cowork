import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../api', () => ({ shareLiveApp: vi.fn() }));

import { LiveAppShareDialog } from './LiveAppShareDialog';
import { shareLiveApp } from '../../api';

const app = { slug: 'table-counts', title: 'Table Row Counts', projectId: 'p1', type: 'fullstack-stateless-app' };

const renderDialog = () => {
  const onClose = vi.fn();
  render(<LiveAppShareDialog artifact={app} onClose={onClose} />);
  return { dialog: screen.getByRole('dialog'), onClose };
};

afterEach(() => vi.clearAllMocks());

describe('LiveAppShareDialog', () => {
  it('starts on one colleague and waits for an address', () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByRole('radio', { name: 'One colleague' })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: 'ben' } });
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeDisabled();
  });

  it('shares with one colleague by the trimmed address', async () => {
    shareLiveApp.mockResolvedValue({ shareId: 's1', slug: 'table-counts', email: 'ben@example.com', everyone: false, sharedAt: 'now' });
    const { dialog } = renderDialog();

    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: ' ben@example.com ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));

    expect(await within(dialog).findByText(/^Shared with ben@example.com\./)).toBeInTheDocument();
    expect(shareLiveApp).toHaveBeenCalledWith({ projectId: 'p1', slug: 'table-counts', email: 'ben@example.com' });
  });

  it('shares with everyone on the stack, with no address', async () => {
    shareLiveApp.mockResolvedValue({ shareId: 's2', slug: 'table-counts', email: null, everyone: true, sharedAt: 'now' });
    const { dialog } = renderDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Everyone on this stack' }));
    expect(within(dialog).queryByLabelText("Colleague's email")).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));

    expect(await within(dialog).findByText(/^Shared with everyone on this stack\./)).toBeInTheDocument();
    expect(shareLiveApp).toHaveBeenCalledWith({ projectId: 'p1', slug: 'table-counts', everyone: true });
  });

  it("shows the server's refusal and keeps the choice open", async () => {
    shareLiveApp.mockRejectedValue(new Error('Enter a valid email address.'));
    const { dialog } = renderDialog();

    fireEvent.change(within(dialog).getByLabelText("Colleague's email"), { target: { value: 'ben@example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));

    expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeEnabled();
  });

  it('closes on Cancel without sharing', () => {
    const { dialog, onClose } = renderDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(shareLiveApp).not.toHaveBeenCalled();
  });
});

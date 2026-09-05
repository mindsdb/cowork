import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ConfirmModal } from './ConfirmModal';

/*
 * Separate work-in-flight from dismissal lock while retaining the locked default for existing
 * callers.
 */

function open(props = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmModal
      open
      title="Sign out of Cowork?"
      message="This clears your stored API keys."
      confirmLabel="Sign out"
      busyLabel="Signing out…"
      onClose={onClose}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onClose, onConfirm };
}

describe('ConfirmModal while busy', () => {
  it('locks shut by default, which is what every other caller relies on', async () => {
    const { onClose, onConfirm } = open({ busy: true });

    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lets Escape and Cancel through when the caller opts in', async () => {
    const { onClose } = open({ busy: true, dismissableWhileBusy: true });

    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  /*
   * Dismissible still means busy: keep Confirm and Enter disabled to prevent starting the work
   * twice.
   */
  it('keeps the confirm action disabled while dismissable', async () => {
    const { onConfirm } = open({ busy: true, dismissableWhileBusy: true });

    await screen.findByRole('dialog');
    const confirm = screen.getByRole('button', { name: /Signing out/ });
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(confirm).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the note under the message when there is one', async () => {
    open({ busy: true, dismissableWhileBusy: true, note: 'Still signing you out.' });

    await screen.findByRole('dialog');

    expect(screen.getByText('Still signing you out.')).toBeInTheDocument();
    expect(screen.getByText('This clears your stored API keys.')).toBeInTheDocument();
  });

  it('confirms and dismisses normally when not busy', async () => {
    const { onClose, onConfirm } = open();

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

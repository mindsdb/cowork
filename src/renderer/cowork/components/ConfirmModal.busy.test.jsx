import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ConfirmModal } from './ConfirmModal';

/*
 * `busy` used to mean two things at once: an action is in flight, and the
 * dialog refuses to close. That is right for work that finishes in a moment,
 * and wrong for sign-out, whose reply can outlast anyone's patience — it left
 * the dialog as the app's only exit with every way out disabled.
 *
 * The two meanings are now separable, and the default is the old behavior, so
 * the twelve other callers that pass `busy` are unaffected. This file is the
 * component's first test, so it pins both halves.
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
   * Dismissable is not idle. The work is still running, so the button that
   * starts it stays disabled and Enter must not fire a second one — the reason
   * this shape keeps the dialog open rather than closing it outright.
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

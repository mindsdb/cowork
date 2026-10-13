import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Modal, ModalBody, ModalFooter, ModalHeader, ModalToolbar } from './Modal';

// Pins the shared modal pattern: header X, a pinned toolbar, and a footer
// with Cancel on the left edge and the actions on the right.

function renderModal({ dismissible, onClose = vi.fn() } = {}) {
  render(
    <Modal open onClose={onClose} labelledBy="t" dismissible={dismissible}>
      <ModalHeader id="t" title="Edit thing" onClose={onClose} />
      <ModalToolbar><span>Tabs</span></ModalToolbar>
      <ModalBody>Body</ModalBody>
      <ModalFooter cancel={<button type="button" onClick={onClose}>Cancel</button>}>
        <button type="button">Save draft</button>
        <button type="button">Save</button>
      </ModalFooter>
    </Modal>,
  );
  return onClose;
}

describe('ModalFooter', () => {
  it('puts cancel on the left and the actions together on the right, primary last', async () => {
    renderModal();
    await screen.findByRole('dialog');

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const secondary = screen.getByRole('button', { name: 'Save draft' });
    const primary = screen.getByRole('button', { name: 'Save' });
    const footer = cancel.parentElement;

    expect(footer.style.justifyContent).toBe('space-between');
    expect(footer.firstElementChild).toBe(cancel);
    expect(secondary.parentElement).toBe(primary.parentElement);
    expect(secondary.parentElement.parentElement).toBe(footer);
    expect(primary.parentElement.lastElementChild).toBe(primary);
  });

  it('keeps the legacy right-aligned layout when there is no cancel', async () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="x">
        <ModalFooter><button type="button">OK</button></ModalFooter>
      </Modal>,
    );
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'OK' }).parentElement.style.justifyContent).toBe('flex-end');
  });
});

describe('Modal dismissible', () => {
  it('shows the header X and closes on it and on Escape by default', async () => {
    const onClose = renderModal();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it('hides the X and ignores Escape when not dismissible', async () => {
    const onClose = renderModal({ dismissible: false });
    await screen.findByRole('dialog');

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((r) => setTimeout(r));
    expect(onClose).not.toHaveBeenCalled();
  });
});

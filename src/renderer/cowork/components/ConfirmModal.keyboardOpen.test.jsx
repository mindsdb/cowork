import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { ConfirmModal } from './ConfirmModal';

// jsdom can't replay the browser's event timing, so these pin the guards:
// Enter counts only from the next task, and repeats never click confirm.

function renderConfirm() {
  const onConfirm = vi.fn();
  render(<ConfirmModal open title="Delete this task?" confirmLabel="Delete" onConfirm={onConfirm} onClose={() => {}} />);
  return onConfirm;
}

describe('ConfirmModal Enter-to-confirm', () => {
  it('ignores an Enter in the same task that opened it', () => {
    vi.useFakeTimers();
    try {
      const onConfirm = renderConfirm();
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onConfirm).not.toHaveBeenCalled();

      act(() => { vi.runOnlyPendingTimers(); });
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows a held Enter repeating into the dialog', async () => {
    const onConfirm = renderConfirm();
    await screen.findByRole('dialog');
    await act(() => new Promise((r) => setTimeout(r)));

    const notPrevented = fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Enter', repeat: true });
    expect(notPrevented).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ConfirmModal Enter on a focused button', () => {
  it('leaves the button to handle it, so one Enter is one confirm', async () => {
    const onConfirm = renderConfirm();
    await screen.findByRole('dialog');
    await act(() => new Promise((r) => setTimeout(r)));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

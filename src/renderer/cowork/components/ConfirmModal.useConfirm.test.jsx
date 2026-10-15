import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useConfirm } from './ConfirmModal';

function Harness({ onAnswer }) {
  const [confirm, confirmModal] = useConfirm();
  return (
    <>
      <button type="button" onClick={async () => onAnswer(await confirm({ title: 'Disconnect Slack?', confirmLabel: 'Disconnect', destructive: true }))}>
        Ask
      </button>
      {confirmModal}
    </>
  );
}

describe('useConfirm', () => {
  it('resolves true when confirmed and closes', async () => {
    const answers = [];
    render(<Harness onAnswer={(a) => answers.push(a)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(answers).toEqual([true]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('resolves false on Cancel, the X or Escape', async () => {
    const answers = [];
    render(<Harness onAnswer={(a) => answers.push(a)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(answers).toEqual([false]));

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(answers).toEqual([false, false]));

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(answers).toEqual([false, false, false]));
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The modal is the only place a person can answer "is this history mine?", and
// both answers are consequential — one hands over a data root, the other leaves
// it behind — so what matters is that each button reports the right answer and
// that neither can be fired twice while the first is still running.
import AccountOwnershipModal from './AccountOwnershipModal';

describe('AccountOwnershipModal', () => {
  it('reports keeping the existing history', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<AccountOwnershipModal open accountLabel="a@example.com" onDecide={onDecide} />);

    await userEvent.click(screen.getByRole('button', { name: /this history is mine/i }));

    expect(onDecide).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('reports starting fresh', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<AccountOwnershipModal open accountLabel="b@example.com" onDecide={onDecide} />);

    await userEvent.click(screen.getByRole('button', { name: /start fresh/i }));

    expect(onDecide).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('names the account so the person knows who they are answering for', () => {
    render(<AccountOwnershipModal open accountLabel="a@example.com" onDecide={vi.fn()} />);
    expect(screen.getByText(/a@example\.com/)).toBeTruthy();
  });

  it('still asks answerably when there is no label to show', () => {
    render(<AccountOwnershipModal open accountLabel={null} onDecide={vi.fn()} />);
    expect(screen.getByText(/this account/i)).toBeTruthy();
  });

  it('says plainly that neither answer deletes anything', () => {
    // The reason this is a question and not a silent choice: a person has to be
    // able to pick without fearing they are discarding their own work.
    render(<AccountOwnershipModal open accountLabel={null} onDecide={vi.fn()} />);
    expect(screen.getByText(/nothing is deleted either way/i)).toBeTruthy();
  });

  it('cannot be answered twice while the first answer is in flight', async () => {
    let release;
    const onDecide = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    render(<AccountOwnershipModal open accountLabel={null} onDecide={onDecide} />);

    const keep = screen.getByRole('button', { name: /this history is mine/i });
    await userEvent.click(keep);
    // Both buttons disabled, so a double-click cannot adopt and decline at once.
    await waitFor(() => expect(keep.disabled).toBe(true));
    expect(screen.getByRole('button', { name: /starting fresh|start fresh/i }).disabled).toBe(true);

    release();
    expect(onDecide).toHaveBeenCalledTimes(1);
  });
});

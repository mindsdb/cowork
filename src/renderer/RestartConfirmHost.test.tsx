import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RestartConfirmHost from './RestartConfirmHost';
import { confirmRestart, resetRestartConfirmationForTests } from './platform/restart-guard';

afterEach(() => resetRestartConfirmationForTests());

describe('RestartConfirmHost', () => {
  it('renders nothing until a restart asks', () => {
    const { container } = render(<RestartConfirmHost />);
    expect(container.textContent).toBe('');
  });

  it('shows the count and resolves yes on Restart anyway', async () => {
    render(<RestartConfirmHost />);
    const answer = confirmRestart({ confirm: true, runningTasks: 2 });
    expect(await screen.findByText('Stop 2 running tasks and restart?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /restart anyway/i }));
    expect(await answer).toBe(true);
    await waitFor(() => expect(screen.queryByText(/and restart\?/)).toBeNull());
  });

  it('resolves no on Cancel and says when the count is unknown', async () => {
    render(<RestartConfirmHost />);
    const answer = confirmRestart({ confirm: true, runningTasks: null });
    expect(await screen.findByText(/cannot tell whether any tasks are running/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(await answer).toBe(false);
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeNotice } from './WelcomeLoading';

describe('WelcomeNotice', () => {
  it('shows the title and message and runs the action on click', async () => {
    const onAction = vi.fn();
    render(
      <WelcomeNotice
        title="Something went wrong"
        message="Reload to continue."
        actionLabel="Reload"
        onAction={onAction}
      />
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Reload to continue.')).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

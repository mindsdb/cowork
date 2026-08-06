// ENG-1304: the model-denial card offers "Switch to MindsHub Air" only when
// the caller says Air is payable, and never echoes the server error string.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelUnavailableCard } from './ChatView';

describe('ModelUnavailableCard', () => {
  it('credits denial leads with Top up balance and our copy, not the server string', () => {
    render(
      <ModelUnavailableCard
        code="model_access_denied"
        failedModel="gpt-5.6-sol"
      />,
    );
    expect(screen.getByText(/needs credits/)).toBeInTheDocument();
    expect(screen.getByText(/You don't have enough credits for this model/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Top up balance' })).toBeInTheDocument();
    expect(screen.queryByText(/does not have access/)).not.toBeInTheDocument();
  });

  it('offers Switch to MindsHub Air only when the handler is provided, and fires it', async () => {
    const user = userEvent.setup();
    const onSwitchToAir = vi.fn();

    const { rerender } = render(
      <ModelUnavailableCard code="model_access_denied" failedModel="gpt-5.6-sol" onSwitchToAir={onSwitchToAir} />,
    );
    await user.click(screen.getByRole('button', { name: 'Switch to MindsHub Air' }));
    expect(onSwitchToAir).toHaveBeenCalledTimes(1);

    rerender(<ModelUnavailableCard code="model_access_denied" failedModel="gpt-5.6-sol" />);
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).not.toBeInTheDocument();
  });

  it('admin-disabled leads with Open Settings and never offers the Air switch', () => {
    const onOpenSettings = vi.fn();
    render(
      <ModelUnavailableCard
        code="model_disabled"
        failedModel="opus"
        onOpenSettings={onOpenSettings}
        onSwitchToAir={vi.fn()}
      />,
    );
    expect(screen.getByText(/isn't available right now/)).toBeInTheDocument();
    expect(screen.getByText(/turned off for your workspace/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to MindsHub Air' })).not.toBeInTheDocument();
  });
});

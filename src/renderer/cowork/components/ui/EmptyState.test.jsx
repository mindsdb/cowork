import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState.jsx';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No projects yet" description="Create your first project." />);
    expect(screen.getByText('No projects yet')).toHaveClass('s-h3');
    expect(screen.getByText('Create your first project.')).toBeInTheDocument();
  });

  it('renders the action node and fires its onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        action={<button onClick={onClick}>New project</button>}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'New project' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders the dashed card class when bordered', () => {
    render(<EmptyState title="Empty" bordered />);
    expect(screen.getByText('Empty').closest('.card')).toHaveClass('card', 'dashed', 'flat');
  });

  it('does not render the card class in plain (non-bordered) mode', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByText('Empty').closest('.card')).toBeNull();
  });
});

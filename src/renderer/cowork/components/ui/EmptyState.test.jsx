import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState.jsx';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No projects yet" description="Create your first project." />);
    expect(screen.getByText('No projects yet')).toHaveStyle({ fontWeight: '600' });
    expect(screen.getByText('Create your first project.')).toBeInTheDocument();
  });

  it('renders the action as a secondary button and fires onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<EmptyState title="Empty" action={{ label: 'New project', onClick }} />);
    const button = screen.getByRole('button', { name: 'New project' });
    expect(button).toHaveClass('btn', 'default');
    expect(button).not.toHaveClass('primary');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a primary, disabled action only when asked', () => {
    render(<EmptyState title="Empty" action={{ label: 'Retrying…', primary: true, disabled: true }} />);
    const button = screen.getByRole('button', { name: 'Retrying…' });
    expect(button).toHaveClass('primary');
    expect(button).toBeDisabled();
  });

  it('owns the icon colour and draws no container', () => {
    render(<EmptyState icon={<svg data-testid="icon" />} title="Empty" />);
    expect(screen.getByTestId('icon').parentElement.style.color).toBe('var(--ink-4)');
    expect(screen.getByText('Empty').closest('.card')).toBeNull();
  });

  it('renders the compact size without the min-height', () => {
    render(<EmptyState size="sm" className="panel-empty" icon={<svg data-testid="icon" />} title="No matches" description="Try a filename." />);
    const title = screen.getByText('No matches');
    expect(title).toHaveStyle({ fontSize: '12px' });
    expect(screen.getByText('Try a filename.')).toHaveStyle({ fontSize: '11px' });
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    const root = title.closest('.panel-empty');
    expect(root).not.toBeNull();
    expect(root.style.minHeight).toBe('');
  });
});

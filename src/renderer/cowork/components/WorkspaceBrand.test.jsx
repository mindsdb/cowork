import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkspaceBrand from './WorkspaceBrand';

const base = { wordmark: 'MindsHub', logo: null, mode: 'cowork', showSwitch: false, onChange: () => {} };

describe('WorkspaceBrand', () => {
  it('is only the wordmark while Code is unavailable', () => {
    render(<WorkspaceBrand {...base} />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Workspace' })).toBeNull();
  });

  it('shows a custom title and logo', () => {
    render(<WorkspaceBrand {...base} wordmark="Acme Workspace" logo="data:image/png;base64,abc123" />);
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
    expect(document.querySelector('.anton-sidebar__logo').getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('switches to Code from the icon toggle', async () => {
    const onChange = vi.fn();
    render(<WorkspaceBrand {...base} showSwitch onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Cowork' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(onChange).toHaveBeenCalledWith('code');
  });

  it('does not re-select the current workspace', async () => {
    const onChange = vi.fn();
    render(<WorkspaceBrand {...base} mode="code" showSwitch onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the switch but drops the wordmark when compact', () => {
    render(<WorkspaceBrand {...base} showSwitch compact />);
    expect(screen.queryByText('MindsHub')).toBeNull();
    expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BrandMenu from './BrandMenu';

const base = { wordmark: 'MindsHub', logo: null, mode: 'cowork', showSwitch: false, onChange: () => {} };

describe('BrandMenu', () => {
  it('is only the wordmark while Code is unavailable', () => {
    render(<BrandMenu {...base} />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Workspace/ })).toBeNull();
  });

  it('shows a custom title and logo', () => {
    render(<BrandMenu {...base} wordmark="Acme Workspace" logo="data:image/png;base64,abc123" />);
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
    expect(document.querySelector('.anton-sidebar__logo').getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('switches to Code from the workspace menu', async () => {
    const onChange = vi.fn();
    render(<BrandMenu {...base} showSwitch onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Workspace: Cowork' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Code/ }));
    expect(onChange).toHaveBeenCalledWith('code');
  });

  it('marks the current workspace and does not re-select it', async () => {
    const onChange = vi.fn();
    render(<BrandMenu {...base} mode="code" showSwitch onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Workspace: Code' }));
    const current = await screen.findByRole('menuitem', { name: /Code/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    await userEvent.click(current);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('collapses to the mode glyph when compact', () => {
    render(<BrandMenu {...base} showSwitch compact />);
    expect(screen.queryByText('MindsHub')).toBeNull();
    expect(screen.getByRole('button', { name: 'Workspace: Cowork' })).toBeInTheDocument();
  });
});

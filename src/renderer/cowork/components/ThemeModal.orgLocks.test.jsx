// Display settings under an org's locked look.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ThemeModal from './ThemeModal';

const props = { open: true, onClose: vi.fn(), theme: 'dark', onThemeChange: vi.fn(), skin: 'normal', onSkinChange: vi.fn() };

describe('ThemeModal under an org lock', () => {
  it('offers both when nothing is locked', () => {
    render(<ThemeModal {...props} orgLocks={{ style: false, theme: false }} />);
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '8-Bit' })).toBeInTheDocument();
    expect(screen.queryByText(/set by your organization/)).toBeNull();
  });

  it('says the theme is set by the organization and offers the style', () => {
    render(<ThemeModal {...props} orgLocks={{ style: false, theme: true }} />);
    expect(screen.queryByRole('button', { name: 'Light' })).toBeNull();
    expect(screen.getByRole('button', { name: '8-Bit' })).toBeInTheDocument();
    expect(screen.getByText('Theme is set by your organization.')).toBeInTheDocument();
  });

  it('says both are set when the org locked both', () => {
    render(<ThemeModal {...props} orgLocks={{ style: true, theme: true }} />);
    expect(screen.queryByRole('button', { name: 'Light' })).toBeNull();
    expect(screen.queryByRole('button', { name: '8-Bit' })).toBeNull();
    expect(screen.getByText('Theme and style are set by your organization.')).toBeInTheDocument();
  });
});

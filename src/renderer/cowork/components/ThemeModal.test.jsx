import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({ isWeb: false }));
vi.mock('../../platform/host', () => ({ host: hostMock }));

import ThemeModal from './ThemeModal';

const baseProps = {
  open: true,
  onClose: vi.fn(),
  theme: 'dark',
  onThemeChange: vi.fn(),
  skin: 'normal',
  onSkinChange: vi.fn(),
};

describe('ThemeModal — coding mode (ENG-1656)', () => {
  it('renders a Coding mode group on desktop, wired to onCodingModeChange', () => {
    hostMock.isWeb = false;
    const onCodingModeChange = vi.fn();
    render(<ThemeModal {...baseProps} codingModeEnabled={false} onCodingModeChange={onCodingModeChange} />);

    expect(screen.getByText('Coding mode')).toBeInTheDocument();
    screen.getByRole('button', { name: 'On' }).click();
    expect(onCodingModeChange).toHaveBeenCalledWith(true);
  });

  it('marks "On" active when codingModeEnabled is true', () => {
    hostMock.isWeb = false;
    render(<ThemeModal {...baseProps} codingModeEnabled onCodingModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('omits the Coding mode group entirely on web', () => {
    // Desktop-only: launching a terminal is an Electron main-process
    // capability with no web equivalent.
    hostMock.isWeb = true;
    render(<ThemeModal {...baseProps} codingModeEnabled onCodingModeChange={vi.fn()} />);
    expect(screen.queryByText('Coding mode')).toBeNull();
  });

  it('omits the group when the caller does not wire onCodingModeChange', () => {
    hostMock.isWeb = false;
    render(<ThemeModal {...baseProps} />);
    expect(screen.queryByText('Coding mode')).toBeNull();
  });
});

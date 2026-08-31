import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreviewPanel } from './PreviewPanel';


describe('PreviewPanel', () => {
  it('renders a sandboxed local preview with responsive controls', async () => {
    const user = userEvent.setup();
    render(<PreviewPanel open url="data:text/html,Preview" onClose={vi.fn()} />);

    const frame = screen.getByTitle('Project preview');
    expect(frame).toHaveAttribute('src', 'data:text/html,Preview');
    expect(frame).toHaveAttribute('sandbox', expect.stringContaining('allow-scripts'));
    expect(frame).not.toHaveAttribute('allow');

    await user.click(screen.getByRole('button', { name: 'mobile preview' }));
    expect(screen.getByRole('button', { name: 'mobile preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Project preview')).toHaveStyle({ width: '390px' });
  });

  it('shows an honest empty state when a remote task has no preview tunnel', () => {
    render(<PreviewPanel open url={null} onClose={vi.fn()} />);
    expect(screen.getByText('No local preview yet')).toBeInTheDocument();
    expect(screen.queryByTitle('Project preview')).not.toBeInTheDocument();
  });
});

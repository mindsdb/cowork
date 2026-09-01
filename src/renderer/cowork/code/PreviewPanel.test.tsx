import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/host')>()),
  getApiOrigin: () => 'http://127.0.0.1:26866',
}));

import { PreviewPanel } from './PreviewPanel';


describe('PreviewPanel', () => {
  it('renders a sandboxed local preview with responsive controls', async () => {
    const user = userEvent.setup();
    // Detached container: happy-dom fetches a connected iframe's http URL for real.
    const { getByRole, getByTitle } = render(
      <PreviewPanel open url="http://127.0.0.1:4173" onClose={vi.fn()} />,
      { container: document.createElement('div') },
    );

    const frame = getByTitle('Project preview');
    expect(frame).toHaveAttribute('src', 'http://127.0.0.1:4173/');
    expect(frame).toHaveAttribute('sandbox', expect.stringContaining('allow-scripts'));
    expect(frame).not.toHaveAttribute('allow');

    await user.click(getByRole('button', { name: 'mobile preview' }));
    expect(getByRole('button', { name: 'mobile preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByTitle('Project preview').style.width).toBe('390px');
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
  ])('frames nothing for a non-http preview address: %s', (url) => {
    render(<PreviewPanel open url={url} onClose={vi.fn()} />);

    expect(screen.queryByTitle('Project preview')).not.toBeInTheDocument();
    expect(screen.queryByText(url)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open preview in browser' })).toBeDisabled();
    expect(screen.getByText('No local preview yet')).toBeInTheDocument();
  });

  it('frames nothing for a preview served from this app\'s own origin', () => {
    render(<PreviewPanel open url="http://127.0.0.1:26866/api/v1/preview" onClose={vi.fn()} />);

    expect(screen.queryByTitle('Project preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open preview in browser' })).toBeDisabled();
    expect(screen.getByText('No local preview yet')).toBeInTheDocument();
  });

  it('shows an honest empty state when a remote task has no preview tunnel', () => {
    render(<PreviewPanel open url={null} onClose={vi.fn()} />);
    expect(screen.getByText('No local preview yet')).toBeInTheDocument();
    expect(screen.queryByTitle('Project preview')).not.toBeInTheDocument();
  });
});

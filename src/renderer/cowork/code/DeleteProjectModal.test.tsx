import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DeleteProjectModal } from './DeleteProjectModal';

describe('DeleteProjectModal', () => {
  it('keeps a failed project deletion actionable and visible', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDelete = vi.fn(async () => { throw new Error('Delete the project tasks first.'); });
    render(<DeleteProjectModal open onClose={onClose} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    expect(await screen.findByText('Delete the project tasks first.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Delete this Code Project?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once the project is deleted', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DeleteProjectModal open onClose={onClose} onDelete={vi.fn(async () => {})} />);

    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  createProject: vi.fn(async () => ({ id: 'project-1', name: 'billing' })),
  uploadProjectFiles: vi.fn(),
  writeProjectFile: vi.fn(async () => ({})),
}));

vi.mock('../../api', () => ({
  ...api,
  ANTON_PROJECT_INSTRUCTIONS_PATH: '.anton/anton.md',
}));

import NewProjectModal from './NewProjectModal';

describe('NewProjectModal instructions', () => {
  it('writes initial instructions immediately after creating the project', async () => {
    render(<NewProjectModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('acme-engineering'), {
      target: { value: 'billing' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Tell the agent how to work/), {
      target: { value: 'Keep billing changes backwards compatible.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.writeProjectFile).toHaveBeenCalledWith(
        'billing',
        '.anton/anton.md',
        'Keep billing changes backwards compatible.',
      );
    });
    expect(api.createProject).toHaveBeenCalledWith('billing');
  });
});

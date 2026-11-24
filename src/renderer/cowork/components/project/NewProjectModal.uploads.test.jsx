import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  uploadProjectFiles: vi.fn(),
  writeProjectFile: vi.fn(async () => ({})),
}));

const toast = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('../../api', () => ({
  ...api,
  ANTON_PROJECT_INSTRUCTIONS_PATH: '.anton/anton.md',
}));

vi.mock('../ui/Toast', () => ({ useToastManager: () => toast }));

import NewProjectModal from './NewProjectModal';

const SIZE_LIMIT = 'This upload is over the size limit. Pick a smaller file, or fewer files at once.';

/* Types a name, picks one file through the hidden input, and presses Create. */
async function createWithOneFile() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<NewProjectModal open onClose={onClose} onCreated={onCreated} />);
  fireEvent.change(screen.getByPlaceholderText('acme-engineering'), {
    target: { value: 'billing' },
  });
  const file = new File(['%PDF-1.7'], 'quarterly-report.pdf', { type: 'application/pdf' });
  fireEvent.change(document.querySelector('input[type="file"]'), {
    target: { files: [file] },
  });
  await waitFor(() => screen.getByText('quarterly-report.pdf'));
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  return { onClose, onCreated, file };
}

describe('NewProjectModal file upload', () => {
  beforeEach(() => {
    api.createProject.mockReset();
    api.createProject.mockResolvedValue({ id: 'project-1', name: 'billing' });
    api.uploadProjectFiles.mockReset();
    api.writeProjectFile.mockClear();
    toast.add.mockReset();
  });

  it('creates the project and says the files did not upload when the upload is refused', async () => {
    api.uploadProjectFiles.mockRejectedValue(
      Object.assign(new Error(SIZE_LIMIT), { status: 413 }),
    );
    const { onClose, onCreated, file } = await createWithOneFile();

    /* The project exists either way, and the dialog closes so a second Create
       cannot make a duplicate. */
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'project-1', name: 'billing' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.uploadProjectFiles).toHaveBeenCalledWith('billing', [file]);

    expect(toast.add).toHaveBeenCalledTimes(1);
    const [shown] = toast.add.mock.calls[0];
    expect(shown).toMatchObject({ type: 'danger', timeout: 0, description: SIZE_LIMIT });
    expect(shown.title).toBe('"billing" was created, but its files didn\'t upload.');
  });

  it('names the project by the label the person typed, not its slug', async () => {
    api.createProject.mockResolvedValue({
      id: 'project-2',
      name: 'untitled-project-2',
      display_name: 'Мій проєкт',
    });
    api.uploadProjectFiles.mockRejectedValue(new Error(SIZE_LIMIT));
    await createWithOneFile();

    await waitFor(() => expect(toast.add).toHaveBeenCalledTimes(1));
    const [shown] = toast.add.mock.calls[0];
    expect(shown.title).toContain('Мій проєкт');
    expect(shown.title).not.toContain('untitled-project-2');
    // The upload still addresses the project by its slug.
    expect(api.uploadProjectFiles).toHaveBeenCalledWith('untitled-project-2', expect.any(Array));
  });

  it('falls back to a general reason when the refusal carries no sentence', async () => {
    api.uploadProjectFiles.mockRejectedValue(new Error(''));
    const { onCreated } = await createWithOneFile();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(toast.add).toHaveBeenCalledTimes(1);
    const [shown] = toast.add.mock.calls[0];
    expect(shown).toMatchObject({
      type: 'danger',
      description: "The upload didn't finish. Add the files to the project again.",
    });
  });

  it('raises no toast when the upload succeeds', async () => {
    api.uploadProjectFiles.mockResolvedValue({ results: [] });
    const { onClose, onCreated, file } = await createWithOneFile();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(api.uploadProjectFiles).toHaveBeenCalledWith('billing', [file]);
    expect(toast.add).not.toHaveBeenCalled();
  });
});

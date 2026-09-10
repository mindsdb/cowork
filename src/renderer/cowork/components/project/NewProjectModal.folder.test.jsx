import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  createProject: vi.fn(async () => ({ id: 'project-1', name: 'billing' })),
  uploadProjectFiles: vi.fn(),
  writeProjectFile: vi.fn(async () => ({})),
}));

const platform = vi.hoisted(() => ({
  pickCodeFolder: vi.fn(async () => ({ ok: true, path: '/Users/me/Documents/notes' })),
  isElectron: true,
  isWeb: false,
}));

const orgMode = vi.hoisted(() => ({ value: false }));

vi.mock('../../api', () => ({
  ...api,
  ANTON_PROJECT_INSTRUCTIONS_PATH: '.anton/anton.md',
}));

vi.mock('../../../platform/host', () => ({
  host: platform,
  isElectron: platform.isElectron,
  isWeb: platform.isWeb,
}));

vi.mock('../../../lib/orgMode', () => ({
  useOrgMode: () => orgMode.value,
}));

import NewProjectModal from './NewProjectModal';

const CHOOSE = 'Use an existing folder';

function open() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<NewProjectModal open onClose={onClose} onCreated={onCreated} />);
  fireEvent.change(screen.getByPlaceholderText('acme-engineering'), {
    target: { value: 'billing' },
  });
  return { onClose, onCreated };
}

describe('NewProjectModal folder selection', () => {
  beforeEach(() => {
    api.createProject.mockClear();
    // The adopted-folder response a current server sends. An older one has no
    // such capability, which is its own test below.
    api.createProject.mockResolvedValue({
      id: 'project-1',
      name: 'billing',
      capabilities: { directoryIsExternal: true },
    });
    api.writeProjectFile.mockClear();
    platform.pickCodeFolder.mockClear();
    platform.pickCodeFolder.mockResolvedValue({
      ok: true,
      path: '/Users/me/Documents/notes',
    });
    platform.isElectron = true;
    orgMode.value = false;
  });

  it('sends the chosen folder with the create request', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: CHOOSE }));
    await waitFor(() => screen.getByText('/Users/me/Documents/notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledWith(
        'billing',
        '/Users/me/Documents/notes',
      );
    });
  });

  it('sends the name alone when no folder was chosen', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith('billing'));
  });

  it('clearing the folder goes back to a server-allocated one', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: CHOOSE }));
    await waitFor(() => screen.getByText('/Users/me/Documents/notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith('billing'));
  });

  it('a cancelled picker leaves the form alone', async () => {
    platform.pickCodeFolder.mockResolvedValue({ ok: false, cancelled: true });
    open();
    fireEvent.click(screen.getByRole('button', { name: CHOOSE }));

    await waitFor(() => expect(platform.pickCodeFolder).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: CHOOSE })).toBeTruthy();
  });

  it('a refused picker says why instead of failing silently', async () => {
    platform.pickCodeFolder.mockResolvedValue({
      ok: false,
      reason: 'window unavailable',
    });
    open();
    fireEvent.click(screen.getByRole('button', { name: CHOOSE }));

    await waitFor(() => screen.getByText('window unavailable'));
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('a thrown picker is reported instead of doing nothing', async () => {
    platform.pickCodeFolder.mockRejectedValue(new Error('ipc channel closed'));
    open();
    fireEvent.click(screen.getByRole('button', { name: CHOOSE }));

    await waitFor(() => screen.getByText('ipc channel closed'));
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('completes when the server confirms it adopted the folder', async () => {
    const { onClose, onCreated } = open();
    fireEvent.click(screen.getByRole('button', { name: CHOOSE }));
    await waitFor(() => screen.getByText('/Users/me/Documents/notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses to report success when the server ignored the folder', async () => {
    // A server that predates the `path` field drops it and creates a managed
    // project, answering 200. Without the capability in the response there is
    // nothing to distinguish that from an adopted folder.
    api.createProject.mockResolvedValue({ id: 'project-1', name: 'billing' });
    const { onClose, onCreated } = open();
    fireEvent.change(screen.getByPlaceholderText(/Tell the agent how to work/), {
      target: { value: 'Keep billing changes backwards compatible.' },
    });
    fireEvent.click(screen.getByRole('button', { name: CHOOSE }));
    await waitFor(() => screen.getByText('/Users/me/Documents/notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => screen.getByText(/does not support pointing a project at a folder/));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Stopped before the instructions write, so nothing was put in a
    // directory the user did not choose.
    expect(api.writeProjectFile).not.toHaveBeenCalled();
  });

  it('drops the folder selection so the retry cannot repeat the request', async () => {
    api.createProject.mockResolvedValue({ id: 'project-1', name: 'billing' });
    open();
    fireEvent.click(screen.getByRole('button', { name: CHOOSE }));
    await waitFor(() => screen.getByText('/Users/me/Documents/notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => screen.getByText(/does not support pointing a project at a folder/));

    // Back to offering the picker, with the ignored path gone.
    expect(screen.getByRole('button', { name: CHOOSE })).toBeTruthy();
    expect(screen.queryByText('/Users/me/Documents/notes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // The obvious retry sends no path, so it cannot strand a second managed
    // project for a folder this server ignores anyway.
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(2));
    expect(api.createProject).toHaveBeenLastCalledWith('billing');
  });

  it('asks the app to refetch, so the project it names is on screen', async () => {
    api.createProject.mockResolvedValue({ id: 'project-1', name: 'billing' });
    const changed = vi.fn();
    window.addEventListener('anton:projects-changed', changed);
    try {
      open();
      fireEvent.click(screen.getByRole('button', { name: CHOOSE }));
      await waitFor(() => screen.getByText('/Users/me/Documents/notes'));
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      // The message names a project to delete, and onCreated (the only other
      // refresh signal) is deliberately skipped on this path.
      await waitFor(() => expect(changed).toHaveBeenCalled());
    } finally {
      window.removeEventListener('anton:projects-changed', changed);
    }
  });

  it('does not check the capability when no folder was chosen', async () => {
    api.createProject.mockResolvedValue({ id: 'project-1', name: 'billing' });
    const { onClose, onCreated } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('is not offered in the browser, where a path would be meaningless', () => {
    platform.isElectron = false;
    open();
    expect(screen.queryByRole('button', { name: CHOOSE })).toBeNull();
  });

  it('is not offered in org mode, where the server refuses a path', () => {
    orgMode.value = true;
    open();
    expect(screen.queryByRole('button', { name: CHOOSE })).toBeNull();
  });
});

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
  render(<NewProjectModal open onClose={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText('acme-engineering'), {
    target: { value: 'billing' },
  });
}

describe('NewProjectModal folder selection', () => {
  beforeEach(() => {
    api.createProject.mockClear();
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

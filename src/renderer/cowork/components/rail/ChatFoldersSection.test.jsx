import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
  listConversationFolders: vi.fn(),
  addConversationFolder: vi.fn(),
  removeConversationFolder: vi.fn(),
  listConversationFolderFiles: vi.fn(),
}));

const platform = vi.hoisted(() => ({
  pickCodeFolder: vi.fn(),
  isElectron: true,
  isWeb: false,
}));

vi.mock('../../api', () => api);
vi.mock('../../../platform/host', () => ({
  host: platform,
  isElectron: platform.isElectron,
  isWeb: platform.isWeb,
}));

import { ChatFoldersSection } from './ChatFoldersSection';

const DOCS = { id: 'f1', path: '/Users/me/docs', name: 'docs', available: true };
const REPORTS = { id: 'f2', path: '/Users/me/reports', name: 'reports', available: true };

async function renderSection() {
  await act(async () => {
    render(<ChatFoldersSection conversationId="chat-1" />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listConversationFolders.mockResolvedValue({ folders: [DOCS, REPORTS] });
  api.addConversationFolder.mockResolvedValue({ ...DOCS });
  api.removeConversationFolder.mockResolvedValue({ ok: true });
  api.listConversationFolderFiles.mockResolvedValue({
    files: [
      { path: 'q3/summary.csv', name: 'summary.csv', is_dir: false },
      { path: '.git/config', name: 'config', is_dir: false },
      { path: 'q3', name: 'q3', is_dir: true },
    ],
  });
  platform.pickCodeFolder.mockResolvedValue({ ok: true, path: '/Users/me/new' });
});

describe('ChatFoldersSection', () => {
  it('shows each folder as its own card, and its files on expand', async () => {
    await renderSection();

    expect(screen.getByText('docs')).toBeTruthy();
    expect(screen.getByText('reports')).toBeTruthy();
    expect(api.listConversationFolders).toHaveBeenCalledWith('chat-1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show files in reports' }));
    });

    expect(api.listConversationFolderFiles).toHaveBeenCalledWith('chat-1', 'f2');
    const rows = await screen.findAllByTestId('folder-file-row');
    expect(rows.map((row) => row.textContent)).toEqual(['q3/summary.csv']);
  });

  it('keeps file rows display-only', async () => {
    await renderSection();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show files in docs' }));
    });

    const [row] = await screen.findAllByTestId('folder-file-row');
    expect(row.getAttribute('role')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('adds the folder the picker returns and lists it', async () => {
    api.listConversationFolders
      .mockResolvedValueOnce({ folders: [] })
      .mockResolvedValueOnce({ folders: [DOCS] });
    await renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a folder to this chat' }));
    });

    expect(api.addConversationFolder).toHaveBeenCalledWith('chat-1', '/Users/me/new');
    expect(await screen.findByText('docs')).toBeTruthy();
  });

  it('does nothing when the picker is cancelled', async () => {
    platform.pickCodeFolder.mockResolvedValue({ ok: false, cancelled: true });
    await renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a folder to this chat' }));
    });

    expect(api.addConversationFolder).not.toHaveBeenCalled();
    expect(screen.queryByText(/Could not/)).toBeNull();
  });

  it('says so when the picker itself fails', async () => {
    platform.pickCodeFolder.mockRejectedValue(new Error('window unavailable'));
    await renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a folder to this chat' }));
    });

    expect(screen.getByText('window unavailable')).toBeTruthy();
    expect(api.addConversationFolder).not.toHaveBeenCalled();
  });

  it("shows the server's refusal text", async () => {
    api.addConversationFolder.mockRejectedValue(
      Object.assign(new Error("Choose a folder that does not hold Cowork's own data"), { status: 400 }),
    );
    await renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a folder to this chat' }));
    });

    expect(screen.getByText("Choose a folder that does not hold Cowork's own data")).toBeTruthy();
  });

  it('removes a folder after confirmation', async () => {
    api.listConversationFolders
      .mockResolvedValueOnce({ folders: [DOCS, REPORTS] })
      .mockResolvedValueOnce({ folders: [REPORTS] });
    await renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Remove docs from this chat' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    });

    expect(api.removeConversationFolder).toHaveBeenCalledWith('chat-1', 'f1');
    await waitFor(() => expect(screen.queryByText('docs')).toBeNull());
  });

  it('marks a folder that is no longer available and does not list it', async () => {
    api.listConversationFolders.mockResolvedValue({
      folders: [{ ...DOCS, available: false }],
    });
    await renderSection();

    expect(screen.getByText('Folder not available')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Show files in docs' });
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(api.listConversationFolderFiles).not.toHaveBeenCalled();
  });
});

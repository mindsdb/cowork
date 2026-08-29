import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ContextCard } from './ContextCard';

// Regression coverage: disconnecting a Google Drive connection (from
// Connected Apps and Data, the in-chat "Modify connection" bubble, or the
// Utilities datasource list) must invalidate this card's own Google Drive
// file list — previously nothing told it the connection (and its
// _picked_files grant) was gone, so stale files kept showing.

const apiMock = vi.hoisted(() => ({
  fetchMemory: vi.fn().mockResolvedValue({}),
  listProjectFiles: vi.fn().mockResolvedValue({ files: [] }),
  deleteMemory: vi.fn(),
  deleteProjectFile: vi.fn(),
  readProjectFile: vi.fn().mockResolvedValue({ content: 'Project guidance.' }),
  writeProjectFile: vi.fn(),
  mountProjectFilePreview: vi.fn(),
  projectFileDownloadUrl: vi.fn(() => ''),
  BASE: '/api/v1',
  fetchAttachments: vi.fn(),
  findMemoryEntry: vi.fn(),
  labelCategory: vi.fn(),
  moveAttachmentToProject: vi.fn(),
  saveMemory: vi.fn(),
  uploadAttachments: vi.fn(),
  uploadProjectFiles: vi.fn(),
  deleteAttachment: vi.fn(),
  attachmentRawUrl: vi.fn(),
  ANTON_PROJECT_INSTRUCTIONS_PATH: '.anton/anton.md',
}));
const hostState = vi.hoisted(() => ({ isWeb: true }));
vi.mock('../../api', () => apiMock);
vi.mock('../../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get isWeb() { return hostState.isWeb; },
    host: {
      ...actual.host,
      get isWeb() { return hostState.isWeb; },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  hostState.isWeb = true;
  apiMock.fetchMemory.mockResolvedValue({});
  apiMock.listProjectFiles.mockResolvedValue({ files: [] });
  apiMock.readProjectFile.mockResolvedValue({ content: 'Project guidance.' });
  apiMock.writeProjectFile.mockResolvedValue({});
  apiMock.deleteProjectFile.mockResolvedValue({ status: 'deleted' });
  apiMock.labelCategory.mockImplementation((category) => (
    String(category || '').replace(/^./, (letter) => letter.toUpperCase())
  ));
  apiMock.findMemoryEntry.mockImplementation((sections, path) => (
    (sections || []).flatMap((section) => section.files || [])
      .find((entry) => entry.path === path) || null
  ));
});

describe('ContextCard — Google Drive file list invalidation', () => {
  it('refetches Google Drive files when a connection is disconnected elsewhere', async () => {
    const onFetchGoogleDriveFiles = vi.fn().mockResolvedValue({ files: [{ id: 'f1', name: 'doc.pdf' }] });

    await act(async () => {
      render(
        <ContextCard
          project={{ name: 'general' }}
          conversationId={null}
          onFetchGoogleDriveFiles={onFetchGoogleDriveFiles}
        />
      );
    });

    expect(onFetchGoogleDriveFiles).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('anton:connections-changed'));
    });

    expect(onFetchGoogleDriveFiles).toHaveBeenCalledTimes(2);
  });

  it('stops listening after unmount', async () => {
    const onFetchGoogleDriveFiles = vi.fn().mockResolvedValue({ files: [] });

    const { unmount } = render(
      <ContextCard
        project={{ name: 'general' }}
        conversationId={null}
        onFetchGoogleDriveFiles={onFetchGoogleDriveFiles}
      />
    );
    await act(async () => {});
    unmount();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('anton:connections-changed'));
    });

    expect(onFetchGoogleDriveFiles).toHaveBeenCalledTimes(1);
  });
});

// ENG-1656 follow-up: Hermes has no memory system of its own — Project/
// Global memory is an Anton concept the Context rail shouldn't show (or
// even fetch) for a Hermes-harnessed task.
describe('ContextCard — showMemory=false (Hermes tasks)', () => {
  it('does not fetch memory when showMemory is false', async () => {
    await act(async () => {
      render(<ContextCard project={{ name: 'general' }} conversationId={null} showMemory={false} />);
    });

    expect(apiMock.fetchMemory).not.toHaveBeenCalled();
  });

  it('fetches memory by default (showMemory omitted)', async () => {
    await act(async () => {
      render(<ContextCard project={{ name: 'general' }} conversationId={null} />);
    });

    expect(apiMock.fetchMemory).toHaveBeenCalledTimes(1);
  });

  it('hides the Project/Global memory headings when showMemory is false', async () => {
    apiMock.fetchMemory.mockResolvedValue({
      sections: [
        { scope: 'Project', files: [{ path: 'p1', category: 'notes', content: 'x' }] },
        { scope: 'Global', files: [{ path: 'g1', category: 'notes', content: 'y' }] },
      ],
    });

    const { queryByText } = render(
      <ContextCard project={{ name: 'general' }} conversationId={null} showMemory={false} />
    );
    await act(async () => {});

    expect(queryByText('Project memory')).toBeNull();
    expect(queryByText('Global memory')).toBeNull();
  });
});

describe('ContextCard — shared resource permissions', () => {
  it('starts a fresh memory read after a successful mutation', async () => {
    const project = { id: 'project-1', name: 'billing', path: '/projects/billing' };
    const entry = {
      path: 'Project:project-1:rules',
      scope: 'Project',
      projectId: project.id,
      projectName: project.name,
      category: 'rules',
      content: 'Original rules.',
      capabilities: { canEdit: true, canDelete: true },
    };
    const memory = { sections: [{ scope: 'Project', files: [entry] }] };
    apiMock.fetchMemory.mockResolvedValue(memory);
    apiMock.saveMemory.mockResolvedValue({ ...entry, content: 'Updated rules.' });

    await act(async () => {
      render(<ContextCard project={project} conversationId={null} />);
    });
    fireEvent.click(screen.getByText('Rules'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Updated rules.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMock.saveMemory).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.fetchMemory).toHaveBeenCalledWith(
      project,
      { forceFresh: true },
    ));
  });

  it('keeps the historical no-delete instructions UI in desktop mode', async () => {
    hostState.isWeb = false;
    apiMock.listProjectFiles.mockResolvedValue({
      files: [{
        path: '.anton/anton.md',
        name: 'anton.md',
        capabilities: { canEdit: true, canDelete: true },
      }],
    });

    await act(async () => {
      render(
        <ContextCard
          project={{
            name: 'billing',
            path: '/projects/billing',
            capabilities: { canEditInstructions: true },
          }}
          conversationId={null}
        />,
      );
    });

    expect(screen.queryByRole('button', { name: 'Delete .anton/anton.md' }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Instructions'));
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('passes project-instruction capabilities and attribution into the modal', async () => {
    apiMock.listProjectFiles.mockResolvedValue({
      files: [{
        path: '.anton/anton.md',
        name: 'anton.md',
        capabilities: { canEdit: false, canDelete: false },
        attribution: {
          createdBy: { userId: 'creator', email: 'creator@example.com' },
          lastModifiedBy: null,
          lastModifiedAt: '2026-08-29T10:00:00Z',
        },
      }],
    });

    await act(async () => {
      render(
        <ContextCard
          project={{
            name: 'billing',
            path: '/projects/billing',
            capabilities: { canEditInstructions: false },
          }}
          conversationId={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Instructions'));
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByText(/Created by creator@example.com/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete .anton/anton.md' })).not.toBeInTheDocument();
  });

  it('keeps authorized instructions visible until their delete is confirmed by the server', async () => {
    const instructions = {
      path: '.anton/anton.md',
      name: 'anton.md',
      capabilities: { canEdit: true, canDelete: true },
      attribution: {
        createdBy: { userId: 'creator', email: 'creator@example.com' },
        lastModifiedBy: null,
        lastModifiedAt: '2026-08-29T10:00:00Z',
      },
    };
    apiMock.listProjectFiles
      .mockResolvedValueOnce({ files: [instructions] })
      .mockResolvedValueOnce({
        files: [{
          path: '.anton/anton.md',
          name: 'anton.md',
          synthetic: true,
          size: 0,
          modified: null,
          capabilities: { canEdit: true, canDelete: false },
          attribution: {
            createdBy: null,
            lastModifiedBy: null,
            lastModifiedAt: null,
          },
        }],
      });
    let resolveDelete;
    apiMock.deleteProjectFile.mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));

    await act(async () => {
      render(
        <ContextCard
          project={{
            name: 'billing',
            path: '/projects/billing',
            capabilities: { canEditInstructions: true },
          }}
          conversationId={null}
        />,
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete .anton/anton.md' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(screen.getByText('Instructions')).toBeInTheDocument();
    expect(apiMock.deleteProjectFile).toHaveBeenCalledWith('billing', '.anton/anton.md');

    await act(async () => resolveDelete({ status: 'deleted' }));
    await waitFor(() => expect(apiMock.listProjectFiles).toHaveBeenCalledTimes(2));
    expect(apiMock.listProjectFiles).toHaveBeenLastCalledWith(
      'billing',
      { forceFresh: true },
    );
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete .anton/anton.md' }))
        .not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Instructions'));
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(screen.queryByText(/Created by creator@example.com/)).not.toBeInTheDocument();
  });

  it('replaces open instruction metadata with the fresh read response', async () => {
    apiMock.listProjectFiles.mockResolvedValue({
      files: [{
        path: '.anton/anton.md',
        name: 'anton.md',
        capabilities: { canEdit: true, canDelete: true },
        attribution: {
          createdBy: { userId: 'creator', email: 'creator@example.com' },
          lastModifiedBy: { userId: 'old-editor', email: 'old@example.com' },
          lastModifiedAt: '2026-08-29T10:00:00Z',
        },
      }],
    });
    apiMock.readProjectFile.mockResolvedValue({
      path: '.anton/anton.md',
      content: 'Project guidance.',
      capabilities: { canEdit: false, canDelete: false },
      attribution: {
        createdBy: { userId: 'creator', email: 'creator@example.com' },
        lastModifiedBy: { userId: 'current-editor', email: 'current@example.com' },
        lastModifiedAt: '2026-08-29T11:00:00Z',
      },
    });

    await act(async () => {
      render(
        <ContextCard
          project={{
            name: 'billing',
            path: '/projects/billing',
            capabilities: { canEditInstructions: true },
          }}
          conversationId={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Instructions'));

    expect(await screen.findByText(/Last modified by current@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
  });

  it('refreshes the open instruction attribution after a save', async () => {
    const original = {
      path: '.anton/anton.md',
      name: 'anton.md',
      capabilities: { canEdit: true, canDelete: true },
      attribution: {
        createdBy: { userId: 'creator', email: 'creator@example.com' },
        lastModifiedBy: { userId: 'old-editor', email: 'old@example.com' },
        lastModifiedAt: '2026-08-29T10:00:00Z',
      },
    };
    const refreshed = {
      ...original,
      attribution: {
        ...original.attribution,
        lastModifiedBy: { userId: 'current-editor', email: 'current@example.com' },
        lastModifiedAt: '2026-08-29T11:00:00Z',
      },
    };
    apiMock.listProjectFiles
      .mockResolvedValueOnce({ files: [original] })
      .mockResolvedValueOnce({ files: [refreshed] });
    apiMock.readProjectFile.mockResolvedValue({
      ...original,
      content: 'Project guidance.',
    });
    apiMock.writeProjectFile.mockResolvedValue({
      path: '.anton/anton.md',
      size: 17,
      modified: 1788030000,
    });

    await act(async () => {
      render(
        <ContextCard
          project={{
            name: 'billing',
            path: '/projects/billing',
            capabilities: { canEditInstructions: true },
          }}
          conversationId={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Instructions'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated guidance.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Last modified by current@example.com/)).toBeInTheDocument();
    expect(apiMock.listProjectFiles).toHaveBeenCalledTimes(2);
    expect(apiMock.listProjectFiles).toHaveBeenLastCalledWith(
      'billing',
      { forceFresh: true },
    );
  });

  it('does not let an older list response replace newer write metadata', async () => {
    const original = {
      path: '.anton/anton.md',
      name: 'anton.md',
      size: 12,
      modified: 1788026400,
      capabilities: { canEdit: true, canDelete: true },
      attribution: {
        createdBy: { userId: 'creator', email: 'creator@example.com' },
        lastModifiedBy: { userId: 'old-editor', email: 'old@example.com' },
        lastModifiedAt: '2026-08-29T10:00:00Z',
      },
    };
    const written = {
      path: '.anton/anton.md',
      size: 17,
      modified: 1788030000,
      capabilities: { canEdit: true, canDelete: true },
      attribution: {
        createdBy: { userId: 'creator', email: 'creator@example.com' },
        lastModifiedBy: { userId: 'current-editor', email: 'current@example.com' },
        lastModifiedAt: '2026-08-29T11:00:00Z',
      },
    };
    apiMock.listProjectFiles
      .mockResolvedValueOnce({ files: [original] })
      .mockResolvedValueOnce({ files: [original] });
    apiMock.readProjectFile.mockResolvedValue({
      ...original,
      content: 'Project guidance.',
    });
    apiMock.writeProjectFile.mockResolvedValue(written);

    await act(async () => {
      render(
        <ContextCard
          project={{
            name: 'billing',
            path: '/projects/billing',
            capabilities: { canEditInstructions: true },
          }}
          conversationId={null}
        />,
      );
    });

    fireEvent.click(screen.getByText('Instructions'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated guidance.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Last modified by current@example.com/))
      .toBeInTheDocument();
    await waitFor(() => expect(apiMock.listProjectFiles).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Last modified by old@example.com/)).not.toBeInTheDocument();
  });
});

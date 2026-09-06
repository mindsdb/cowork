import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ContextCard } from './ContextCard';

// Disconnect must invalidate this card's cached Drive references across every disconnect entry
// point.

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

// Hermes has no Anton memory; do not show or fetch its Project/Global memory rail.
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

  // A listing without attribution must still apply revoked capabilities instead of retaining an
  // older canDelete.
  it('accepts capabilities from a listing that carries no attribution timestamp', async () => {
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
    const revoked = {
      path: '.anton/anton.md',
      name: 'anton.md',
      size: 17,
      modified: 1788030000,
      capabilities: { canEdit: true, canDelete: false },
    };
    apiMock.listProjectFiles
      .mockResolvedValueOnce({ files: [original] })
      .mockResolvedValueOnce({ files: [revoked] });
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

    await waitFor(() => expect(apiMock.listProjectFiles).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Delete .anton/anton.md' }))
      .not.toBeInTheDocument();
  });
});

describe('ContextCard — memory rail capability gates', () => {
  const memoryProject = { id: 'project-1', name: 'billing', path: '/projects/billing' };

  const openRules = async (capabilities) => {
    const entry = {
      path: 'Project:project-1:rules',
      scope: 'Project',
      projectId: memoryProject.id,
      projectName: memoryProject.name,
      category: 'rules',
      content: 'Original rules.',
      ...(capabilities ? { capabilities } : {}),
    };
    apiMock.fetchMemory.mockResolvedValue({
      sections: [{ scope: 'Project', files: [entry] }],
    });

    await act(async () => {
      render(<ContextCard project={memoryProject} conversationId={null} />);
    });
    fireEvent.click(screen.getByText('Rules'));
    return screen.findByRole('button', { name: 'Edit' });
  };

  it('opens a granted memory entry with edit and delete live', async () => {
    const edit = await openRules({ canEdit: true, canDelete: true });

    expect(edit).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('opens a denied memory entry read only', async () => {
    const edit = await openRules({ canEdit: false, canDelete: false });

    expect(edit).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Read only');
  });

  it('fails closed on hosted Cowork when the entry carries no capabilities', async () => {
    const edit = await openRules(null);

    expect(edit).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Read only');
  });
});

describe('ContextCard — memory read ordering', () => {
  // Discard a pre-save read that arrives after the save's refresh, preserving saved content and new
  // capabilities.
  it('drops a pre-mutation memory read that lands after the post-mutation refresh', async () => {
    const project = { id: 'project-1', name: 'billing', path: '/projects/billing' };
    const before = {
      path: 'Project:project-1:rules',
      scope: 'Project',
      projectId: project.id,
      projectName: project.name,
      category: 'rules',
      content: 'Original rules.',
      capabilities: { canEdit: true, canDelete: true },
    };
    const after = {
      ...before,
      content: 'Updated rules.',
      capabilities: { canEdit: true, canDelete: false },
    };
    const sectionsOf = (entry) => ({ sections: [{ scope: 'Project', files: [entry] }] });

    const pending = [];
    apiMock.fetchMemory.mockImplementation(() => new Promise((resolve) => {
      pending.push(resolve);
    }));
    apiMock.saveMemory.mockResolvedValue(after);

    const { rerender } = render(
      <ContextCard project={project} conversationId={null} refreshKey={0} />,
    );
    await act(async () => {});
    await act(async () => { pending[0](sectionsOf(before)); });

    fireEvent.click(screen.getByText('Rules'));
    await act(async () => { pending[1](sectionsOf(before)); });
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeEnabled();

    // A finished turn bumps the refresh key, starting a read that has not
    // settled by the time the user saves.
    rerender(<ContextCard project={project} conversationId={null} refreshKey={1} />);
    await act(async () => {});
    expect(pending).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated rules.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(pending).toHaveLength(4));

    await act(async () => { pending[3](sectionsOf(after)); });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();

    await act(async () => { pending[2](sectionsOf(before)); });

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByText('Updated rules.')).toBeInTheDocument();
  });
});

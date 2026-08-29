import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
  mountProjectFilePreview: vi.fn(),
  projectFileDownloadUrl: vi.fn(() => ''),
  ANTON_PROJECT_INSTRUCTIONS_PATH: '.anton/anton.md',
  BASE: '/api/v1',
}));

vi.mock('../../api', () => api);

vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: true,
    showItemInFolder: vi.fn(),
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));

import ContextFileModal from './ContextFileModal';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'confirm');
});

describe('ContextFileModal shared-resource permissions', () => {
  it('shows attribution while disabling forbidden edit and delete actions', () => {
    render(
      <ContextFileModal
        open
        title="Rules"
        initialContent="Keep responses concise."
        saver={vi.fn()}
        remover={vi.fn()}
        editable={false}
        deletable={false}
        attributionResource={{
          attribution: {
            createdBy: { userId: 'creator-id', email: 'creator@example.com' },
            lastModifiedBy: { userId: 'editor-id', email: 'editor@example.com' },
            lastModifiedAt: '2026-08-29T10:00:00Z',
          },
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Created by creator@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/Last modified by editor@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('allows a capability-authorized canonical instructions delete', async () => {
    api.deleteProjectFile.mockResolvedValue({ status: 'deleted' });
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });
    const onChanged = vi.fn();
    const onClose = vi.fn();

    render(
      <ContextFileModal
        open
        projectName="billing"
        filePath=".anton/anton.md"
        initialContent="Keep responses concise."
        editable
        deletable
        onChanged={onChanged}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(api.deleteProjectFile).toHaveBeenCalledWith('billing', '.anton/anton.md');
    });
    expect(onChanged).toHaveBeenCalledWith({ path: '.anton/anton.md', deleted: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('propagates fresh read and write attribution and capabilities', async () => {
    const readResource = {
      path: '.anton/anton.md',
      content: 'Original guidance.',
      capabilities: { canEdit: true, canDelete: true },
      attribution: {
        createdBy: { userId: 'creator', email: 'creator@example.com' },
        lastModifiedBy: { userId: 'first-editor', email: 'first@example.com' },
        lastModifiedAt: '2026-08-29T10:00:00Z',
      },
    };
    const writtenResource = {
      path: '.anton/anton.md',
      capabilities: { canEdit: true, canDelete: true },
      attribution: {
        createdBy: { userId: 'creator', email: 'creator@example.com' },
        lastModifiedBy: { userId: 'current-editor', email: 'current@example.com' },
        lastModifiedAt: '2026-08-29T11:00:00Z',
      },
    };
    api.readProjectFile.mockResolvedValue(readResource);
    api.writeProjectFile.mockResolvedValue(writtenResource);
    const onResourceLoaded = vi.fn();

    render(
      <ContextFileModal
        open
        projectName="billing"
        filePath=".anton/anton.md"
        editable
        deletable
        onResourceLoaded={onResourceLoaded}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated guidance.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.writeProjectFile).toHaveBeenCalledWith(
      'billing',
      '.anton/anton.md',
      'Updated guidance.',
    ));
    expect(onResourceLoaded).toHaveBeenCalledWith(readResource);
    expect(onResourceLoaded).toHaveBeenLastCalledWith(writtenResource);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

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

describe('ContextFileModal load effect stability', () => {
  // Regression: `editable` and `onResourceLoaded` sat in the load effect's
  // deps, so the read response widening the edit capability re-ran the effect
  // and read the same file a second time on every open.
  it('reads the file once when the read response widens the edit capability', async () => {
    api.readProjectFile.mockResolvedValue({
      path: '.anton/anton.md',
      content: 'Project guidance.',
      capabilities: { canEdit: true, canDelete: true },
    });

    function Harness() {
      const [editable, setEditable] = useState(false);
      return (
        <ContextFileModal
          open
          projectName="billing"
          filePath=".anton/anton.md"
          editable={editable}
          deletable={false}
          onResourceLoaded={(resource) => setEditable(!!resource.capabilities?.canEdit)}
          onClose={vi.fn()}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled());
    expect(api.readProjectFile).toHaveBeenCalledTimes(1);
  });

  it('keeps an unsaved draft when a revoked edit capability arrives mid-edit', () => {
    const { rerender } = render(
      <ContextFileModal
        open
        projectName="billing"
        filePath=".anton/anton.md"
        initialContent="Original guidance."
        editable
        deletable={false}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft in progress.' } });

    rerender(
      <ContextFileModal
        open
        projectName="billing"
        filePath=".anton/anton.md"
        initialContent="Original guidance."
        editable={false}
        deletable={false}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveValue('Draft in progress.');
  });
});

describe('ContextFileModal instructions delete default', () => {
  // Regression: `deletable` defaulted to true, so a surface that opened this
  // modal on the instructions path without wiring the capability rendered a
  // live Delete on the file the agent reads every turn.
  it('withholds delete on the instructions file when no capability is passed', () => {
    render(
      <ContextFileModal
        open
        projectName="billing"
        filePath=".anton/anton.md"
        initialContent="Keep responses concise."
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('keeps ordinary project files deletable when no capability is passed', () => {
    render(
      <ContextFileModal
        open
        projectName="billing"
        filePath="notes.md"
        initialContent="Scratch notes."
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('lets an explicit capability widen the instructions delete', () => {
    render(
      <ContextFileModal
        open
        projectName="billing"
        filePath=".anton/anton.md"
        initialContent="Keep responses concise."
        deletable
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});

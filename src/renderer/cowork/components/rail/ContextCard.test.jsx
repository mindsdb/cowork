import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
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
vi.mock('../../api', () => apiMock);

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.fetchMemory.mockResolvedValue({});
  apiMock.listProjectFiles.mockResolvedValue({ files: [] });
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

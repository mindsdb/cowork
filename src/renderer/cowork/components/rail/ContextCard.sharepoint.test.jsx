import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextCard } from './ContextCard';
import { fetchAuthenticatedResponse, openAuthenticatedResource } from '../../lib/authenticatedResource';

// "Add files from SharePoint" in the project rail, and the rail refreshing
// after a SharePoint import into its project from anywhere (the composer too).
// Mocks follow ContextCard.test.jsx.

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
vi.mock('../../lib/authenticatedResource', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAuthenticatedResponse: vi.fn(),
  openAuthenticatedResource: vi.fn(async () => true),
}));
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

import { PROJECT_FILES_CHANGED } from '../sharepoint/SharePointImportModal';

async function renderCard(props = {}) {
  await act(async () => {
    render(<ContextCard project={{ name: 'Sales' }} conversationId={null} {...props} />);
  });
}

describe('ContextCard — SharePoint', () => {
  it('offers "Add files from SharePoint" and starts it for this project', async () => {
    const user = userEvent.setup();
    const onAddSharePointFiles = vi.fn();
    await renderCard({ onAddSharePointFiles });

    await user.click(screen.getByRole('button', { name: 'Add files to this project' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add files from SharePoint' }));

    expect(onAddSharePointFiles).toHaveBeenCalledWith('Sales');
  });

  it('has no SharePoint item without the entry point (org mode)', async () => {
    const user = userEvent.setup();
    await renderCard();

    await user.click(screen.getByRole('button', { name: 'Add files to this project' }));

    expect(await screen.findByRole('menuitem', { name: 'Attach files' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Add files from SharePoint' })).toBeNull();
  });

  it("refetches its files after an import into its project, and ignores other projects'", async () => {
    await renderCard();
    const before = apiMock.listProjectFiles.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new CustomEvent(PROJECT_FILES_CHANGED, { detail: { project: 'Other' } }));
    });
    expect(apiMock.listProjectFiles.mock.calls.length).toBe(before);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(PROJECT_FILES_CHANGED, { detail: { project: 'Sales' } }));
    });
    await waitFor(() => expect(apiMock.listProjectFiles.mock.calls.length).toBe(before + 1));
    expect(apiMock.listProjectFiles.mock.calls.at(-1)).toEqual(['Sales', { forceFresh: true }]);
  });
});

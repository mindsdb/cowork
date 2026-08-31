/*
 * On canonical web the Download chip fetches the bytes and saves them from a
 * Blob. A Blob carries no Content-Disposition, so the name handed to
 * `downloadAuthenticatedResource` is the only thing naming the saved file, and
 * project paths nest. Before the fetch path existed the server's
 * Content-Disposition supplied a basename and this could not go wrong.
 *
 * The chip only renders in the html, image, and binary branches, so these
 * cases drive it through the image branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
  downloadAuthenticatedResource: vi.fn(async () => true),
  fetchAuthenticatedBlob: vi.fn(async () => new Blob([''], { type: 'image/png' })),
  projectFileDownloadUrl: vi.fn((project, path) => `/api/v1/projects/${project}/files-raw/${path}`),
  host: { isWeb: true },
}));

vi.mock('../../lib/authenticatedResource', () => ({
  downloadAuthenticatedResource: mocks.downloadAuthenticatedResource,
  fetchAuthenticatedBlob: mocks.fetchAuthenticatedBlob,
}));
vi.mock('../../../platform/host', () => ({ host: mocks.host }));
vi.mock('../markdown/MarkdownContent', () => ({ MarkdownContent: () => null }));
vi.mock('../../api', () => ({
  readProjectFile: vi.fn(async () => ({ content: '' })),
  writeProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
  mountProjectFilePreview: vi.fn(async () => ({ kind: 'none' })),
  projectFileDownloadUrl: mocks.projectFileDownloadUrl,
  ANTON_PROJECT_INSTRUCTIONS_PATH: '.anton/anton.md',
  BASE: 'http://127.0.0.1:26866/api/v1',
}));

import ContextFileModal from './ContextFileModal';

let container;
let root;

beforeEach(() => {
  mocks.downloadAuthenticatedResource.mockClear();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function clickDownload(filePath) {
  await act(async () => {
    root.render(
      <ContextFileModal
        open
        projectName="acme"
        projectPath="/tmp/acme"
        filePath={filePath}
        onClose={() => {}}
      />,
    );
  });
  const download = [...document.querySelectorAll('button')]
    .find((button) => button.textContent.includes('Download'));
  expect(download).toBeTruthy();
  await act(async () => download.click());
}

describe('ContextFileModal download on web', () => {
  it('saves a nested project file under its basename', async () => {
    await clickDownload('reports/2026/chart.png');

    expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledWith(
      expect.stringContaining('reports/2026/chart.png'),
      'chart.png',
    );
  });

  it('leaves a top-level filename alone', async () => {
    await clickDownload('chart.png');

    expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledWith(
      expect.any(String),
      'chart.png',
    );
  });
});

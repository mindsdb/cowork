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
  host: { isWeb: true, openPath: vi.fn(), showItemInFolder: vi.fn() },
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
import { readProjectFile, writeProjectFile } from '../../api';

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

/* A figure's source names a project file the agent chose, so the chat opens
   it with `showOpenAction={false}`: the desktop header keeps Reveal, which
   only selects the file, and drops Open, which hands it to the OS default app
   through host.openPath. */
describe('ContextFileModal file actions on desktop', () => {
  beforeEach(() => { mocks.host.isWeb = false; });
  afterEach(() => { mocks.host.isWeb = true; });

  const headerButtons = async (props) => {
    await act(async () => {
      root.render(
        <ContextFileModal open projectName="acme" projectPath="/tmp/acme" filePath="charts/stock.png" onClose={() => {}} {...props} />,
      );
    });
    return [...document.querySelectorAll('button')].map((button) => button.textContent.trim());
  };

  it('offers Reveal and Open by default', async () => {
    const labels = await headerButtons({});
    expect(labels.some((label) => label.endsWith('Reveal'))).toBe(true);
    expect(labels.some((label) => label.endsWith('Open'))).toBe(true);
  });

  it('drops Open, and keeps Reveal, without the open action', async () => {
    const labels = await headerButtons({ showOpenAction: false });
    expect(labels.some((label) => label.endsWith('Reveal'))).toBe(true);
    expect(labels.some((label) => label.endsWith('Open'))).toBe(false);
  });
});

/* A figure's source is that figure's evidence, so the chat opens it with
   `showEditAction={false}`: the viewer shows the file and offers no way to
   change it, without the read-only note a shared resource the user may not
   edit carries. */
describe('ContextFileModal without the edit action', () => {
  beforeEach(() => {
    vi.mocked(readProjectFile).mockClear();
    vi.mocked(writeProjectFile).mockClear();
  });

  const renderModal = async (props) => {
    await act(async () => {
      root.render(<ContextFileModal open projectName="acme" onClose={() => {}} showEditAction={false} {...props} />);
    });
    return [...document.querySelectorAll('button')].map((button) => button.textContent.trim());
  };

  it('shows a text file with no Edit and never writes it', async () => {
    vi.mocked(readProjectFile).mockResolvedValueOnce({ content: 'sku,qty\nmug,250\n' });
    const labels = await renderModal({ filePath: 'data/stock.csv' });
    expect(document.querySelector('pre').textContent).toContain('mug,250');
    expect(labels).not.toContain('Edit');
    expect(document.body.textContent).not.toMatch(/You do not have permission/);
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it('does not open an empty project instructions file for editing', async () => {
    const labels = await renderModal({ filePath: '.anton/anton.md' });
    expect(readProjectFile).toHaveBeenCalledWith('acme', '.anton/anton.md');
    expect(document.querySelector('textarea')).toBeNull();
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('Save');
    expect(writeProjectFile).not.toHaveBeenCalled();
  });
});

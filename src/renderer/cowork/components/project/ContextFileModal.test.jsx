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
  fetchAuthenticatedResponse: vi.fn(),
  projectFileDownloadUrl: vi.fn((project, path) => `/api/v1/projects/${project}/files-raw/${path}`),
  host: { isWeb: true, openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('../../lib/authenticatedResource', () => ({
  downloadAuthenticatedResource: mocks.downloadAuthenticatedResource,
  fetchAuthenticatedBlob: mocks.fetchAuthenticatedBlob,
  fetchAuthenticatedResponse: mocks.fetchAuthenticatedResponse,
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
import { mountProjectFilePreview, readProjectFile, writeProjectFile } from '../../api';

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

describe('ContextFileModal previewing a project HTML file', () => {
  it.each(['report.html', 'report.htm'])('loads %s in the iframe from the mount url', async (filePath) => {
    const url = `http://127.0.0.1:26866/api/v1/projects/preview-asset/tok/${filePath}`;
    mountProjectFilePreview.mockResolvedValueOnce({ url });
    await act(async () => {
      root.render(<ContextFileModal open projectName="acme" filePath={filePath} onClose={() => {}} />);
    });
    expect(mountProjectFilePreview).toHaveBeenLastCalledWith('acme', filePath);
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe(url);
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

const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const buttonLabels = () => [...document.querySelectorAll('button')].map((button) => button.textContent.trim());

/* A file the viewer cannot read shows why and nothing else: no '(empty
   file)', and never the rows of a file this viewer showed before. The load
   error is its own state, since a failed save or delete also reports an
   error and must leave the file on screen. */
describe('ContextFileModal when the file cannot be read', () => {
  beforeEach(() => {
    vi.mocked(readProjectFile).mockReset().mockResolvedValue({ content: '' });
    vi.mocked(writeProjectFile).mockReset();
  });

  const renderFile = async (filePath, props = {}) => {
    await act(async () => {
      root.render(<ContextFileModal open projectName="acme" filePath={filePath} onClose={() => {}} {...props} />);
    });
  };

  it('says a missing project file is no longer in the project, with no body and no Edit', async () => {
    vi.mocked(readProjectFile).mockRejectedValueOnce(notFound('File not found'));
    await renderFile('data/rates.csv');
    expect(document.body.textContent).toContain('data/rates.csv is no longer in this project.');
    expect(document.body.textContent).not.toContain('(empty file)');
    expect(document.querySelector('pre')).toBeNull();
    expect(buttonLabels()).not.toContain('Edit');
  });

  it('never shows the previous file under a file it could not read', async () => {
    vi.mocked(readProjectFile).mockResolvedValueOnce({ content: 'sku,qty\nmug,250\n' });
    await renderFile('data/stock.csv', { showEditAction: false });
    expect(document.querySelector('pre').textContent).toContain('mug,250');

    vi.mocked(readProjectFile).mockRejectedValueOnce(notFound('File not found'));
    await renderFile('data/rates.csv', { showEditAction: false });
    expect(document.body.textContent).toContain('data/rates.csv is no longer in this project.');
    expect(document.body.textContent).not.toContain('mug,250');
  });

  it('never shows the previous file in a viewer that has nothing to read', async () => {
    vi.mocked(readProjectFile).mockResolvedValueOnce({ content: 'sku,qty\nmug,250\n' });
    await renderFile('data/stock.csv', { showEditAction: false });
    expect(document.querySelector('pre').textContent).toContain('mug,250');

    // No project to read the next file from and no raw URL, so nothing loads.
    await renderFile('data/rates.csv', { showEditAction: false, projectName: undefined });
    expect(readProjectFile).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('mug,250');
  });

  it('says a missing project image is no longer in the project, with no file actions', async () => {
    mocks.fetchAuthenticatedBlob.mockRejectedValueOnce(notFound('Could not load file (404)'));
    await renderFile('charts/stock.png', { projectPath: '/tmp/acme' });
    expect(document.body.textContent).toContain('charts/stock.png is no longer in this project.');
    expect(document.querySelector('img')).toBeNull();
    expect(buttonLabels().some((label) => /Download|Reveal/.test(label))).toBe(false);
  });

  it('keeps the file on screen when a save fails', async () => {
    vi.mocked(readProjectFile).mockResolvedValueOnce({ content: 'sku,qty\nmug,250\n' });
    vi.mocked(writeProjectFile).mockRejectedValueOnce(new Error('Disk full'));
    await renderFile('data/stock.csv');
    const edit = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Edit');
    await act(async () => edit.click());
    const save = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Save');
    await act(async () => save.click());
    expect(document.body.textContent).toContain('Disk full');
    expect(document.querySelector('textarea').value).toContain('mug,250');
  });
});

/* One viewer serves many files. Closing it mid-edit must not carry the edit
   over to the next file it opens, where Save would write the empty draft
   over a file the viewer never read. */
describe('ContextFileModal reopened after an edit was left open', () => {
  beforeEach(() => {
    vi.mocked(readProjectFile).mockReset().mockResolvedValue({ content: '' });
    vi.mocked(writeProjectFile).mockReset().mockResolvedValue({});
  });

  const show = async (props) => {
    await act(async () => {
      root.render(<ContextFileModal projectName="acme" onClose={() => {}} {...props} />);
    });
  };
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const editThenClose = async () => {
    vi.mocked(readProjectFile).mockResolvedValueOnce({ content: 'notes' });
    await show({ open: true, filePath: 'notes.md' });
    await act(async () => button('Edit').click());
    expect(document.querySelector('textarea')).not.toBeNull();
    await show({ open: false, filePath: 'notes.md' });
  };

  it.each([
    ['fails', Object.assign(new Error('Internal error'), { status: 500 }), 'Internal error'],
    ['finds no text in', new Error('HTTP 415 not valid UTF-8'), "can't be displayed inline"],
  ])('offers no Save on a file the read %s, and never writes it', async (_label, failure, shown) => {
    await editThenClose();
    vi.mocked(readProjectFile).mockRejectedValueOnce(failure);
    await show({ open: true, filePath: 'ledger.csv' });
    expect(document.body.textContent).toContain(shown);
    expect(buttonLabels()).not.toContain('Save');
    expect(buttonLabels()).not.toContain('Cancel');
    expect(buttonLabels()).toContain('Close');
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it('opens the next file in view mode, with no Save while it loads', async () => {
    await editThenClose();
    let finishRead;
    vi.mocked(readProjectFile).mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
    await show({ open: true, filePath: 'ledger.csv' });
    expect(document.body.textContent).toContain('Loading…');
    expect(buttonLabels()).not.toContain('Save');

    await act(async () => finishRead({ content: 'sku,qty\nmug,250\n' }));
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('pre').textContent).toContain('mug,250');
    expect(buttonLabels()).toContain('Edit');
    expect(writeProjectFile).not.toHaveBeenCalled();
  });
});

/* A file attached to the chat has no project path, so a viewer that only
   shows it reads its bytes from `rawUrl` and shows them as text when they
   are UTF-8 text under the inline cap. Other bytes land in the binary panel,
   which offers no actions it does not have. */
describe('ContextFileModal showing an attached file as text', () => {
  beforeEach(() => {
    mocks.fetchAuthenticatedBlob.mockReset();
    mocks.fetchAuthenticatedResponse.mockReset();
    vi.mocked(readProjectFile).mockClear();
    mocks.host.isWeb = false;
  });
  afterEach(() => { mocks.host.isWeb = true; });

  const RAW = 'http://127.0.0.1:26866/api/v1/files/file-123/content';
  const INLINE_CAP = 2 * 1024 * 1024;
  /* A response as fetchAuthenticatedResponse hands it back: its headers in,
     its body not read yet. */
  const fileResponse = (blob, headers = {}) => ({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    blob: vi.fn(async () => blob),
    body: { cancel: vi.fn(async () => {}) },
  });
  const renderAttachment = async (props = {}) => {
    await act(async () => {
      root.render(
        <ContextFileModal
          open
          title="stock.csv"
          filePath="stock.csv"
          rawUrl={RAW}
          showRawText
          showOpenAction={false}
          showEditAction={false}
          remover={null}
          onClose={() => {}}
          {...props}
        />,
      );
    });
  };

  it('reads the bytes from the raw URL and shows them, with no Open, Edit or Delete', async () => {
    const text = 'sku,qty\nmug,250\n';
    mocks.fetchAuthenticatedResponse.mockResolvedValueOnce(
      fileResponse(new Blob([text], { type: 'text/csv' }), { 'Content-Length': String(text.length) }),
    );
    await renderAttachment();
    expect(mocks.fetchAuthenticatedResponse).toHaveBeenCalledWith(RAW);
    expect(document.querySelector('pre').textContent).toContain('mug,250');
    const labels = buttonLabels();
    expect(labels.some((label) => /Open$|Edit|Delete/.test(label))).toBe(false);
    expect(readProjectFile).not.toHaveBeenCalled();
  });

  it('shows bytes that are not UTF-8 text in the binary panel, which promises no actions it lacks', async () => {
    mocks.fetchAuthenticatedResponse.mockResolvedValueOnce(
      fileResponse(new Blob([new Uint8Array([0x25, 0x50, 0xff, 0xfe])], { type: 'application/pdf' })),
    );
    await renderAttachment({ title: 'rates.pdf', filePath: 'rates.pdf' });
    expect(document.querySelector('pre')).toBeNull();
    expect(document.body.textContent).toContain("can't be displayed inline");
    expect(document.body.textContent).not.toContain('actions below');
  });

  it('refuses a file whose Content-Length is past the inline cap without reading its body', async () => {
    const big = fileResponse(new Blob(['sku,qty\n']), { 'Content-Length': String(INLINE_CAP + 1) });
    mocks.fetchAuthenticatedResponse.mockResolvedValueOnce(big);
    await renderAttachment();
    expect(big.blob).not.toHaveBeenCalled();
    expect(big.body.cancel).toHaveBeenCalled();
    expect(document.querySelector('pre')).toBeNull();
    expect(document.body.textContent).toContain("can't be displayed inline");
  });

  it('reads a file that sent no Content-Length, and refuses it after when it is past the inline cap', async () => {
    const big = fileResponse(new Blob(['x'.repeat(INLINE_CAP + 1)], { type: 'text/plain' }));
    mocks.fetchAuthenticatedResponse.mockResolvedValueOnce(big);
    await renderAttachment();
    expect(big.blob).toHaveBeenCalled();
    expect(document.querySelector('pre')).toBeNull();
    expect(document.body.textContent).toContain("can't be displayed inline");
  });

  it('says a missing attachment is no longer attached to the chat', async () => {
    mocks.fetchAuthenticatedResponse.mockRejectedValueOnce(notFound('Could not load file (404)'));
    await renderAttachment();
    expect(document.body.textContent).toContain('stock.csv is no longer attached to this chat.');
    expect(document.querySelector('pre')).toBeNull();
  });

  it('leaves a non-image attachment in the binary panel without the text read', async () => {
    await renderAttachment({ showRawText: false, showOpenAction: true });
    expect(mocks.fetchAuthenticatedResponse).not.toHaveBeenCalled();
    expect(mocks.fetchAuthenticatedBlob).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("can't be displayed inline");
  });

  it("shows the caller's note", async () => {
    mocks.fetchAuthenticatedResponse.mockResolvedValueOnce(fileResponse(new Blob(['a,b\n'], { type: 'text/csv' })));
    await renderAttachment({ note: 'Shows the file as it is now.' });
    expect(document.querySelector('[role="note"]').textContent).toBe('Shows the file as it is now.');
  });

  it("leaves the caller's note out when the file cannot be read, since there is no file to describe", async () => {
    mocks.fetchAuthenticatedResponse.mockRejectedValueOnce(notFound('Could not load file (404)'));
    await renderAttachment({ note: 'Shows the file as it is now.' });
    expect(document.body.textContent).toContain('stock.csv is no longer attached to this chat.');
    expect(document.querySelector('[role="note"]')).toBeNull();
  });
});

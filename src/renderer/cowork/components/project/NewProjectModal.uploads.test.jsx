import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../../api';
import * as toastUi from '../ui/Toast';
import NewProjectModal from './NewProjectModal';

const SIZE_LIMIT = 'This upload is over the size limit. Pick a smaller file, or fewer files at once.';

/* Types a name, picks one file through the hidden input, and presses Create. */
async function createWithOneFile() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<NewProjectModal open onClose={onClose} onCreated={onCreated} />, { wrapper: toastUi.ToastProvider });
  fireEvent.change(screen.getByPlaceholderText('acme-engineering'), {
    target: { value: 'billing' },
  });
  const file = new File(['%PDF-1.7'], 'quarterly-report.pdf', { type: 'application/pdf' });
  fireEvent.change(document.querySelector('input[type="file"]'), {
    target: { files: [file] },
  });
  await waitFor(() => screen.getByText('quarterly-report.pdf'));
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  return { onClose, onCreated, file };
}

describe('NewProjectModal file upload', () => {
  const toast = { add: vi.fn() };

  beforeEach(() => {
    vi.spyOn(api, 'createProject').mockResolvedValue({ id: 'project-1', name: 'billing' });
    vi.spyOn(api, 'uploadProjectFiles');
    vi.spyOn(toastUi, 'useToastManager').mockReturnValue(toast);
    toast.add.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it('creates the project and says the files did not upload when the upload is refused', async () => {
    api.uploadProjectFiles.mockRejectedValue(
      Object.assign(new Error(SIZE_LIMIT), { status: 413 }),
    );
    const { onClose, onCreated, file } = await createWithOneFile();

    /* The project exists either way, and the dialog closes so a second Create
       cannot make a duplicate. */
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'project-1', name: 'billing' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.uploadProjectFiles).toHaveBeenCalledWith('billing', [file]);

    expect(toast.add).toHaveBeenCalledTimes(1);
    const [shown] = toast.add.mock.calls[0];
    expect(shown).toMatchObject({ type: 'danger', timeout: 0, description: SIZE_LIMIT });
    expect(shown.title).toBe('"billing" was created, but its files didn\'t upload.');
  });

  it('names the project by the label the person typed, not its slug', async () => {
    api.createProject.mockResolvedValue({
      id: 'project-2',
      name: 'untitled-project-2',
      display_name: 'Мій проєкт',
    });
    api.uploadProjectFiles.mockRejectedValue(Object.assign(new Error(SIZE_LIMIT), { status: 413 }));
    await createWithOneFile();

    await waitFor(() => expect(toast.add).toHaveBeenCalledTimes(1));
    const [shown] = toast.add.mock.calls[0];
    expect(shown.title).toContain('Мій проєкт');
    expect(shown.title).not.toContain('untitled-project-2');
    // The upload still addresses the project by its slug.
    expect(api.uploadProjectFiles).toHaveBeenCalledWith('untitled-project-2', expect.any(Array));
  });

  it('names a file the server refused inside a successful upload', async () => {
    api.uploadProjectFiles.mockResolvedValue({
      results: [
        { name: 'quarterly-report.pdf', ok: true, size: 8 },
        { name: '.env', ok: false, error: 'invalid filename' },
      ],
    });
    const { onClose, onCreated } = await createWithOneFile();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(toast.add).toHaveBeenCalledTimes(1);
    const [shown] = toast.add.mock.calls[0];
    expect(shown).toMatchObject({ type: 'danger', timeout: 0, description: 'Files not uploaded: .env.' });
    expect(shown.title).toBe('"billing" was created, but not all of its files uploaded.');
  });

  it('raises no toast when the upload succeeds', async () => {
    api.uploadProjectFiles.mockResolvedValue({ results: [{ name: 'quarterly-report.pdf', ok: true, size: 8 }] });
    const { onClose, onCreated, file } = await createWithOneFile();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(api.uploadProjectFiles).toHaveBeenCalledWith('billing', [file]);
    expect(toast.add).not.toHaveBeenCalled();
  });
});

describe('NewProjectModal when the upload cannot be confirmed', () => {
  afterEach(() => vi.unstubAllGlobals());

  /* cowork-server answers a 4xx before it writes any file, so only a 4xx
     proves the files aren't there. A gateway's 5xx can come after the writes. */
  const gatewayPage = (status) => () => new Response(`<html><h1>${status}</h1></html>`, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });

  it.each([
    ['the upload response is cut short', () => new Response('{"results":[', { status: 200 })],
    ['the connection drops', () => { throw new TypeError('Failed to fetch'); }],
    ['a gateway answers 502', gatewayPage(502)],
    ['a gateway answers 504', gatewayPage(504)],
    ['the server answers 500', () => Response.json({ detail: 'Internal Server Error' }, { status: 500 })],
  ])('asks the user to check the files when %s', async (_scenario, uploadResponse) => {
    const project = { id: 'project-1', name: 'billing' };
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(project))
      .mockImplementationOnce(uploadResponse);
    vi.stubGlobal('fetch', fetch);

    const { onCreated, onClose } = await createWithOneFile();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    expect(onClose).toHaveBeenCalled();
    expect(fetch.mock.calls[1][0]).toMatch(/\/billing\/files\/upload$/);
    const toast = document.querySelector('[data-type="danger"]');
    expect(toast?.textContent).toBe('"billing" was created. Check its files before trying the upload again.');
  });
});

describe('NewProjectModal when the server or a proxy refuses the upload', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['an edge 413 page', new Response('<html><h1>413 Payload Too Large</h1></html>', { status: 413, headers: { 'Content-Type': 'text/html' } }), SIZE_LIMIT],
    ["the server's 413", Response.json({ detail: 'This upload is larger than the 500 MB limit.' }, { status: 413 }), 'This upload is larger than the 500 MB limit.'],
    ['a 404', Response.json({ detail: 'Project not found' }, { status: 404 }), 'Project not found'],
    ['a 400 with no sentence', new Response('', { status: 400 }), 'Upload failed (400)'],
  ])('says the files did not upload after %s', async (_scenario, refusal, reason) => {
    const project = { id: 'project-1', name: 'billing' };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json(project))
      .mockResolvedValueOnce(refusal));

    const { onCreated } = await createWithOneFile();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    const toast = document.querySelector('[data-type="danger"]');
    expect(toast?.textContent).toBe(`"billing" was created, but its files didn't upload.${reason}`);
  });
});

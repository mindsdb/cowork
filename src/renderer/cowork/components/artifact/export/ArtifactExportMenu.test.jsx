/*
 * The Export button end to end, from the menu pick through the request and the
 * save to the message it shows. Only the network and the save transport are
 * mocked, so the request body, the status mapping and the save path all run
 * for real. The answers live in ArtifactExportMenu.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  host: { isWeb: true, isElectron: false, getApiOrigin: () => 'https://cowork.example' },
  authFetch: vi.fn(),
  downloadAuthenticatedResource: vi.fn(async () => true),
}));
vi.mock('../../../../platform/host', () => ({ host: mocks.host }));
vi.mock('../../../api', () => ({ authFetch: mocks.authFetch, BASE: 'https://cowork.example/api/v1' }));
vi.mock('../../../lib/authenticatedResource', () => ({
  downloadAuthenticatedResource: mocks.downloadAuthenticatedResource,
}));

import { ArtifactExportMenu } from './ArtifactExportMenu';

const cases = load(readFileSync(resolve(__dirname, 'ArtifactExportMenu.test.yaml'), 'utf8'));

const ARTIFACT_ID = '7db94eb8f0a54c7e9c1d2b3a4f5e6d70';
const DRAFT_URL = `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/notes.md`;
const EXPORT_URL = `https://cowork.example/api/v1/artifacts/workspace/proj-1/${ARTIFACT_ID}/export`;

function exportResult(fields = {}) {
  return {
    filename: 'notes.docx',
    draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/notes.docx`,
    serveUrl: '/api/v1/artifacts/serve/proj/notes.docx',
    omittedCount: 0,
    scriptsDropped: false,
    ...fields,
  };
}

function answer(status, body) {
  mocks.authFetch.mockResolvedValueOnce({ ok: status === 200, status, json: async () => body });
}

async function exportAsWord(user = userEvent.setup()) {
  const view = render(<ArtifactExportMenu draftUrl={DRAFT_URL} formats={['html', 'docx']} />);
  await user.click(screen.getByRole('button', { name: /^Export/ }));
  await user.click(await screen.findByRole('menuitem', { name: 'Word' }));
  return view;
}

beforeEach(() => {
  mocks.authFetch.mockReset();
  mocks.downloadAuthenticatedResource.mockReset();
  mocks.downloadAuthenticatedResource.mockResolvedValue(true);
});

afterEach(cleanup);

describe('the export request', () => {
  it('posts only the format to the route the draft URL names', async () => {
    answer(200, exportResult());

    await exportAsWord();

    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalledTimes(1));
    const [url, options] = mocks.authFetch.mock.calls[0];
    expect(url).toBe(EXPORT_URL);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toStrictEqual({ format: 'docx' });
  });

  it('runs one export at a time', async () => {
    let settle;
    mocks.authFetch.mockReturnValueOnce(new Promise((resolveAnswer) => { settle = resolveAnswer; }));

    await exportAsWord();

    expect(screen.getByRole('button', { name: /Exporting/ })).toBeDisabled();
    settle({ ok: true, status: 200, json: async () => exportResult() });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Export/ })).toBeEnabled());
  });
});

describe.each(cases.failures)('an answer of $status', ({ status, message }) => {
  it(`shows "${message}" and saves nothing`, async () => {
    if (status === null) mocks.authFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else answer(status, { detail: 'refused' });

    await exportAsWord();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
    expect(mocks.downloadAuthenticatedResource).not.toHaveBeenCalled();
  });
});

describe.each(cases.written)('a 200 with omittedCount $omittedCount', ({ omittedCount, scriptsDropped, message }) => {
  it(message ? `downloads the file and shows "${message}"` : 'downloads the file and shows no message', async () => {
    const result = exportResult({ omittedCount, scriptsDropped });
    answer(200, result);

    await exportAsWord();

    await waitFor(() => expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledTimes(1));
    expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledWith(
      `https://cowork.example${result.draftUrl}?download=1`,
      result.filename,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^Export/ })).toBeEnabled());
    if (message) expect(screen.getByRole('status')).toHaveTextContent(message);
    else expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('a 200 whose file does not download', () => {
  it.each(cases.downloadFailed)('with omittedCount $omittedCount says so', async ({ filename, omittedCount, message }) => {
    answer(200, exportResult({ filename, omittedCount }));
    mocks.downloadAuthenticatedResource.mockRejectedValueOnce(Object.assign(new Error('401'), { status: 401 }));

    await exportAsWord();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
  });
});

/*
 * Closing the viewer or switching files unmounts the button. The export and
 * its save still finish, and no message timer outlives the button. The answer
 * is the written row that both saves a file and shows a message, so a message
 * timer would start if the button kept updating.
 */
describe('a button that unmounts', () => {
  const noticeRow = cases.written.find((row) => row.omittedCount === 1);
  const noticeAnswer = () => exportResult({
    omittedCount: noticeRow.omittedCount,
    scriptsDropped: noticeRow.scriptsDropped,
  });
  const fakeTimerUser = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('during an export still saves the file and starts no message timer', async () => {
    let settle;
    mocks.authFetch.mockReturnValueOnce(new Promise((resolveAnswer) => { settle = resolveAnswer; }));
    const { unmount } = await exportAsWord(fakeTimerUser());

    unmount();
    settle({ ok: true, status: 200, json: async () => noticeAnswer() });

    await waitFor(() => expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('while a message shows clears its timer', async () => {
    answer(200, noticeAnswer());
    const { unmount } = await exportAsWord(fakeTimerUser());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(noticeRow.message));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

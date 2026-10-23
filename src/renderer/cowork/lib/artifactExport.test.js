/*
 * Which transport saves an exported file on each host. Web saves through the
 * bearer fetch of the drafts route even when a serve URL is present. Desktop
 * saves through the serve URL, and through the drafts route when the server
 * sent none. Both transports are mocked, so these tests pin the choice of
 * transport only; how downloadAuthenticatedResource saves on each host is
 * pinned by authenticatedResource.test.js. The cases live in
 * artifactExport.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  host: { isWeb: true, getApiOrigin: () => 'https://cowork.example' },
  downloadUrl: vi.fn(() => true),
  downloadAuthenticatedResource: vi.fn(async () => true),
  requestArtifactExport: vi.fn(),
}));
vi.mock('../../platform/host', () => ({ host: mocks.host }));
vi.mock('./browserDownload', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadUrl: mocks.downloadUrl,
}));
vi.mock('./authenticatedResource', () => ({
  downloadAuthenticatedResource: mocks.downloadAuthenticatedResource,
}));
vi.mock('./artifactWorkspaceApi', () => ({ requestArtifactExport: mocks.requestArtifactExport }));

import { runArtifactExport, saveExportedFile } from './artifactExport';

const cases = load(readFileSync(resolve(__dirname, 'artifactExport.test.yaml'), 'utf8'));

const DRAFT_URL = '/api/v1/artifacts/drafts/proj-1/7db94eb8f0a54c7e9c1d2b3a4f5e6d70/notes.docx';

function exportResult(fields = {}) {
  return {
    filename: 'notes.docx',
    draftUrl: DRAFT_URL,
    serveUrl: '/api/v1/artifacts/serve/proj/notes.docx',
    omittedCount: 0,
    scriptsDropped: false,
    ...fields,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.downloadAuthenticatedResource.mockResolvedValue(true);
});

describe.each(cases.saves)('saving an export on $name', ({ web, serveUrl, transport, url }) => {
  it(`goes through the ${transport} transport`, async () => {
    mocks.host.isWeb = web;

    await expect(saveExportedFile(exportResult({ serveUrl }))).resolves.toBe(true);

    if (transport === 'authenticated') {
      expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledWith(url, 'notes.docx');
      expect(mocks.downloadUrl).not.toHaveBeenCalled();
    } else {
      expect(mocks.downloadUrl).toHaveBeenCalledWith(url, 'notes.docx');
      expect(mocks.downloadAuthenticatedResource).not.toHaveBeenCalled();
    }
  });
});

describe('runArtifactExport', () => {
  it('turns a failed save into an error notice instead of rejecting', async () => {
    mocks.host.isWeb = true;
    mocks.requestArtifactExport.mockResolvedValueOnce(exportResult());
    mocks.downloadAuthenticatedResource.mockRejectedValueOnce(new Error('network'));

    await expect(runArtifactExport(DRAFT_URL, 'docx')).resolves.toEqual({
      tone: 'error',
      text: "Exported notes.docx, but couldn't download it.",
    });
  });

  it('settles with an error notice when the save itself throws', async () => {
    mocks.host.isWeb = false;
    mocks.requestArtifactExport.mockResolvedValueOnce(exportResult());
    mocks.downloadUrl.mockImplementationOnce(() => { throw new Error('no document'); });

    await expect(runArtifactExport(DRAFT_URL, 'docx')).resolves.toEqual({
      tone: 'error',
      text: "Exported notes.docx, but couldn't download it.",
    });
  });

  it('saves nothing when the export itself fails', async () => {
    mocks.requestArtifactExport.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 429 }));

    await expect(runArtifactExport(DRAFT_URL, 'docx')).resolves.toEqual({
      tone: 'error',
      text: 'An export is already running; try again in a moment.',
    });
    expect(mocks.downloadAuthenticatedResource).not.toHaveBeenCalled();
    expect(mocks.downloadUrl).not.toHaveBeenCalled();
  });
});

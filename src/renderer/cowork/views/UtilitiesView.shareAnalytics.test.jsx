// The Utilities publish list reports its share and Copy URL like every other
// Share surface.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { copyText } = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../lib/clipboard', () => ({ copyText }));

const artifact = {
  path: '/tmp/report.html', id: 'artifact-1', title: 'Report', type: 'html',
  publishedUrl: 'https://minds.example/artifacts/report', accessMode: 'public',
};

const api = vi.hoisted(() => ({
  fetchPublishable: vi.fn(),
  publishArtifact: vi.fn(),
  fetchMemory: vi.fn(async () => ({})),
  fetchDatasources: vi.fn(async () => ({})),
  deleteDatasource: vi.fn(),
  deleteMemory: vi.fn(),
  findMemoryEntry: vi.fn(),
  labelCategory: vi.fn(),
  saveDatasource: vi.fn(),
  saveMemory: vi.fn(),
  validateDatasource: vi.fn(),
}));
vi.mock('../api', () => api);
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
const report = vi.hoisted(() => ({
  reportAccessChanged: vi.fn(),
  reportAccessChangeFailed: vi.fn(),
  reportLinkCopied: vi.fn(),
}));
vi.mock('../lib/artifactShareAnalytics', async (importOriginal) => ({ ...(await importOriginal()), ...report }));

import UtilitiesView from './UtilitiesView';

beforeEach(() => vi.clearAllMocks());

describe('UtilitiesView sharing analytics', () => {
  it('records a copied link only when the copy worked', async () => {
    api.fetchPublishable.mockResolvedValue({ publishReady: true, artifacts: [artifact], history: [] });
    render(<UtilitiesView kind="publish" />);
    const copy = await screen.findByRole('button', { name: 'Copy URL' });

    copyText.mockResolvedValueOnce(false);
    fireEvent.click(copy);
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    expect(report.reportLinkCopied).not.toHaveBeenCalled();

    copyText.mockResolvedValueOnce(true);
    fireEvent.click(copy);
    await waitFor(() => expect(report.reportLinkCopied).toHaveBeenCalledWith(artifact, { entry: 'utilities' }));
  });

  it('records sharing an unpublished artifact as a first share, and a failure as a failure', async () => {
    const draft = { ...artifact, publishedUrl: '', accessMode: undefined };
    api.fetchPublishable.mockResolvedValue({ publishReady: true, artifacts: [draft], history: [] });
    api.publishArtifact.mockResolvedValueOnce({ url: 'https://minds.example/r', accessMode: 'public', report_id: 'rep-3' });
    render(<UtilitiesView kind="publish" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    await waitFor(() => expect(report.reportAccessChanged).toHaveBeenCalledTimes(1));
    expect(report.reportAccessChanged.mock.calls[0][1]).toMatchObject({
      entry: 'utilities', reportId: 'rep-3',
      before: { shared: false, audience: 'unpublished' },
      after: { shared: true, audience: 'public' },
    });

    api.publishArtifact.mockRejectedValueOnce(new Error('down'));
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    await waitFor(() => expect(report.reportAccessChangeFailed).toHaveBeenCalledWith(draft, { entry: 'utilities', reason: 'error' }));
  });
});

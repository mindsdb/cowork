import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Await the shared copy helper and report its result.
const { copyText } = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../lib/clipboard', () => ({ copyText }));

const artifact = {
  path: '/tmp/report.html',
  id: 'artifact-1',
  title: 'Report',
  publishedUrl: 'https://minds.example/artifacts/report',
};

vi.mock('../api', () => ({
  fetchPublishable: vi.fn(async () => ({ publishReady: true, artifacts: [artifact], history: [] })),
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
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));

import UtilitiesView from './UtilitiesView';

describe('UtilitiesView — publish artifact Copy URL button', () => {
  it('reports success via the status line when the clipboard helper resolves true', async () => {
    copyText.mockResolvedValueOnce(true);

    render(<UtilitiesView kind="publish" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy URL' }));

    expect(copyText).toHaveBeenCalledWith(artifact.publishedUrl);
    expect(await screen.findByText('Copied URL to clipboard.')).toBeInTheDocument();
  });

  it('reports a fallback message, not silent nothing, when the clipboard helper resolves false', async () => {
    copyText.mockResolvedValueOnce(false);

    render(<UtilitiesView kind="publish" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy URL' }));

    await waitFor(() => expect(copyText).toHaveBeenCalledWith(artifact.publishedUrl));
    expect(await screen.findByText(/Couldn't copy — select the URL above/)).toBeInTheDocument();
  });

  // A live region announces passive copy failures.
  it('marks the failure status line as a live region for screen readers', async () => {
    copyText.mockResolvedValueOnce(false);

    render(<UtilitiesView kind="publish" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy URL' }));

    const message = await screen.findByText(/Couldn't copy — select the URL above/);
    expect(message.closest('[role="status"]')).not.toBeNull();
  });
});

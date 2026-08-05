import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Regression (ENG-1154 follow-up, flagged in review on PR #532): the
// "Copy URL" button on a published artifact called
// navigator.clipboard?.writeText() directly — unawaited, with no success or
// failure feedback either way. It now goes through the shared `copyText`
// helper (lib/clipboard) and reports the outcome via the page's status line.
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

  // Regression (review follow-up on #532): the status line renders via
  // Alert (components/ui/Alert.tsx), whose danger variant sets role="alert";
  // but this banner is passive status, so a screen reader has no guarantee it
  // announces the failure text unless the line is explicitly marked as a
  // live region.
  it('marks the failure status line as a live region for screen readers', async () => {
    copyText.mockResolvedValueOnce(false);

    render(<UtilitiesView kind="publish" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy URL' }));

    const message = await screen.findByText(/Couldn't copy — select the URL above/);
    expect(message.closest('[role="status"]')).not.toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The published URL is read from the artifact folder, which an agent can
// write to, so "Open" must go through host.openExternal's scheme check rather
// than straight to window.open.
const artifact = {
  path: '/tmp/report.html',
  id: 'artifact-1',
  title: 'Report',
  publishedUrl: 'javascript:alert(document.domain)',
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

describe('UtilitiesView — publish artifact Open button', () => {
  it('does not open a non-http(s) published URL on web', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    render(<UtilitiesView kind="publish" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument());
    expect(open).not.toHaveBeenCalled();
  });
});

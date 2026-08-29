import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchMemory: vi.fn(),
  saveMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

vi.mock('../api', () => ({
  deleteDatasource: vi.fn(),
  deleteMemory: (...args) => api.deleteMemory(...args),
  fetchDatasources: vi.fn(async () => ({})),
  fetchMemory: (...args) => api.fetchMemory(...args),
  fetchPublishable: vi.fn(async () => ({})),
  findMemoryEntry: (sections, path) => (
    (sections || []).flatMap((section) => section.files || [])
      .find((entry) => entry.path === path) || null
  ),
  labelCategory: (category) => (
    String(category || '').replace(/^./, (letter) => letter.toUpperCase())
  ),
  publishArtifact: vi.fn(),
  saveDatasource: vi.fn(),
  saveMemory: (...args) => api.saveMemory(...args),
  validateDatasource: vi.fn(),
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../lib/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import UtilitiesView from './UtilitiesView';

const entry = {
  path: 'Project:project-1:rules',
  scope: 'Project',
  projectId: 'project-1',
  projectName: 'billing',
  category: 'rules',
  content: 'Original rules.',
  capabilities: { canEdit: true, canDelete: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchMemory.mockResolvedValue({
    sections: [{
      scope: 'Project',
      projectName: 'billing',
      projectId: 'project-1',
      files: [entry],
    }],
  });
  api.saveMemory.mockResolvedValue({ ...entry, content: 'Updated rules.' });
});

describe('UtilitiesView shared-memory mutation refresh', () => {
  it('starts a fresh memory read after a successful save', async () => {
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Rules/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Updated rules.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveMemory).toHaveBeenCalled());
    await waitFor(() => expect(api.fetchMemory).toHaveBeenCalledWith(
      undefined,
      { forceFresh: true },
    ));
  });
});

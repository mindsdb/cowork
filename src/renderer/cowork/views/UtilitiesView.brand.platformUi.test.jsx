import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// A deployment brand's name in the Memories page's copy, on a web build with
// the platform UI off. UtilitiesView.permissions.test.jsx keeps the stock name.
vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { productName: 'Acme Cowork' };
});
vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));

const own = vi.hoisted(() => ({
  path: 'Global:global:profile',
  scope: 'Global',
  projectId: null,
  projectName: null,
  category: 'profile',
  content: 'Favorite part P-1111.',
  capabilities: { canEdit: false, canDelete: true },
}));

vi.mock('../api', () => ({
  deleteDatasource: vi.fn(),
  deleteMemory: vi.fn(),
  fetchDatasources: vi.fn(async () => ({})),
  fetchMemory: vi.fn(async () => ({
    sections: [{ scope: 'Global', projectName: null, projectId: null, files: [own] }],
  })),
  fetchMemoryCapabilities: vi.fn(async () => ({ canReset: true })),
  fetchPublishable: vi.fn(async () => ({})),
  findMemoryEntry: (sections, path) => (
    (sections || []).flatMap((section) => section.files || [])
      .find((entry) => entry.path === path) || null
  ),
  labelCategory: (category) => (
    String(category || '').replace(/^./, (letter) => letter.toUpperCase())
  ),
  publishArtifact: vi.fn(),
  resetMemory: vi.fn(),
  saveDatasource: vi.fn(),
  saveMemory: vi.fn(),
  validateDatasource: vi.fn(),
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../lib/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import UtilitiesView from './UtilitiesView';

describe('UtilitiesView own memory under a deployment brand', () => {
  it('names the brand, not Cowork, in the own-memory note, the Edit title and the reset confirm', async () => {
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Profile/ }));

    expect(screen.getByRole('note')).toHaveTextContent('Yours alone. Acme Cowork saves this on its own');
    expect(screen.getByRole('button', { name: 'Edit' }))
      .toHaveAttribute('title', 'Acme Cowork saves this memory on its own, so it can\'t be edited.');
    fireEvent.click(await screen.findByRole('button', { name: 'Reset my memory' }));
    expect(await screen.findByText(/everything Acme Cowork has learned for you/)).toBeInTheDocument();
  });
});

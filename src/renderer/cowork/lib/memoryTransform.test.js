import { describe, expect, it } from 'vitest';

import { groupMemoryItems } from './memoryTransform';

describe('groupMemoryItems shared-resource metadata', () => {
  it('retains attribution and capabilities on grouped memory entries', () => {
    const attribution = {
      createdBy: { userId: 'creator', email: 'creator@example.com' },
      lastModifiedBy: { userId: 'editor', email: 'editor@example.com' },
      lastModifiedAt: '2026-08-29T10:00:00Z',
    };
    const capabilities = { canEdit: false, canDelete: false };

    const grouped = groupMemoryItems([{
      scope: 'project',
      project_id: 'project-1',
      category: 'rules',
      content: 'Keep responses concise.',
      attribution,
      capabilities,
    }], [{ id: 'project-1', name: 'billing' }]);

    expect(grouped.sections[0].files[0]).toMatchObject({
      projectId: 'project-1',
      projectName: 'billing',
      attribution,
      capabilities,
    });
  });

  it('keeps the adapter shape and leaks no raw API keys', () => {
    const grouped = groupMemoryItems([{
      scope: 'project',
      project_id: 'project-1',
      category: 'rules',
      content: 'Keep responses concise.',
      path: '/server/owned/path',
      preview: 'server preview',
      updated_at: '2026-08-29T10:00:00Z',
    }], [{ id: 'project-1', name: 'billing' }]);

    const entry = grouped.sections[0].files[0];
    expect(Object.keys(entry).sort()).toEqual([
      'attribution',
      'capabilities',
      'category',
      'content',
      'path',
      'preview',
      'projectId',
      'projectName',
      'scope',
    ]);
    expect(entry.scope).toBe('Project');
    expect(entry.path).toBe('Project:project-1:rules');
    expect(entry.preview).toBe('Keep responses concise.');
    expect(entry.attribution).toBeNull();
    expect(entry.capabilities).toBeNull();
  });
});

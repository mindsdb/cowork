import { describe, expect, it } from 'vitest';

import {
  buildMemoryDeletePayload,
  buildMemoryWritePayload,
  groupMemoryItems,
} from './memoryTransform';

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

describe('deployment-shared memory', () => {
  const item = {
    scope: 'project',
    project_id: 'project-1',
    category: 'rules',
    content: 'Keep responses concise.',
  };

  it('retains an explicit deployment-sharing marker on the section and entry', () => {
    const { sections } = groupMemoryItems([{ ...item, deployment_shared: true }], []);

    expect(sections[0]).toMatchObject({
      deploymentShared: true,
      projectId: 'project-1',
      projectName: null,
    });
    expect(sections[0].files[0]).toMatchObject({
      deploymentShared: true,
      projectId: 'project-1',
      projectName: null,
    });
  });

  it.each([undefined, false, null, 'true', 1])(
    'keeps the legacy adapter shape when the marker is %s',
    (marker) => {
      const legacy = groupMemoryItems([item], []);
      const incoming = marker === undefined ? item : { ...item, deployment_shared: marker };

      expect(groupMemoryItems([incoming], [])).toEqual(legacy);
      expect(legacy.sections[0]).not.toHaveProperty('deploymentShared');
      expect(legacy.sections[0].files[0]).not.toHaveProperty('deploymentShared');
    },
  );

  it('keeps unknown project tiers distinct and addresses writes by their original ids', () => {
    const { sections } = groupMemoryItems([
      { ...item, deployment_shared: true },
      { ...item, project_id: 'project-2', content: 'Answer in pallets.', deployment_shared: true },
    ], []);

    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.projectId)).toEqual(['project-1', 'project-2']);
    expect(sections.map((section) => section.files[0].path)).toEqual([
      'Project:project-1:rules',
      'Project:project-2:rules',
    ]);
    const entry = sections[1].files[0];
    expect(buildMemoryWritePayload(entry)).toEqual({
      scope: 'project',
      category: 'rules',
      content: 'Answer in pallets.',
      project_id: 'project-2',
    });
    expect(buildMemoryDeletePayload(entry)).toEqual({
      scope: 'project',
      category: 'rules',
      project_id: 'project-2',
    });
  });
});
